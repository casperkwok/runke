import uuid
from typing import Any

from pydantic import BaseModel, Field


class PublicBotOut(BaseModel):
    """网站小部件用的公开 Bot 信息（不含敏感配置）。"""

    id: uuid.UUID
    name: str
    avatar: str
    welcome: str
    examples: list[str]
    widget_config: dict[str, Any]


class PublicChatRequest(BaseModel):
    content: str = Field(min_length=1)
    conversation_id: uuid.UUID | None = None
