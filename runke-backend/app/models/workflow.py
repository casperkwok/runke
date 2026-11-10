"""Workflow（编排定义）与 WorkflowRun（一次运行）。

definition 以 JSON 持久化：{entry, nodes:{id:{type,...,next|branches}}}，
由 workflows/engine.py 编译为 LangGraph StateGraph 执行。
"""
import uuid
from typing import Any

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Workflow(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workflows"

    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    runs: Mapped[list["WorkflowRun"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan"
    )


class WorkflowRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workflow_runs"

    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/running/done/error
    input: Mapped[str] = mapped_column(Text, default="")
    output: Mapped[str] = mapped_column(Text, default="")
    trace: Mapped[list[Any]] = mapped_column(JSONB, default=list)

    workflow: Mapped["Workflow"] = relationship(back_populates="runs")
