import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import Pagination, get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope, Meta
from app.schemas.workflow import (
    RunCreate,
    RunOut,
    WorkflowCreate,
    WorkflowOut,
    WorkflowUpdate,
)
from app.services import workflow_service

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("", summary="workflow 列表")
async def list_workflows(
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[WorkflowOut]]:
    rows, total = await workflow_service.list_workflows(session, current.id, page.offset, page.limit)
    return Envelope(
        data=[WorkflowOut.model_validate(w) for w in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="创建 workflow")
async def create_workflow(
    body: WorkflowCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[WorkflowOut]:
    wf = await workflow_service.create_workflow(session, current.id, body)
    return Envelope(data=WorkflowOut.model_validate(wf))


@router.get("/{wf_id}", summary="workflow 详情")
async def get_workflow(
    wf_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[WorkflowOut]:
    wf = await workflow_service.get_workflow(session, wf_id, current.id)
    return Envelope(data=WorkflowOut.model_validate(wf))


@router.patch("/{wf_id}", summary="更新 workflow")
async def update_workflow(
    wf_id: uuid.UUID,
    body: WorkflowUpdate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[WorkflowOut]:
    wf = await workflow_service.update_workflow(session, wf_id, current.id, body)
    return Envelope(data=WorkflowOut.model_validate(wf))


@router.delete("/{wf_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除 workflow")
async def delete_workflow(
    wf_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await workflow_service.delete_workflow(session, wf_id, current.id)


@router.post("/{wf_id}/runs", status_code=status.HTTP_201_CREATED, summary="运行 workflow")
async def run_workflow(
    wf_id: uuid.UUID,
    body: RunCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[RunOut]:
    run_row = await workflow_service.run(session, wf_id, current.id, body.input)
    return Envelope(data=RunOut.model_validate(run_row))


# ---- run 详情（顶层资源）----
runs_router = APIRouter(prefix="/runs", tags=["workflows"])


@runs_router.get("/{run_id}", summary="运行详情（含 trace）")
async def get_run(
    run_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[RunOut]:
    run_row = await workflow_service.get_run(session, run_id, current.id)
    return Envelope(data=RunOut.model_validate(run_row))
