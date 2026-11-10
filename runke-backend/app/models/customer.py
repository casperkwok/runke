"""Customer：CRM 客户记录。

跟进记录 / 标签 / AI 标记 以 JSONB 内嵌（与前端抽屉的整体保存模型一致）：
- tags: ["电商", "高意向"]
- ai: {"company": true, "title": true}  字段级 AI 自动填充标记
- records: [{type: ai/human, text, time}]
"""
import uuid
from typing import Any

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Customer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "customers"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(120), default="")
    gender: Mapped[str] = mapped_column(String(10), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="lead")  # lead/intent/deal/lost
    intent: Mapped[str | None] = mapped_column(String(4), nullable=True)  # A/B/C/D
    agent: Mapped[str] = mapped_column(String(120), default="")  # 最后触达智能体名
    agent_type: Mapped[str] = mapped_column(String(10), default="")  # phone/chat
    stage: Mapped[str] = mapped_column(String(40), default="线索生成")  # 跟进阶段
    owner: Mapped[str] = mapped_column(String(80), default="")  # 负责人(销售)
    summary: Mapped[str] = mapped_column(Text, default="")  # AI 摘要
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    ai: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    records: Mapped[list[Any]] = mapped_column(JSONB, default=list)
