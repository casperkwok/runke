"""语音外呼任务 / 通话记录 Schema。"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---- 外呼任务 ----
class CallTaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    bot_id: uuid.UUID
    voice_id: uuid.UUID | None = None
    pack_id: uuid.UUID | None = None
    note: str = ""


class CallTaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    voice_id: uuid.UUID | None = None
    pack_id: uuid.UUID | None = None
    status: str | None = None
    note: str | None = None


class CallTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    bot_id: uuid.UUID
    voice_id: uuid.UUID | None
    pack_id: uuid.UUID | None
    status: str
    total: int
    connected: int
    done: int
    note: str
    bot_name: str = ""
    pack_name: str = ""
    voice_name: str = ""
    created_at: datetime


# ---- 通话记录 ----
class CallTurn(BaseModel):
    who: str  # me / bot
    text: str


class CallRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    bot_id: uuid.UUID | None
    task_id: uuid.UUID | None
    conversation_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    phone: str
    contact: str
    direction: str
    status: str
    duration_sec: int
    summary: str
    intent: str
    bot_name: str = ""
    task_name: str = ""
    created_at: datetime


class CallRecordDetail(CallRecordOut):
    transcript: list[CallTurn] = []
