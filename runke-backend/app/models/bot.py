"""Bot：一个可对话的智能体配置载体。"""
import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

# 单 Agent 默认模型参数
DEFAULT_MODEL_PARAMS: dict[str, Any] = {
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 1024,
}
# 基础能力开关
DEFAULT_CAPABILITIES: dict[str, bool] = {
    "web": False,
    "image": False,
    "memory": False,
}


class Bot(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "bots"

    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    bot_role: Mapped[str] = mapped_column(Text, default="")  # 短角色标签（卡片副标题，纯展示）
    preset_key: Mapped[str] = mapped_column(String(40), default="")  # 命中内置预置 prompt 的 key（如 pet_doctor）
    welcome: Mapped[str] = mapped_column(Text, default="")  # 开场白
    avatar: Mapped[str] = mapped_column(String(255), default="")  # 头像 URL/资源
    # 语音配置(语音外呼/通话)：{enabled, voice_id, mode(call/message), outbound, barge_in}
    voice_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # 编排类型：single（单 Agent，model+harness）/ workflow（工作流图）
    orchestration_type: Mapped[str] = mapped_column(String(20), default="single")
    # 单 Agent：角色设定（system 提示）、引导问题、模型、参数、基础能力
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    examples: Mapped[list[str]] = mapped_column(JSONB, default=list)
    model: Mapped[str] = mapped_column(String(120), default="")
    model_params: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=lambda: dict(DEFAULT_MODEL_PARAMS)
    )
    capabilities: Mapped[dict[str, bool]] = mapped_column(
        JSONB, default=lambda: dict(DEFAULT_CAPABILITIES)
    )
    published: Mapped[bool] = mapped_column(Boolean, default=False)  # 发布状态
    # 绑定的技能（来自技能库，id 列表）
    skill_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # workflow 模式下的图定义（内嵌于 Bot）
    workflow_definition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # 工作流实验区（对话式编排 Copilot）：{graph, messages}。与正式定义完全隔离、永不回写。
    workflow_exp: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # 绑定知识库 → completion 时注入 rag_search 工具（Agentic RAG）
    knowledge_base_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True
    )
    # 全局配置 · 变量管理：[{name, scope(global/session), type, value}]
    variables: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # 全局配置 · 数据接入（本智能体的自动注入钩子）：
    #   [{connector_id, trigger(session_start/each_turn), mapping:[{from, to}]}]
    data_hooks: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # 全局配置 · 上下文注入：开关 + 模板（支持 {{变量}}，每轮拼到 system 提示词前）
    context_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    context_template: Mapped[str] = mapped_column(Text, default="")
    # 发布渠道 · 网站集成：悬浮小部件开关 + 样式配置 {title, color, logo, welcome}
    widget_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    widget_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="bot", cascade="all, delete-orphan"
    )


class Conversation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversations"

    bot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bots.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="")
    # 运行时变量存储（系统/全局/会话变量、数据钩子映射结果），键为 "scope.name"
    variables: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # 聊天管家：人工接管开关 + 来源渠道（web/api/debug/wx）
    human: Mapped[bool] = mapped_column(Boolean, default=False)
    channel: Mapped[str] = mapped_column(String(20), default="")

    bot: Mapped["Bot"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "messages"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))  # user / assistant / system
    content: Mapped[str] = mapped_column(Text)
    # 附加信息：工作流运行过程 trace/summary 等（供预览刷新后恢复调试过程）
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
