import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

OrchestrationType = Literal["single", "workflow"]


class BotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    bot_role: str = ""
    welcome: str = ""
    avatar: str = ""
    orchestration_type: OrchestrationType = "single"
    system_prompt: str = ""
    knowledge_base_id: uuid.UUID | None = None


class BotUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    bot_role: str | None = None
    welcome: str | None = None
    avatar: str | None = None
    orchestration_type: OrchestrationType | None = None
    system_prompt: str | None = None
    examples: list[str] | None = None
    model: str | None = None
    model_params: dict[str, Any] | None = None
    capabilities: dict[str, bool] | None = None
    skill_ids: list[str] | None = None
    published: bool | None = None
    workflow_definition: dict[str, Any] | None = None
    workflow_exp: dict[str, Any] | None = None
    knowledge_base_id: uuid.UUID | None = None
    variables: list[Any] | None = None
    data_hooks: list[Any] | None = None
    context_enabled: bool | None = None
    context_template: str | None = None
    widget_enabled: bool | None = None
    widget_config: dict[str, Any] | None = None
    voice_config: dict[str, Any] | None = None


class BotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    bot_role: str
    welcome: str
    avatar: str
    owner_id: uuid.UUID
    orchestration_type: str
    system_prompt: str
    examples: list[str]
    model: str
    model_params: dict[str, Any]
    capabilities: dict[str, bool]
    skill_ids: list[str]
    published: bool
    workflow_definition: dict[str, Any]
    workflow_exp: dict[str, Any]
    knowledge_base_id: uuid.UUID | None
    variables: list[Any]
    data_hooks: list[Any]
    context_enabled: bool
    context_template: str
    widget_enabled: bool
    widget_config: dict[str, Any]
    voice_config: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ConversationCreate(BaseModel):
    title: str = ""
    # 创建会话时带入的初始变量（键可为 "candidate_id" 或 "session.candidate_id"）
    variables: dict[str, Any] = Field(default_factory=dict)
    # 关联客户 → 自动载入 {{customer.*}} 变量（供上下文注入引用）
    customer_id: uuid.UUID | None = None
    channel: str = "debug"


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bot_id: uuid.UUID
    title: str
    human: bool
    channel: str
    created_at: datetime


class MessageCreate(BaseModel):
    role: str = Field(default="user", pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    meta: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class CompletionRequest(BaseModel):
    content: str = Field(min_length=1)
    model: str | None = None  # 覆盖默认型号（如 deepseek-v4-pro）
