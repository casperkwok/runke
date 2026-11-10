import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    definition: dict[str, Any] = Field(default_factory=dict)


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    definition: dict[str, Any] | None = None


class WorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    definition: dict[str, Any]
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class RunCreate(BaseModel):
    input: str = ""


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    status: str
    input: str
    output: str
    trace: list[Any]
    created_at: datetime
