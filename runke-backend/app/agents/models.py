"""LLM provider 适配层。当前接 DeepSeek（OpenAI 兼容）。

未来加 provider 时在此扩展 build_chat_model 的分支，上层 AgentRuntime 不感知。
"""
from functools import lru_cache
from typing import Any

from langchain_openai import ChatOpenAI

from app.core.config import settings

# 前端展示型号 → 实际后端模型 id 的映射。未命中则按真实 id 透传。
MODEL_ALIASES: dict[str, str] = {
    "RunkeAI 4.0": "deepseek-v4-pro",
    "RunkeAI 3.5": "deepseek-v4-flash",
    "精调销售大模型高级版": "deepseek-v4-pro",
}


def resolve_model_id(model: str | None) -> str:
    if not model:
        return settings.llm_default_model
    return MODEL_ALIASES.get(model, model)


def build_chat_model(
    model: str | None = None,
    *,
    params: dict[str, Any] | None = None,
    streaming: bool = True,
) -> ChatOpenAI:
    params = params or {}
    model_id = resolve_model_id(model)
    return _cached_chat_model(
        model_id,
        params.get("temperature", settings.llm_temperature),
        params.get("top_p"),
        params.get("max_tokens"),
        streaming,
    )


# 实例缓存：ChatOpenAI 每次新建都会另起 HTTP 客户端，下一次调用要重新 TCP+TLS 握手
# （实测对 DashScope/DeepSeek 多花 100-200ms 首 token）。同参数复用同一实例，连接池保活。
@lru_cache(maxsize=64)
def _cached_chat_model(
    model_id: str,
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    streaming: bool,
) -> ChatOpenAI:
    # qwen* → 阿里百炼 DashScope；其余 → DeepSeek
    if model_id.startswith("qwen"):
        api_key, base_url = settings.qwen_api_key, settings.qwen_base_url
        if not api_key:
            raise RuntimeError("未配置 QWEN_API_KEY，无法调用通义千问（见 .env）")
    else:
        api_key, base_url = settings.deepseek_api_key, settings.deepseek_base_url
        if not api_key:
            raise RuntimeError("未配置 DEEPSEEK_API_KEY，无法调用 LLM（见 .env）")
    kwargs: dict[str, Any] = {
        "model": model_id,
        "api_key": api_key,
        "base_url": base_url,
        "temperature": temperature,
        "streaming": streaming,
    }
    if top_p is not None:
        kwargs["top_p"] = top_p
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)


@lru_cache
def default_chat_model() -> ChatOpenAI:
    return build_chat_model()
