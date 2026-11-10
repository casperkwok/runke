"""组织架构：部门树（Department）+ 成员（Member），按账号(owner)隔离。"""
import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Department(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "departments"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Member(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "members"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    role: Mapped[str] = mapped_column(String(120), default="")  # 职务
    status: Mapped[str] = mapped_column(String(20), default="joined")  # joined / pending
    is_creator: Mapped[bool] = mapped_column(Boolean, default=False)
