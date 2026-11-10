"""CustomerPack：客户资源包（分组/名单）。

kind:
- file ：文件导入（CSV/Excel）产生的名单，成员显式存于 customer_pack_members
- group：手动分组，成员显式存储
- rule ：规则筛选，成员由 rule 动态计算（rule 存筛选条件）
"""
import uuid
from typing import Any

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

# 资源包 ↔ 客户 多对多成员表（file/group 类型显式成员）
customer_pack_members = Table(
    "customer_pack_members",
    Base.metadata,
    Column("pack_id", ForeignKey("customer_packs.id", ondelete="CASCADE"), primary_key=True),
    Column("customer_id", ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True),
)


class CustomerPack(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "customer_packs"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="file")  # file/group/rule
    rule: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # rule 类型的筛选条件
