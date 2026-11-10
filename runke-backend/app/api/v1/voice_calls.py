import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope
from app.schemas.voice_call import (
    CallRecordDetail,
    CallRecordOut,
    CallTaskCreate,
    CallTaskOut,
    CallTaskUpdate,
)
from app.services import voice_call_service as vcs

router = APIRouter(prefix="/call-tasks", tags=["voice-calls"])
rec_router = APIRouter(prefix="/call-records", tags=["voice-calls"])


# ---- 外呼任务 ----
@router.get("", summary="外呼任务列表")
async def list_tasks(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[CallTaskOut]]:
    rows = await vcs.list_tasks(session, current.id)
    return Envelope(data=[CallTaskOut.model_validate(r) for r in rows])


@router.post("", status_code=status.HTTP_201_CREATED, summary="新建外呼任务")
async def create_task(
    body: CallTaskCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CallTaskOut]:
    row = await vcs.create_task(session, current.id, body)
    return Envelope(data=CallTaskOut.model_validate(row))


@router.patch("/{task_id}", summary="编辑/启停外呼任务")
async def update_task(
    task_id: uuid.UUID, body: CallTaskUpdate,
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CallTaskOut]:
    row = await vcs.update_task(session, current.id, task_id, body)
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return Envelope(data=CallTaskOut.model_validate(row))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除外呼任务")
async def delete_task(
    task_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    ok = await vcs.delete_task(session, current.id, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="任务不存在")


# ---- 通话记录 ----
@rec_router.get("", summary="通话记录列表（可按任务过滤）")
async def list_records(
    task_id: uuid.UUID | None = None,
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[CallRecordOut]]:
    rows = await vcs.list_records(session, current.id, task_id)
    return Envelope(data=[CallRecordOut.model_validate(r) for r in rows])


@rec_router.get("/{rec_id}", summary="通话记录详情（含转写）")
async def get_record(
    rec_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CallRecordDetail]:
    row = await vcs.get_record(session, current.id, rec_id)
    if row is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return Envelope(data=CallRecordDetail.model_validate(row))
