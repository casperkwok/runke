"""语音外呼任务(CallTask) + 通话记录(CallRecord)。

- CallTask：一次外呼活动，绑定语音智能体 + 目标资源包(客户)，管理状态/进度。
- CallRecord：单通通话，关联 Runke 会话(对话内容即转写)，记录方向/状态/时长/纪要/意向。
  语音预览/外呼通话结束(finalize)时自动生成。
"""
import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CallTask(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "call_tasks"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    bot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bots.id", ondelete="CASCADE"))
    voice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("voices.id", ondelete="SET NULL"), nullable=True
    )  # 不填则用 bot.voice_config 的音色
    pack_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_packs.id", ondelete="SET NULL"), nullable=True
    )
    # draft / running / paused / done / canceled
    status: Mapped[str] = mapped_column(String(20), default="draft")
    total: Mapped[int] = mapped_column(Integer, default=0)       # 目标总数
    connected: Mapped[int] = mapped_column(Integer, default=0)   # 已接通
    done: Mapped[int] = mapped_column(Integer, default=0)        # 已拨打
    note: Mapped[str] = mapped_column(Text, default="")


class CallRecord(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "call_records"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bots.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("call_tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    contact: Mapped[str] = mapped_column(String(120), default="")  # 联系人/候选人名
    direction: Mapped[str] = mapped_column(String(16), default="preview")  # outbound / inbound / preview
    status: Mapped[str] = mapped_column(String(16), default="completed")   # completed / no_answer / failed
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(Text, default="")
    intent: Mapped[str] = mapped_column(String(40), default="")  # 意向(如 意向面试/待跟进/无意向)
    # 转写快照（若无关联会话时用；有会话则详情读会话消息）
    transcript: Mapped[list[Any]] = mapped_column(JSONB, default=list)
