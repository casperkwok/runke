"""组织架构 Schema。"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeptCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None


class DeptUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None


class DeptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    sort: int


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = ""
    phone: str = ""
    role: str = ""
    department_id: uuid.UUID | None = None
    status: str = "joined"


class MemberUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    department_id: uuid.UUID | None = None
    status: str | None = None


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    department_id: uuid.UUID | None
    name: str
    email: str
    phone: str
    role: str
    status: str
    is_creator: bool
    created_at: datetime
