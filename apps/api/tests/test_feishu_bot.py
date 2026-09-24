from types import SimpleNamespace
from unittest.mock import Mock

from recruitment.feishu_bot import LOCAL_CONNECTION_REPLY, FeishuMessageResponder, should_reply


def incoming_event(*, chat_type="p2p", message_type="text", sender_type="user"):
    return SimpleNamespace(
        event=SimpleNamespace(
            message=SimpleNamespace(
                chat_type=chat_type,
                message_type=message_type,
                message_id="om_test_message",
            ),
            sender=SimpleNamespace(sender_type=sender_type),
        )
    )


def test_private_text_from_user_receives_local_connection_reply():
    reply = Mock()

    FeishuMessageResponder(reply).handle(incoming_event())

    reply.assert_called_once_with("om_test_message", LOCAL_CONNECTION_REPLY)


def test_group_messages_and_non_user_events_do_not_receive_a_reply():
    reply = Mock()
    responder = FeishuMessageResponder(reply)

    responder.handle(incoming_event(chat_type="group"))
    responder.handle(incoming_event(sender_type="app"))

    reply.assert_not_called()


def test_only_private_text_messages_are_eligible_for_reply():
    assert should_reply(incoming_event()) is True
    assert should_reply(incoming_event(message_type="image")) is False
