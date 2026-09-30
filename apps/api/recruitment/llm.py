import json
import urllib.error
import urllib.request


class LLMServiceError(OSError):
    pass


def chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_text: str,
    temperature: float,
    max_tokens: int,
    thinking: dict | None = None,
    response_format: dict | None = None,
) -> str:
    if not all((base_url, api_key, model)):
        raise LLMServiceError("模型服务尚未配置")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if thinking is not None:
        payload["thinking"] = thinking
    if response_format is not None:
        payload["response_format"] = response_format

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise LLMServiceError(f"模型服务返回 HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LLMServiceError("模型服务网络连接失败或超时") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LLMServiceError("模型服务返回内容无法读取") from exc

    try:
        choice = payload["choices"][0]
        if choice.get("finish_reason") == "length":
            raise LLMServiceError("模型输出达到长度上限，回复可能被截断")
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise LLMServiceError("模型服务未返回有效内容") from exc

    if isinstance(content, list):
        content = "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    if not isinstance(content, str) or not content.strip():
        raise LLMServiceError("模型服务未返回文字内容")
    return content.strip()
