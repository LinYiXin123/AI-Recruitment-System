from types import SimpleNamespace
from unittest.mock import Mock

from recruitment.feishu_bot import FeishuMessageResponder, extract_text, should_reply


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
    generate_reply = Mock(return_value="你好，有什么招聘问题需要帮助？")

    FeishuMessageResponder(reply, generate_reply).handle(incoming_event())

    generate_reply.assert_called_once_with("你好")
    reply.assert_called_once_with("om_test_message", "你好，有什么招聘问题需要帮助？")


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
