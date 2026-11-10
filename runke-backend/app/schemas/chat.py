import uuid
from datetime import datetime

from pydantic import BaseModel


class InboxItem(BaseModel):
    id: uuid.UUID
    name: str
    channel: str
    human: bool
    intent: str | None
    preview: str
    last_at: datetime | None
    msg_count: int


class TakeoverRequest(BaseModel):
    human: bool


class HumanReplyRequest(BaseModel):
    content: str
