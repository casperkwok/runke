"""应用配置：pydantic-settings，全部来自环境变量 / .env。绝不硬编码密钥。"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # 应用
    app_name: str = "Runke"
    env: str = "dev"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    # 数据库 (PostgreSQL + pgvector)
    database_url: str = Field(
        default="postgresql+asyncpg://runke:runke@localhost:5432/runke",
        description="async SQLAlchemy DSN",
    )
    db_echo: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # 鉴权 (JWT)
    jwt_secret: str = Field(default="change-me-in-env", description="JWT 签名密钥，生产必须改")
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 14

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # LLM (DeepSeek，OpenAI 兼容)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    # 通义千问 (阿里百炼 DashScope，OpenAI 兼容)——语音低延迟首选 qwen-flash
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    # 当前型号：deepseek-v4-flash(快/默认) / deepseek-v4-pro(更强)。旧 deepseek-chat 已废弃。
    llm_default_model: str = "deepseek-v4-flash"
    llm_temperature: float = 0.3

    # 火山 TTS（音色试听 / 语音合成，与 voice-agent 共用同一密钥）
    volc_tts_api_key: str = ""
    volc_tts_resource_id: str = "seed-tts-2.0"

    # RAG —— 本地 embedding（fastembed/ONNX，无需 torch）
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    embedding_dim: int = 512
    rag_top_k: int = 4
    # 结果重排（cross-encoder，ONNX，首次使用按需下载；多语言）
    rerank_model: str = "BAAI/bge-reranker-base"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
