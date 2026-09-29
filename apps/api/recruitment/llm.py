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
) -> str:
    if not all((base_url, api_key, model)):
        raise LLMServiceError("模型服务尚未配置")

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_text},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        ).encode("utf-8"),
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
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
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
