"""RAGProvider 默认实现：LlamaIndex + pgvector + fastembed。

- 单一向量表，所有知识库共用，按 metadata `kb_id` 过滤。
- embedding 用 fastembed（ONNX，无 torch）。
- 同步实现；异步服务层用 anyio.to_thread 包装调用，避免阻塞事件循环。
"""
from functools import lru_cache

from llama_index.core import Document as LIDocument
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.vector_stores import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)
from llama_index.embeddings.fastembed import FastEmbedEmbedding
from llama_index.vector_stores.postgres import PGVectorStore
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.rag.provider import RAGProvider, RetrievedChunk

_TABLE = "rag_chunks"
_CHUNK_SIZE = 512
_CHUNK_OVERLAP = 64


def chunk_text(text: str, kb_type: str = "text") -> list[str]:
    """按知识库类型差异化分块：
    - text : 句子分块（SentenceSplitter）
    - qa   : 按空行切成问答块，每块一段
    - table: 每行一条记录，自动带上表头作为上下文
    """
    text = (text or "").strip()
    if not text:
        return []
    if kb_type == "qa":
        import re

        blocks = re.split(r"\n\s*\n+", text)
        return [b.strip() for b in blocks if b.strip()]
    if kb_type == "table":
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if len(lines) <= 1:
            return lines
        header = lines[0]
        return [f"{header}\n{row}" for row in lines[1:]]
    splitter = SentenceSplitter(chunk_size=_CHUNK_SIZE, chunk_overlap=_CHUNK_OVERLAP)
    nodes = splitter.get_nodes_from_documents([LIDocument(text=text)])
    return [n.get_content(metadata_mode="none") for n in nodes]


def split_text(text: str, kb_type: str = "text") -> list[str]:
    """兼容旧调用（段落视图）。"""
    return chunk_text(text, kb_type)


@lru_cache
def _embed_model() -> FastEmbedEmbedding:
    return FastEmbedEmbedding(model_name=settings.embedding_model)


@lru_cache
def _reranker():
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    return TextCrossEncoder(model_name=settings.rerank_model)


def rerank_scores(query: str, texts: list[str]) -> list[float]:
    """对候选文本做 cross-encoder 重排，返回与 texts 等长的相关性分数。"""
    if not texts:
        return []
    return list(_reranker().rerank(query, texts))


@lru_cache
def _vector_store() -> PGVectorStore:
    url = make_url(settings.database_url)
    return PGVectorStore.from_params(
        database=url.database,
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        table_name=_TABLE,
        embed_dim=settings.embedding_dim,
    )


@lru_cache
def _index() -> VectorStoreIndex:
    storage = StorageContext.from_defaults(vector_store=_vector_store())
    return VectorStoreIndex.from_vector_store(
        _vector_store(), storage_context=storage, embed_model=_embed_model()
    )


class LlamaIndexPGVectorProvider(RAGProvider):
    def ingest(
        self,
        kb_id: str,
        doc_id: str,
        text: str,
        metadata: dict | None = None,
        kb_type: str = "text",
    ) -> int:
        from llama_index.core.schema import TextNode

        meta = {"kb_id": kb_id, "doc_id": doc_id, **(metadata or {})}
        chunks = chunk_text(text, kb_type)
        nodes = [TextNode(text=c, metadata=dict(meta)) for c in chunks]
        for n in nodes:
            n.embedding = _embed_model().get_text_embedding(
                n.get_content(metadata_mode="none")
            )
        if nodes:
            _vector_store().add(nodes)
        return len(nodes)

    def retrieve(
        self, kb_id: str, query: str, top_k: int | None = None
    ) -> list[RetrievedChunk]:
        filters = MetadataFilters(
            filters=[MetadataFilter(key="kb_id", value=kb_id, operator=FilterOperator.EQ)]
        )
        retriever = _index().as_retriever(
            similarity_top_k=top_k or settings.rag_top_k, filters=filters
        )
        results = retriever.retrieve(query)
        return [
            RetrievedChunk(text=r.get_content(), score=r.score or 0.0, metadata=r.metadata)
            for r in results
        ]

    def delete_document(self, kb_id: str, doc_id: str) -> None:
        _vector_store().delete_nodes(
            filters=MetadataFilters(
                filters=[
                    MetadataFilter(key="kb_id", value=kb_id, operator=FilterOperator.EQ),
                    MetadataFilter(key="doc_id", value=doc_id, operator=FilterOperator.EQ),
                ]
            )
        )


@lru_cache
def get_provider() -> RAGProvider:
    return LlamaIndexPGVectorProvider()
