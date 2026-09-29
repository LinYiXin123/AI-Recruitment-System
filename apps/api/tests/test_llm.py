import json
from unittest.mock import Mock, patch

from recruitment.llm import chat_completion


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
    assert json.loads(request.data)["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
    ]
    assert result == "完成"
