import json
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
    build_thinking_card,
    extract_text,
    format_for_feishu_card,
    normalize_card_callback_transport_frame,
    should_reply,
    update_card_reply,
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
    send_thinking_reply = Mock(return_value="om_thinking_card")
    update_reply = Mock(return_value=True)
    generate_reply = Mock(return_value="**可以帮你**\n- 安排面试\n- 整理招聘要求")
    contexts = ReplyContextStore()
    scheduled_tasks = []

    FeishuMessageResponder(
        reply,
        send_thinking_reply,
        update_reply,
        generate_reply,
        contexts,
        scheduled_tasks.append,
    ).handle(incoming_event())

    send_thinking_reply.assert_called_once_with("om_test_message")
    assert len(scheduled_tasks) == 1
    scheduled_tasks[0]()
    generate_reply.assert_called_once_with("你好")
    update_reply.assert_called_once_with(
        "om_thinking_card", "om_test_message", "**可以帮你**\n- 安排面试\n- 整理招聘要求"
    )
    reply.assert_not_called()


def test_group_messages_and_non_user_events_do_not_receive_a_reply():
    reply = Mock()
    send_thinking_reply = Mock()
    update_reply = Mock()
    generate_reply = Mock()
    contexts = ReplyContextStore()
    responder = FeishuMessageResponder(
        reply,
        send_thinking_reply,
        update_reply,
        generate_reply,
        contexts,
        Mock(),
    )

    responder.handle(incoming_event(chat_type="group"))
    responder.handle(incoming_event(sender_type="app"))

    reply.assert_not_called()
    send_thinking_reply.assert_not_called()
    update_reply.assert_not_called()
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


def test_card_callback_transport_frame_reuses_event_dispatching():
    frame = SimpleNamespace(
        headers=[
            SimpleNamespace(key="type", value="card"),
            SimpleNamespace(key="message_id", value="msg_123"),
        ]
    )

    normalize_card_callback_transport_frame(frame)

    assert frame.headers[0].value == "event"
    assert frame.headers[1].value == "msg_123"


def test_reply_card_contains_three_right_aligned_icon_actions():
    card = build_reply_card("**招聘建议**", "om_test_message")

    assert card["schema"] == "2.0"
    assert card["body"]["elements"][0] == {"tag": "markdown", "content": "**招聘建议**"}
    action_bar = card["body"]["elements"][1]
    assert action_bar["flex_mode"] == "none"
    assert action_bar["horizontal_align"] == "right"
    buttons = action_bar["columns"]
    assert [column["elements"][0]["value"]["action"] for column in buttons] == [
        CARD_ACTION_FEEDBACK_UP,
        CARD_ACTION_FEEDBACK_DOWN,
        CARD_ACTION_REGENERATE,
    ]
    assert [column["elements"][0]["icon"]["token"] for column in buttons] == [
        "thumbsup_outlined",
        "thumbdown_outlined",
        "refresh_outlined",
    ]
    assert all(column["width"] == "auto" for column in buttons)
    assert all(column["elements"][0]["text"]["content"] == " " for column in buttons)
    assert all(column["elements"][0]["type"] == "text" for column in buttons)


def test_thinking_card_has_a_clear_waiting_state():
    card = build_thinking_card()

    assert card["body"]["elements"][0]["content"] == (
        "⏳ **正在思考并生成答案…**\n\n正在整理招聘建议，请稍候。"
    )


def test_thinking_card_is_updated_with_the_patch_message_api():
    client = Mock()
    client.im.v1.message.patch.return_value = SimpleNamespace(success=lambda: True)

    updated = update_card_reply(client, "om_thinking_card", "om_source", "**招聘建议**")

    assert updated is True
    request = client.im.v1.message.patch.call_args.args[0]
    assert request.message_id == "om_thinking_card"
    assert json.loads(request.request_body.content)["body"]["elements"][0] == {
        "tag": "markdown",
        "content": "**招聘建议**",
    }
    client.im.v1.message.update.assert_not_called()


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
