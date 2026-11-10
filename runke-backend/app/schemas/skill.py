import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---- Connector（数据接入）----
class ConnectorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    method: str = "GET"
    url: str = ""
    headers: dict[str, Any] = {}
    auth: str = "无"


class ConnectorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    method: str | None = None
    url: str | None = None
    headers: dict[str, Any] | None = None
    auth: str | None = None
    enabled: bool | None = None


class ConnectorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    method: str
    url: str
    headers: dict[str, Any]
    auth: str
    enabled: bool
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# ---- Skill（工具 / SOP）----
class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    skill_type: str = "tool"  # tool / sop / builtin / bitable
    builtin: str = ""
    connector_id: uuid.UUID | None = None
    inputs: list[Any] = []
    outputs: list[Any] = []
    trigger: str = ""
    steps: list[Any] = []
    tool_ids: list[Any] = []
    kb_ids: list[Any] = []
    config: dict[str, Any] = {}


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    enabled: bool | None = None
    connector_id: uuid.UUID | None = None
    inputs: list[Any] | None = None
    outputs: list[Any] | None = None
    trigger: str | None = None
    steps: list[Any] | None = None
    tool_ids: list[Any] | None = None
    kb_ids: list[Any] | None = None
    config: dict[str, Any] | None = None


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    skill_type: str
    builtin: str
    enabled: bool
    owner_id: uuid.UUID
    connector_id: uuid.UUID | None
    inputs: list[Any]
    outputs: list[Any]
    trigger: str
    steps: list[Any]
    tool_ids: list[Any]
    kb_ids: list[Any]
    config: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime


class SkillTestRequest(BaseModel):
    args: dict[str, Any] = {}


class SkillTestResult(BaseModel):
    ok: bool
    status: int | None = None
    result: Any = None
    error: str | None = None
