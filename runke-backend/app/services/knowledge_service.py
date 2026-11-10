"""知识库/文档业务：CRUD + ingest/检索（阻塞的 RAG 调用走线程池）。"""
import uuid

import anyio
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import Document, KnowledgeBase
from app.rag.llamaindex_pgvector import get_provider
from app.schemas.knowledge import (
    Chunk,
    DocumentCreate,
    KnowledgeBaseCreate,
    KnowledgeBaseUpdate,
    QueryResult,
)


async def _owned_kb(session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID) -> KnowledgeBase:
    kb = await session.get(KnowledgeBase, kb_id)
    if kb is None or kb.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")
    return kb


async def _attach_doc_count(session: AsyncSession, kb: KnowledgeBase) -> KnowledgeBase:
    cnt = await session.scalar(
        select(func.count()).select_from(Document).where(Document.knowledge_base_id == kb.id)
    )
    kb.document_count = int(cnt or 0)  # type: ignore[attr-defined]
    return kb


async def list_kbs(
    session: AsyncSession, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[KnowledgeBase], int]:
    total = await session.scalar(
        select(func.count()).select_from(KnowledgeBase).where(KnowledgeBase.owner_id == owner_id)
    )
    rows = (
        await session.execute(
            select(KnowledgeBase)
            .where(KnowledgeBase.owner_id == owner_id)
            .order_by(KnowledgeBase.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    for kb in rows:
        await _attach_doc_count(session, kb)
    return list(rows), int(total or 0)


async def create_kb(
    session: AsyncSession, owner_id: uuid.UUID, data: KnowledgeBaseCreate
) -> KnowledgeBase:
    kb = KnowledgeBase(owner_id=owner_id, **data.model_dump())
    session.add(kb)
    await session.commit()
    await session.refresh(kb)
    return await _attach_doc_count(session, kb)


async def get_kb(session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID) -> KnowledgeBase:
    kb = await _owned_kb(session, kb_id, owner_id)
    return await _attach_doc_count(session, kb)


async def update_kb(
    session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID, data: KnowledgeBaseUpdate
) -> KnowledgeBase:
    kb = await _owned_kb(session, kb_id, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(kb, k, v)
    await session.commit()
    await session.refresh(kb)
    return await _attach_doc_count(session, kb)


async def delete_kb(session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    kb = await _owned_kb(session, kb_id, owner_id)
    # 清理该 kb 下所有文档的向量
    docs = (
        await session.execute(select(Document).where(Document.knowledge_base_id == kb_id))
    ).scalars().all()
    for d in docs:
        await anyio.to_thread.run_sync(get_provider().delete_document, str(kb_id), str(d.id))
    await session.delete(kb)
    await session.commit()


async def _ingest_document(
    session: AsyncSession, kb: KnowledgeBase, title: str, content: str
) -> Document:
    doc = Document(knowledge_base_id=kb.id, title=title, content=content)
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    # 阻塞的 embedding/写库放线程池；按知识库类型差异化分块
    chunks = await anyio.to_thread.run_sync(
        get_provider().ingest, str(kb.id), str(doc.id), content, None, kb.kb_type
    )
    doc.chunk_count = chunks
    await session.commit()
    await session.refresh(doc)
    return doc


async def add_document(
    session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID, data: DocumentCreate
) -> Document:
    kb = await _owned_kb(session, kb_id, owner_id)
    return await _ingest_document(session, kb, data.title, data.content)


async def add_document_file(
    session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID, filename: str, raw: bytes
) -> Document:
    kb = await _owned_kb(session, kb_id, owner_id)
    from app.rag.parse import UnsupportedFileError, parse_file

    try:
        content = await anyio.to_thread.run_sync(parse_file, filename, raw)
    except UnsupportedFileError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not content.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未能从文件中解析出文本内容")
    return await _ingest_document(session, kb, filename, content)


async def list_documents(
    session: AsyncSession, kb_id: uuid.UUID, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[Document], int]:
    await _owned_kb(session, kb_id, owner_id)
    total = await session.scalar(
        select(func.count()).select_from(Document).where(Document.knowledge_base_id == kb_id)
    )
    rows = (
        await session.execute(
            select(Document)
            .where(Document.knowledge_base_id == kb_id)
            .order_by(Document.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def delete_document(
    session: AsyncSession, doc_id: uuid.UUID, owner_id: uuid.UUID
) -> None:
    doc = await session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    await _owned_kb(session, doc.knowledge_base_id, owner_id)
    await anyio.to_thread.run_sync(
        get_provider().delete_document, str(doc.knowledge_base_id), str(doc.id)
    )
    await session.delete(doc)
    await session.commit()


async def list_document_chunks(
    session: AsyncSession, doc_id: uuid.UUID, owner_id: uuid.UUID
) -> list[str]:
    doc = await session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    kb = await _owned_kb(session, doc.knowledge_base_id, owner_id)
    from app.rag.llamaindex_pgvector import chunk_text

    return await anyio.to_thread.run_sync(chunk_text, doc.content, kb.kb_type)


async def _fulltext(
    session: AsyncSession, kb_id: uuid.UUID, query: str, top_k: int
) -> list[Chunk]:
    """全文检索：在分块表上按关键词 ILIKE 匹配，命中词数作为得分。"""
    from sqlalchemy import text as sql_text

    tokens = [t for t in query.split() if t] or [query]
    # 每个词一个 ILIKE 条件；得分 = 命中词数（CASE 求和）
    conds = " OR ".join(f"text ILIKE :t{i}" for i in range(len(tokens)))
    score_expr = " + ".join(f"(CASE WHEN text ILIKE :t{i} THEN 1 ELSE 0 END)" for i in range(len(tokens)))
    sql = sql_text(
        f"""
        SELECT text, metadata_->>'doc_id' AS doc_id, ({score_expr}) AS hits
        FROM data_rag_chunks
        WHERE metadata_->>'kb_id' = :kb AND ({conds})
        ORDER BY hits DESC
        LIMIT :k
        """
    )
    params: dict = {"kb": str(kb_id), "k": top_k}
    for i, tok in enumerate(tokens):
        params[f"t{i}"] = f"%{tok}%"
    rows = (await session.execute(sql, params)).all()
    n = len(tokens)
    return [Chunk(text=r[0], score=round(r[2] / n, 3), doc_id=r[1]) for r in rows]


def _rrf(lists: list[list[Chunk]], k: int = 60) -> list[Chunk]:
    """Reciprocal Rank Fusion：按各列表中的排名融合。"""
    scores: dict[str, float] = {}
    by_text: dict[str, Chunk] = {}
    for lst in lists:
        for rank, c in enumerate(lst):
            scores[c.text] = scores.get(c.text, 0.0) + 1.0 / (k + rank + 1)
            by_text.setdefault(c.text, c)
    ranked = sorted(by_text.values(), key=lambda c: scores[c.text], reverse=True)
    for c in ranked:
        c.score = round(scores[c.text], 4)
    return ranked


async def optimize_query(query: str, history: list[str] | None = None) -> str:
    """问题优化：结合对话历史，用 LLM 把用户问题改写成自包含、适合检索的查询。"""
    from langchain_core.messages import HumanMessage, SystemMessage

    from app.agents.models import build_chat_model

    hist = "\n".join(f"- {h}" for h in (history or [])[-6:]) or "（无）"
    sys = (
        "你是知识库检索查询改写器。根据对话历史，把用户最新问题改写成一个自包含、"
        "适合向量检索的查询：补全省略与指代、去掉寒暄与无关词，只保留检索关键信息。"
        "只输出改写后的查询本身，不要解释。"
    )
    usr = f"对话历史：\n{hist}\n\n用户最新问题：{query}\n\n改写后的检索查询："
    try:
        model = build_chat_model(streaming=False)
        resp = await model.ainvoke([SystemMessage(content=sys), HumanMessage(content=usr)])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return text.strip() or query
    except Exception:  # noqa: BLE001
        return query


async def query_kb(
    session: AsyncSession,
    kb_id: uuid.UUID,
    owner_id: uuid.UUID,
    query: str,
    top_k: int | None,
    mode: str = "semantic",
    min_score: float = 0.0,
    rerank: bool = False,
    optimize: bool = False,
    history: list[str] | None = None,
) -> QueryResult:
    await _owned_kb(session, kb_id, owner_id)
    k = top_k or 5

    optimized: str | None = None
    if optimize:
        optimized = await optimize_query(query, history)
        if optimized and optimized != query:
            query = optimized
        else:
            optimized = None
    # 开启重排时先取更大候选池，再重排截断
    pool = min(max(k * 3, 10), 30) if rerank else k

    if mode == "fulltext":
        chunks = await _fulltext(session, kb_id, query, pool)
    else:
        vec = await anyio.to_thread.run_sync(get_provider().retrieve, str(kb_id), query, pool)
        vec_chunks = [Chunk(text=r.text, score=r.score, doc_id=r.metadata.get("doc_id")) for r in vec]
        if mode == "hybrid":
            ft = await _fulltext(session, kb_id, query, pool)
            chunks = _rrf([vec_chunks, ft])
        else:  # semantic
            chunks = vec_chunks

    if rerank and chunks:
        import math

        from app.rag.llamaindex_pgvector import rerank_scores

        scores = await anyio.to_thread.run_sync(rerank_scores, query, [c.text for c in chunks])
        for c, s in zip(chunks, scores):
            # cross-encoder 输出为 logits，用 sigmoid 归一到 0~1，与 UI 的相关度/阈值一致
            c.score = round(1.0 / (1.0 + math.exp(-float(s))), 4)
        chunks.sort(key=lambda c: c.score, reverse=True)

    chunks = chunks[:k]
    if min_score > 0:
        chunks = [c for c in chunks if c.score >= min_score]
    return QueryResult(chunks=chunks, optimized_query=optimized)
