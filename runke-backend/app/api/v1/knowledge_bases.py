import uuid

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import Pagination, get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope, Meta
from app.schemas.knowledge import (
    DocumentChunksOut,
    DocumentCreate,
    DocumentOut,
    KnowledgeBaseCreate,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
    QueryRequest,
    QueryResult,
)
from app.services import knowledge_service

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])


@router.get("", summary="知识库列表")
async def list_kbs(
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[KnowledgeBaseOut]]:
    rows, total = await knowledge_service.list_kbs(session, current.id, page.offset, page.limit)
    return Envelope(
        data=[KnowledgeBaseOut.model_validate(k) for k in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="创建知识库")
async def create_kb(
    body: KnowledgeBaseCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[KnowledgeBaseOut]:
    kb = await knowledge_service.create_kb(session, current.id, body)
    return Envelope(data=KnowledgeBaseOut.model_validate(kb))


@router.get("/{kb_id}", summary="知识库详情")
async def get_kb(
    kb_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[KnowledgeBaseOut]:
    kb = await knowledge_service.get_kb(session, kb_id, current.id)
    return Envelope(data=KnowledgeBaseOut.model_validate(kb))


@router.patch("/{kb_id}", summary="更新知识库（名称/简介/类型/启用）")
async def update_kb(
    kb_id: uuid.UUID,
    body: KnowledgeBaseUpdate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[KnowledgeBaseOut]:
    kb = await knowledge_service.update_kb(session, kb_id, current.id, body)
    return Envelope(data=KnowledgeBaseOut.model_validate(kb))


@router.delete("/{kb_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除知识库")
async def delete_kb(
    kb_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await knowledge_service.delete_kb(session, kb_id, current.id)


# ---- 文档 ----
@router.get("/{kb_id}/documents", summary="文档列表")
async def list_documents(
    kb_id: uuid.UUID,
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[DocumentOut]]:
    rows, total = await knowledge_service.list_documents(
        session, kb_id, current.id, page.offset, page.limit
    )
    return Envelope(
        data=[DocumentOut.model_validate(d) for d in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post(
    "/{kb_id}/documents",
    status_code=status.HTTP_201_CREATED,
    summary="上传文档（文本），自动分块入向量库",
)
async def add_document(
    kb_id: uuid.UUID,
    body: DocumentCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[DocumentOut]:
    doc = await knowledge_service.add_document(session, kb_id, current.id, body)
    return Envelope(data=DocumentOut.model_validate(doc))


@router.post(
    "/{kb_id}/documents/upload",
    status_code=status.HTTP_201_CREATED,
    summary="上传文件（pdf/docx/pptx/xlsx/csv/txt/md），解析→分块→入向量库",
)
async def upload_document(
    kb_id: uuid.UUID,
    file: UploadFile = File(...),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[DocumentOut]:
    raw = await file.read()
    doc = await knowledge_service.add_document_file(
        session, kb_id, current.id, file.filename or "未命名文件", raw
    )
    return Envelope(data=DocumentOut.model_validate(doc))


@router.post("/{kb_id}/queries", summary="在知识库内检索")
async def query_kb(
    kb_id: uuid.UUID,
    body: QueryRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[QueryResult]:
    result = await knowledge_service.query_kb(
        session, kb_id, current.id, body.query, body.top_k, body.mode,
        body.min_score, body.rerank, body.optimize, body.history,
    )
    return Envelope(data=result)


# ---- 文档删除（顶层资源）----
docs_router = APIRouter(prefix="/documents", tags=["knowledge"])


@docs_router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除文档")
async def delete_document(
    doc_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await knowledge_service.delete_document(session, doc_id, current.id)


@docs_router.get("/{doc_id}/chunks", summary="文档分块（段落视图）")
async def get_document_chunks(
    doc_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[DocumentChunksOut]:
    chunks = await knowledge_service.list_document_chunks(session, doc_id, current.id)
    return Envelope(data=DocumentChunksOut(chunks=chunks))
