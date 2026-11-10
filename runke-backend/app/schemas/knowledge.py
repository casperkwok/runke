import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    kb_type: str = "text"


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    kb_type: str | None = None
    enabled: bool | None = None


class KnowledgeBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    kb_type: str
    enabled: bool
    owner_id: uuid.UUID
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class DocumentCreate(BaseModel):
    title: str = ""
    content: str = Field(min_length=1)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    title: str
    chunk_count: int
    created_at: datetime


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=20)
    mode: str = "semantic"  # semantic / fulltext / hybrid
    min_score: float = 0.0
    rerank: bool = False
    optimize: bool = False  # 问题优化：检索前用 LLM 结合历史改写查询
    history: list[str] = []  # 对话历史（最近的用户问题），用于问题优化


class Chunk(BaseModel):
    text: str
    score: float
    doc_id: str | None = None


class QueryResult(BaseModel):
    chunks: list[Chunk]
    optimized_query: str | None = None


class DocumentChunksOut(BaseModel):
    chunks: list[str]
