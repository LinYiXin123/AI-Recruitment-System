import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    P2ImMessageReceiveV1,
    ReplyMessageRequest,
    ReplyMessageRequestBody,
)

logger = logging.getLogger(__name__)

LLM_UNAVAILABLE_REPLY = "抱歉，招聘助手暂时无法连接模型服务，请稍后再试。"
SYSTEM_PROMPT = """你是知遇 AI 的招聘助手，在飞书私聊中用简洁中文回答问题。
你目前不能读取候选人、简历、职位、面试或其他招聘系统数据，也不能执行任何业务操作。
不要编造已查询到的数据、已发送通知或已变更的招聘状态。涉及查看或变更业务数据时，说明当前暂未接通业务数据，并建议用户到招聘后台完成操作。"""


def should_reply(event: P2ImMessageReceiveV1) -> bool:
    """只在私聊中回应用户发来的文字，避免群聊打扰及机器人自循环。"""
    if not event.event or not event.event.message or not event.event.sender:
        return False

    return (
        event.event.sender.sender_type == "user"
        and event.event.message.chat_type == "p2p"
        and event.event.message.message_type == "text"
        and bool(event.event.message.message_id)
    )


class FeishuMessageResponder:
    def __init__(
        self,
        reply: Callable[[str, str], None],
        generate_reply: Callable[[str], str],
    ):
        self._reply = reply
        self._generate_reply = generate_reply

    def handle(self, event: P2ImMessageReceiveV1) -> None:
        if should_reply(event):
            text = extract_text(event.event.message.content)
            if not text:
                return

            try:
                reply = self._generate_reply(text)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                logger.warning("模型生成飞书回复失败：%s", type(exc).__name__)
                reply = LLM_UNAVAILABLE_REPLY
            self._reply(event.event.message.message_id, reply)


def extract_text(content: str | None) -> str:
    if not content:
        return ""

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return ""

    text = payload.get("text")
    return text.strip() if isinstance(text, str) else ""


class OpenAICompatibleChat:
    def __init__(self, *, base_url: str, api_key: str, model: str):
        self._endpoint = f"{base_url.rstrip('/')}/chat/completions"
        self._api_key = api_key
        self._model = model

    def reply(self, user_text: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
        }
        request = urllib.request.Request(
            self._endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                response_payload = json.load(response)
        except urllib.error.HTTPError as exc:
            raise OSError(f"模型服务返回 HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise OSError("模型服务网络连接失败") from exc

        response_text = response_payload["choices"][0]["message"]["content"]
        if not isinstance(response_text, str) or not response_text.strip():
            raise ValueError("模型服务未返回文字内容")
        return response_text.strip()


def send_text_reply(client: lark.Client, message_id: str, text: str) -> None:
    request = (
        ReplyMessageRequest.builder()
        .message_id(message_id)
        .request_body(
            ReplyMessageRequestBody.builder()
            .msg_type("text")
            .content(json.dumps({"text": text}, ensure_ascii=False))
            .build()
        )
        .build()
    )
    response = client.im.v1.message.reply(request)
    if not response.success():
        logger.error("飞书机器人回复失败：code=%s", response.code)


def build_long_connection_client(
    app_id: str,
    app_secret: str,
    generate_reply: Callable[[str], str],
) -> lark.ws.Client:
    api_client = lark.Client.builder().app_id(app_id).app_secret(app_secret).build()
    responder = FeishuMessageResponder(
        lambda message_id, text: send_text_reply(api_client, message_id, text),
        generate_reply,
    )
    event_handler = (
        lark.EventDispatcherHandler.builder("", "", lark.LogLevel.WARNING)
        .register_p2_im_message_receive_v1(responder.handle)
        .build()
    )
    return lark.ws.Client(
        app_id,
        app_secret,
        log_level=lark.LogLevel.WARNING,
        event_handler=event_handler,
    )
