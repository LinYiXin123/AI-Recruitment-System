import html
import json
import logging
import re
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock, Thread

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    P2ImMessageReceiveV1,
    PatchMessageRequest,
    PatchMessageRequestBody,
    ReplyMessageRequest,
    ReplyMessageRequestBody,
)
from lark_oapi.event.callback.model.p2_card_action_trigger import (
    P2CardActionTrigger,
    P2CardActionTriggerResponse,
)
from lark_oapi.ws.client import HEADER_TYPE, MessageType

from .llm import chat_completion

logger = logging.getLogger(__name__)

LLM_UNAVAILABLE_REPLY = "抱歉，招聘助手暂时无法连接模型服务，请稍后再试。"
SYSTEM_PROMPT = """你是知遇 AI 的招聘助手，在飞书私聊中用简洁中文回答问题。
你目前不能读取候选人、简历、职位、面试或其他招聘系统数据，也不能执行任何业务操作。
不要编造已查询到的数据、已发送通知或已变更的招聘状态。涉及查看或变更业务数据时，说明当前暂未接通业务数据，并建议用户到招聘后台完成操作。
回复将显示在飞书卡片中。只使用标题、加粗、无序或有序列表及普通段落这些 Markdown 格式。
根据语气和内容自然使用 1 至 3 个常见 Emoji；不要在每一行堆叠 Emoji。
不使用链接、图片、表格、代码块、HTML 标签或按钮。"""

CARD_ACTION_FEEDBACK_UP = "feedback_up"
CARD_ACTION_FEEDBACK_DOWN = "feedback_down"
CARD_ACTION_REGENERATE = "regenerate"
MAX_REPLY_CONTEXTS = 100


def normalize_card_callback_transport_frame(frame: object) -> None:
    """让当前 SDK 将卡片回传沿用已有的事件分派与响应通道。"""
    for header in getattr(frame, "headers", ()):
        if (
            getattr(header, "key", None) == HEADER_TYPE
            and getattr(header, "value", None) == MessageType.CARD.value
        ):
            header.value = MessageType.EVENT.value
            return


class CardCallbackLongConnectionClient(lark.ws.Client):
    """兼容 lark-oapi 1.7.3 未分派 CARD 帧的问题。"""

    async def _handle_data_frame(self, frame: object) -> None:
        normalize_card_callback_transport_frame(frame)
        await super()._handle_data_frame(frame)


@dataclass(frozen=True)
class ReplyContext:
    operator_open_id: str
    user_text: str


class ReplyContextStore:
    """仅为当前本地机器人进程保存卡片操作所需的最小上下文。"""

    def __init__(self, max_items: int = MAX_REPLY_CONTEXTS):
        self._max_items = max_items
        self._contexts: OrderedDict[str, ReplyContext] = OrderedDict()
        self._feedback: set[tuple[str, str, str]] = set()
        self._regenerating: set[str] = set()
        self._lock = Lock()

    def save(self, message_id: str, operator_open_id: str, user_text: str) -> None:
        with self._lock:
            self._contexts[message_id] = ReplyContext(operator_open_id, user_text)
            self._contexts.move_to_end(message_id)
            while len(self._contexts) > self._max_items:
                expired_message_id, _ = self._contexts.popitem(last=False)
                self._regenerating.discard(expired_message_id)
                self._feedback = {item for item in self._feedback if item[0] != expired_message_id}

    def record_feedback(self, message_id: str, operator_open_id: str, action: str) -> str:
        with self._lock:
            context = self._contexts.get(message_id)
            if not context or context.operator_open_id != operator_open_id:
                return "missing"

            feedback_key = (message_id, operator_open_id, action)
            if feedback_key in self._feedback:
                return "duplicate"
            self._feedback.add(feedback_key)
            return "accepted"

    def begin_regeneration(
        self, message_id: str, operator_open_id: str
    ) -> tuple[str, ReplyContext | None]:
        with self._lock:
            context = self._contexts.get(message_id)
            if not context or context.operator_open_id != operator_open_id:
                return "missing", None
            if message_id in self._regenerating:
                return "busy", None
            self._regenerating.add(message_id)
            return "ready", context

    def finish_regeneration(self, message_id: str) -> None:
        with self._lock:
            self._regenerating.discard(message_id)


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
        reply: Callable[[str, str], str | None],
        send_thinking_reply: Callable[[str], str | None],
        update_reply: Callable[[str, str, str], bool],
        generate_reply: Callable[[str], str],
        reply_contexts: ReplyContextStore,
        schedule: Callable[[Callable[[], None]], None],
    ):
        self._reply = reply
        self._send_thinking_reply = send_thinking_reply
        self._update_reply = update_reply
        self._generate_reply = generate_reply
        self._reply_contexts = reply_contexts
        self._schedule = schedule

    def handle(self, event: P2ImMessageReceiveV1) -> None:
        if should_reply(event):
            text = extract_text(event.event.message.content)
            if not text:
                return
            message_id = event.event.message.message_id
            self._reply_contexts.save(message_id, sender_open_id(event), text)
            thinking_message_id = self._send_thinking_reply(message_id)
            self._schedule(lambda: self._generate_and_update(message_id, thinking_message_id, text))

    def _generate_and_update(
        self, source_message_id: str, thinking_message_id: str | None, text: str
    ) -> None:
        try:
            reply = format_for_feishu_card(self._generate_reply(text))
            if not reply:
                raise ValueError("模型未返回可显示的文字")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            logger.warning("模型生成飞书回复失败：%s", type(exc).__name__)
            reply = LLM_UNAVAILABLE_REPLY

        if thinking_message_id and self._update_reply(
            thinking_message_id, source_message_id, reply
        ):
            return
        self._reply(source_message_id, reply)


def extract_text(content: str | None) -> str:
    if not content:
        return ""

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return ""

    text = payload.get("text")
    return text.strip() if isinstance(text, str) else ""


def sender_open_id(event: P2ImMessageReceiveV1) -> str:
    sender_id = getattr(event.event.sender, "sender_id", None)
    return getattr(sender_id, "open_id", "") or ""


def format_for_feishu_card(text: str) -> str:
    """保留常用 Markdown，同时阻断模型拼入卡片高级组件或外部链接。"""
    formatted = html.escape(text, quote=False).strip()
    formatted = re.sub(r"!?\[([^\]]*)\]\([^)]+\)", r"\1", formatted)
    return formatted


def build_reply_card(markdown: str, source_message_id: str) -> dict:
    def button(icon: str, hint: str, action: str) -> dict:
        return {
            "tag": "button",
            # 飞书卡片按钮的 text 为必填字段；空白文本让按钮只展示图标。
            "text": {"tag": "plain_text", "content": " "},
            "type": "text",
            "size": "small",
            "icon": {"tag": "standard_icon", "token": icon},
            "hover_tips": {"tag": "plain_text", "content": hint},
            "value": {"action": action, "source_message_id": source_message_id},
        }

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "body": {
            "elements": [
                {"tag": "markdown", "content": markdown},
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "horizontal_align": "right",
                    "horizontal_spacing": "8px",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                button("thumbsup_outlined", "有帮助", CARD_ACTION_FEEDBACK_UP)
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                button("thumbdown_outlined", "没帮助", CARD_ACTION_FEEDBACK_DOWN)
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                button("refresh_outlined", "重新生成", CARD_ACTION_REGENERATE)
                            ],
                        },
                    ],
                },
            ]
        },
    }


def build_thinking_card() -> dict:
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": "⏳ **正在思考并生成答案…**\n\n正在整理招聘建议，请稍候。",
                }
            ]
        },
    }


class OpenAICompatibleChat:
    def __init__(self, *, base_url: str, api_key: str, model: str):
        self._base_url = base_url
        self._api_key = api_key
        self._model = model

    def reply(self, user_text: str) -> str:
        return chat_completion(
            base_url=self._base_url,
            api_key=self._api_key,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_text=user_text,
            temperature=0.3,
            max_tokens=500,
        )


def send_interactive_card_reply(client: lark.Client, message_id: str, card: dict) -> str | None:
    request = (
        ReplyMessageRequest.builder()
        .message_id(message_id)
        .request_body(
            ReplyMessageRequestBody.builder()
            .msg_type("interactive")
            .content(json.dumps(card, ensure_ascii=False))
            .build()
        )
        .build()
    )
    response = client.im.v1.message.reply(request)
    if not response.success():
        logger.error("飞书机器人卡片回复失败：code=%s", response.code)
        return None
    return getattr(response.data, "message_id", None)


def send_card_reply(client: lark.Client, message_id: str, markdown: str) -> str | None:
    return send_interactive_card_reply(client, message_id, build_reply_card(markdown, message_id))


def send_thinking_card_reply(client: lark.Client, message_id: str) -> str | None:
    return send_interactive_card_reply(client, message_id, build_thinking_card())


def update_card_reply(
    client: lark.Client, card_message_id: str, source_message_id: str, markdown: str
) -> bool:
    request = (
        PatchMessageRequest.builder()
        .message_id(card_message_id)
        .request_body(
            PatchMessageRequestBody.builder()
            .content(json.dumps(build_reply_card(markdown, source_message_id), ensure_ascii=False))
            .build()
        )
        .build()
    )
    response = client.im.v1.message.patch(request)
    if not response.success():
        logger.error("飞书机器人卡片更新失败：code=%s", response.code)
        return False
    return True


def card_action_toast(content: str, toast_type: str = "success") -> P2CardActionTriggerResponse:
    return P2CardActionTriggerResponse({"toast": {"type": toast_type, "content": content}})


def run_in_background(task: Callable[[], None]) -> None:
    Thread(target=task, daemon=True).start()


class FeishuCardActionResponder:
    def __init__(
        self,
        reply: Callable[[str, str], None],
        generate_reply: Callable[[str], str],
        reply_contexts: ReplyContextStore,
        schedule: Callable[[Callable[[], None]], None] = run_in_background,
    ):
        self._reply = reply
        self._generate_reply = generate_reply
        self._reply_contexts = reply_contexts
        self._schedule = schedule

    def handle(self, event: P2CardActionTrigger) -> P2CardActionTriggerResponse:
        action_value = getattr(getattr(event.event, "action", None), "value", None)
        operator_open_id = getattr(getattr(event.event, "operator", None), "open_id", "") or ""
        if not isinstance(action_value, dict):
            return card_action_toast("操作无效，请重新提问。", "error")

        action = action_value.get("action")
        source_message_id = action_value.get("source_message_id")
        if not isinstance(source_message_id, str) or not operator_open_id:
            return card_action_toast("操作已过期，请重新提问。", "error")

        if action in (CARD_ACTION_FEEDBACK_UP, CARD_ACTION_FEEDBACK_DOWN):
            return self._handle_feedback(source_message_id, operator_open_id, action)
        if action == CARD_ACTION_REGENERATE:
            return self._handle_regenerate(source_message_id, operator_open_id)
        return card_action_toast("暂不支持此操作。", "error")

    def _handle_feedback(
        self, source_message_id: str, operator_open_id: str, action: str
    ) -> P2CardActionTriggerResponse:
        result = self._reply_contexts.record_feedback(source_message_id, operator_open_id, action)
        if result == "missing":
            return card_action_toast("这条回复已过期，请重新提问。", "error")
        if result == "duplicate":
            return card_action_toast("已收到你的反馈。")

        logger.info("收到飞书机器人回复反馈：%s", action)
        message = (
            "感谢认可，我会继续保持。"
            if action == CARD_ACTION_FEEDBACK_UP
            else "收到，我会努力改进回答。"
        )
        return card_action_toast(message)

    def _handle_regenerate(
        self, source_message_id: str, operator_open_id: str
    ) -> P2CardActionTriggerResponse:
        result, context = self._reply_contexts.begin_regeneration(
            source_message_id, operator_open_id
        )
        if result == "missing":
            return card_action_toast("这条回复已过期，请重新提问。", "error")
        if result == "busy":
            return card_action_toast("正在重新生成，请稍候。")

        self._schedule(lambda: self._regenerate(source_message_id, context))
        return card_action_toast("正在重新生成…")

    def _regenerate(self, source_message_id: str, context: ReplyContext | None) -> None:
        try:
            if context is None:
                return
            reply = format_for_feishu_card(self._generate_reply(context.user_text))
            if not reply:
                raise ValueError("模型未返回可显示的文字")
            self._reply(source_message_id, reply)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            logger.warning("飞书机器人重新生成失败：%s", type(exc).__name__)
            self._reply(source_message_id, LLM_UNAVAILABLE_REPLY)
        finally:
            self._reply_contexts.finish_regeneration(source_message_id)


def build_long_connection_client(
    app_id: str,
    app_secret: str,
    generate_reply: Callable[[str], str],
) -> lark.ws.Client:
    api_client = lark.Client.builder().app_id(app_id).app_secret(app_secret).build()
    reply_contexts = ReplyContextStore()
    responder = FeishuMessageResponder(
        lambda message_id, text: send_card_reply(api_client, message_id, text),
        lambda message_id: send_thinking_card_reply(api_client, message_id),
        lambda card_message_id, source_message_id, text: update_card_reply(
            api_client, card_message_id, source_message_id, text
        ),
        generate_reply,
        reply_contexts,
        run_in_background,
    )
    card_action_responder = FeishuCardActionResponder(
        lambda message_id, text: send_card_reply(api_client, message_id, text),
        generate_reply,
        reply_contexts,
    )
    event_handler = (
        lark.EventDispatcherHandler.builder("", "", lark.LogLevel.WARNING)
        .register_p2_im_message_receive_v1(responder.handle)
        .register_p2_card_action_trigger(card_action_responder.handle)
        .build()
    )
    return CardCallbackLongConnectionClient(
        app_id,
        app_secret,
        log_level=lark.LogLevel.WARNING,
        event_handler=event_handler,
    )
