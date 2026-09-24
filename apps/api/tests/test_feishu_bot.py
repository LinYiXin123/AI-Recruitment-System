from types import SimpleNamespace
from unittest.mock import Mock

from recruitment.feishu_bot import (
    FeishuMessageResponder,
    extract_text,
    format_for_feishu_text,
    should_reply,
)


def incoming_event(
    *,
    chat_type="p2p",
    content='{"text": "你好"}',
    message_type="text",
    sender_type="user",
):
    return SimpleNamespace(
        event=SimpleNamespace(
            message=SimpleNamespace(
                chat_type=chat_type,
                content=content,
                message_type=message_type,
                message_id="om_test_message",
            ),
            sender=SimpleNamespace(sender_type=sender_type),
        )
    )


def test_private_text_from_user_receives_model_reply():
    reply = Mock()
    generate_reply = Mock(return_value="**可以帮你**\n- 安排面试\n- 整理招聘要求")

    FeishuMessageResponder(reply, generate_reply).handle(incoming_event())

    generate_reply.assert_called_once_with("你好")
    reply.assert_called_once_with("om_test_message", "可以帮你\n• 安排面试\n• 整理招聘要求")


def test_group_messages_and_non_user_events_do_not_receive_a_reply():
    reply = Mock()
    generate_reply = Mock()
    responder = FeishuMessageResponder(reply, generate_reply)

    responder.handle(incoming_event(chat_type="group"))
    responder.handle(incoming_event(sender_type="app"))

    reply.assert_not_called()
    generate_reply.assert_not_called()


def test_only_private_text_messages_are_eligible_for_reply():
    assert should_reply(incoming_event()) is True
    assert should_reply(incoming_event(message_type="image")) is False


def test_text_extraction_ignores_malformed_or_non_text_content():
    assert extract_text('{"text": "  招聘帮助  "}') == "招聘帮助"
    assert extract_text('{"image_key": "img"}') == ""
    assert extract_text("not-json") == ""


def test_markdown_reply_is_formatted_for_feishu_plain_text():
    assert (
        format_for_feishu_text("# 招聘建议\n\n**第一步**\n- 确认职位\n> 再安排面试\n---")
        == "招聘建议\n\n第一步\n• 确认职位\n再安排面试"
    )
