import json
import logging
from collections.abc import Callable

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    P2ImMessageReceiveV1,
    ReplyMessageRequest,
    ReplyMessageRequestBody,
)

logger = logging.getLogger(__name__)

LOCAL_CONNECTION_REPLY = "你好，我是知遇 AI 招聘助手。本地消息服务已连接；招聘问答正在接入。"


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
    def __init__(self, reply: Callable[[str, str], None]):
        self._reply = reply

    def handle(self, event: P2ImMessageReceiveV1) -> None:
        if should_reply(event):
            self._reply(event.event.message.message_id, LOCAL_CONNECTION_REPLY)


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


def build_long_connection_client(app_id: str, app_secret: str) -> lark.ws.Client:
    api_client = lark.Client.builder().app_id(app_id).app_secret(app_secret).build()
    responder = FeishuMessageResponder(
        lambda message_id, text: send_text_reply(api_client, message_id, text)
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
