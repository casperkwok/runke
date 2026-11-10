import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = ""
    company: str = ""
    title: str = ""
    gender: str = ""
    email: str = ""
    status: str = "lead"
    intent: str | None = None
    stage: str = "线索生成"
    owner: str = ""
    tags: list[Any] = Field(default_factory=list)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = None
    company: str | None = None
    title: str | None = None
    gender: str | None = None
    email: str | None = None
    status: str | None = None
    intent: str | None = None
    agent: str | None = None
    agent_type: str | None = None
    stage: str | None = None
    owner: str | None = None
    summary: str | None = None
    tags: list[Any] | None = None
    ai: dict[str, Any] | None = None
    records: list[Any] | None = None


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    phone: str
    company: str
    title: str
    gender: str
    email: str
    status: str
    intent: str | None
    agent: str
    agent_type: str
    stage: str
    owner: str
    summary: str
    tags: list[Any]
    ai: dict[str, Any]
    records: list[Any]
    created_at: datetime
    updated_at: datetime
