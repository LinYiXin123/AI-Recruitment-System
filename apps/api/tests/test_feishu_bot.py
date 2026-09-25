from types import SimpleNamespace
from unittest.mock import Mock

from recruitment.feishu_bot import (
    CARD_ACTION_FEEDBACK_DOWN,
    CARD_ACTION_FEEDBACK_UP,
    CARD_ACTION_REGENERATE,
    FeishuCardActionResponder,
    FeishuMessageResponder,
    ReplyContextStore,
    build_reply_card,
    extract_text,
    format_for_feishu_card,
    should_reply,
)


def incoming_event(
    *,
    chat_type="p2p",
    content='{"text": "你好"}',
    message_type="text",
    sender_type="user",
    sender_open_id="ou_user",
):
    return SimpleNamespace(
        event=SimpleNamespace(
            message=SimpleNamespace(
                chat_type=chat_type,
                content=content,
                message_type=message_type,
                message_id="om_test_message",
            ),
            sender=SimpleNamespace(
                sender_type=sender_type,
                sender_id=SimpleNamespace(open_id=sender_open_id),
            ),
        )
    )


def card_action_event(action, *, source_message_id="om_test_message", operator_open_id="ou_user"):
    return SimpleNamespace(
        event=SimpleNamespace(
            action=SimpleNamespace(
                value={"action": action, "source_message_id": source_message_id}
            ),
            operator=SimpleNamespace(open_id=operator_open_id),
        )
    )


def test_private_text_from_user_receives_markdown_card_content():
    reply = Mock()
    generate_reply = Mock(return_value="**可以帮你**\n- 安排面试\n- 整理招聘要求")
    contexts = ReplyContextStore()

    FeishuMessageResponder(reply, generate_reply, contexts).handle(incoming_event())

    generate_reply.assert_called_once_with("你好")
    reply.assert_called_once_with("om_test_message", "**可以帮你**\n- 安排面试\n- 整理招聘要求")


def test_group_messages_and_non_user_events_do_not_receive_a_reply():
    reply = Mock()
    generate_reply = Mock()
    contexts = ReplyContextStore()
    responder = FeishuMessageResponder(reply, generate_reply, contexts)

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


def test_card_markdown_keeps_formatting_and_blocks_links_or_card_tags():
    assert (
        format_for_feishu_card(
            "**标题**\n- 确认职位\n[官网](https://example.com)\n<button>危险</button>"
        )
        == "**标题**\n- 确认职位\n官网\n&lt;button&gt;危险&lt;/button&gt;"
    )


def test_reply_card_contains_three_expected_actions():
    card = build_reply_card("**招聘建议**", "om_test_message")

    assert card["schema"] == "2.0"
    assert card["body"]["elements"][0] == {"tag": "markdown", "content": "**招聘建议**"}
    buttons = card["body"]["elements"][2]["columns"]
    assert [column["elements"][0]["value"]["action"] for column in buttons] == [
        CARD_ACTION_FEEDBACK_UP,
        CARD_ACTION_FEEDBACK_DOWN,
        CARD_ACTION_REGENERATE,
    ]


def test_feedback_is_recorded_once_for_the_original_private_user():
    contexts = ReplyContextStore()
    contexts.save("om_test_message", "ou_user", "你好")
    responder = FeishuCardActionResponder(Mock(), Mock(), contexts)

    accepted = responder.handle(card_action_event(CARD_ACTION_FEEDBACK_UP))
    duplicate = responder.handle(card_action_event(CARD_ACTION_FEEDBACK_UP))
    other_user = responder.handle(
        card_action_event(CARD_ACTION_FEEDBACK_DOWN, operator_open_id="ou_other")
    )

    assert accepted.toast.content == "感谢认可，我会继续保持。"
    assert duplicate.toast.content == "已收到你的反馈。"
    assert other_user.toast.type == "error"


def test_regenerate_runs_once_in_background_and_replies_to_original_question():
    contexts = ReplyContextStore()
    contexts.save("om_test_message", "ou_user", "怎么安排一面？")
    reply = Mock()
    generate_reply = Mock(return_value="**一面准备**\n- 确认岗位要求")
    scheduled_tasks = []
    responder = FeishuCardActionResponder(reply, generate_reply, contexts, scheduled_tasks.append)

    started = responder.handle(card_action_event(CARD_ACTION_REGENERATE))
    repeated = responder.handle(card_action_event(CARD_ACTION_REGENERATE))

    assert started.toast.content == "正在重新生成…"
    assert repeated.toast.content == "正在重新生成，请稍候。"
    assert len(scheduled_tasks) == 1

    scheduled_tasks[0]()

    generate_reply.assert_called_once_with("怎么安排一面？")
    reply.assert_called_once_with("om_test_message", "**一面准备**\n- 确认岗位要求")
