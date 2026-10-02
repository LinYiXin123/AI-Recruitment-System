import json
from unittest.mock import Mock, patch

import pytest

from recruitment.llm import LLMServiceError, chat_completion


@patch("recruitment.llm.urllib.request.urlopen")
def test_openai_compatible_request_uses_bearer_auth_and_returns_chat_content(urlopen):
    urlopen.return_value.__enter__.return_value = Mock(
        read=Mock(return_value=json.dumps({"choices": [{"message": {"content": "完成"}}]}))
    )
    result = chat_completion(
        base_url="https://model.example/v1/",
        api_key="unit-test-token",
        model="test-model",
        system_prompt="system",
        user_text="user",
        temperature=0.2,
        max_tokens=300,
    )

    request = urlopen.call_args.args[0]
    assert request.full_url == "https://model.example/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer unit-test-token"
    assert json.loads(request.data)["max_tokens"] == 300
    assert json.loads(request.data)["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
    ]
    assert result == "完成"


@patch("recruitment.llm.urllib.request.urlopen")
def test_length_limited_completion_is_reported_as_truncated(urlopen):
    urlopen.return_value.__enter__.return_value = Mock(
        read=Mock(
            return_value=json.dumps(
                {
                    "choices": [
                        {
                            "message": {"content": '{"summary":"未完成'},
                            "finish_reason": "length",
                        }
                    ]
                }
            )
        )
    )

    with pytest.raises(LLMServiceError, match="输出达到长度上限"):
        chat_completion(
            base_url="https://model.example/v1",
            api_key="unit-test-token",
            model="test-model",
            system_prompt="system",
            user_text="user",
            temperature=0.2,
            max_tokens=300,
        )


@patch("recruitment.llm.urllib.request.urlopen")
def test_optional_json_and_thinking_options_are_sent(urlopen):
    urlopen.return_value.__enter__.return_value = Mock(
        read=Mock(return_value=json.dumps({"choices": [{"message": {"content": "{}"}}]}))
    )
    chat_completion(
        base_url="https://model.example/v1",
        api_key="unit-test-token",
        model="test-model",
        system_prompt="只返回 JSON",
        user_text="内容",
        temperature=0.2,
        max_tokens=393_216,
        thinking={"type": "disabled"},
        response_format={"type": "json_object"},
    )

    payload = json.loads(urlopen.call_args.args[0].data)
    assert payload["thinking"] == {"type": "disabled"}
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["max_tokens"] == 393_216
