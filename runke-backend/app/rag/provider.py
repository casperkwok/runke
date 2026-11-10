"""RAGProvider 抽象：上层（rag_search 工具 / 查询端点）只依赖此接口。

默认实现 llamaindex_pgvector；未来可替换为 LightRAG 等而不动上层。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RetrievedChunk:
    text: str
    score: float
    metadata: dict


class RAGProvider(ABC):
    @abstractmethod
    def ingest(self, kb_id: str, doc_id: str, text: str, metadata: dict | None = None) -> int:
        """把一篇文档分块、embedding、写入向量库。返回写入的 chunk 数。"""

    @abstractmethod
    def retrieve(self, kb_id: str, query: str, top_k: int | None = None) -> list[RetrievedChunk]:
        """在指定知识库内检索 top_k 片段。"""

    @abstractmethod
    def delete_document(self, kb_id: str, doc_id: str) -> None:
        """删除某文档的所有向量。"""
