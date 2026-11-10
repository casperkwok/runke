import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiTokenCreate(BaseModel):
    name: str = Field(default="Runke-Token", max_length=120)
    expires_at: datetime | None = None


class ApiTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bot_id: uuid.UUID
    name: str
    prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime


class ApiTokenCreated(ApiTokenOut):
    """创建时一次性返回明文 key。"""

    key: str
