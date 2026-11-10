"""知识库与文档。向量/分块由 llama-index 在独立 pgvector 表(data_rag_chunks)管理。"""
import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class KnowledgeBase(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_bases"

    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    kb_type: Mapped[str] = mapped_column(String(20), default="text")  # text/table/qa
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    documents: Mapped[list["Document"]] = relationship(
        back_populates="knowledge_base", cascade="all, delete-orphan"
    )


class Document(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "documents"

    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text)  # 原文留存（向量在 pgvector 表）
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)

    knowledge_base: Mapped["KnowledgeBase"] = relationship(back_populates="documents")
