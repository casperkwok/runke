"""技能体系：Connector（数据接入）+ Skill（工具 / SOP）。

- Connector：注册一个外部 HTTP 接口（method + url + headers），工具技能据此真实调用。
- Skill(tool)：把一个连接器封装成可被 agent 调用的工具，声明入参/出参。
- Skill(sop)：把标准作业流程固化为技能（触发条件 + 步骤 + 关联工具/知识库），
  执行时作为提示词注入 + 关联工具一起交给 agent。
"""
import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Connector(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "connectors"

    name: Mapped[str] = mapped_column(String(120), index=True)
    method: Mapped[str] = mapped_column(String(10), default="GET")  # GET/POST/PUT/DELETE
    url: Mapped[str] = mapped_column(Text, default="")  # 支持 {{变量}} 占位
    headers: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    auth: Mapped[str] = mapped_column(String(40), default="无")  # 无/API Key/Bearer Token/OAuth 2.0
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )


class Skill(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "skills"

    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    skill_type: Mapped[str] = mapped_column(String(10), default="tool")  # tool / sop / builtin / bitable
    builtin: Mapped[str] = mapped_column(String(40), default="")  # builtin 动作 key（如 register_customer）
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # 自带配置（如飞书多维表格回写的 url/token/字段映射）
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # tool：关联连接器 + 入参/出参
    connector_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("connectors.id", ondelete="SET NULL"), nullable=True
    )
    inputs: Mapped[list[Any]] = mapped_column(JSONB, default=list)   # [{name,type,req,desc}]
    outputs: Mapped[list[Any]] = mapped_column(JSONB, default=list)  # [{name,type,desc}]

    # sop：触发条件 + 步骤 + 关联工具(技能id) + 关联知识库(kb id)
    trigger: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    tool_ids: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    kb_ids: Mapped[list[Any]] = mapped_column(JSONB, default=list)
