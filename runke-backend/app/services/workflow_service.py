"""Workflow CRUD + 运行。"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow import Workflow, WorkflowRun
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate
from app.workflows.engine import run_workflow


async def _owned(session: AsyncSession, wf_id: uuid.UUID, owner_id: uuid.UUID) -> Workflow:
    wf = await session.get(Workflow, wf_id)
    if wf is None or wf.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow 不存在")
    return wf


async def list_workflows(
    session: AsyncSession, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[Workflow], int]:
    total = await session.scalar(
        select(func.count()).select_from(Workflow).where(Workflow.owner_id == owner_id)
    )
    rows = (
        await session.execute(
            select(Workflow)
            .where(Workflow.owner_id == owner_id)
            .order_by(Workflow.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def create_workflow(
    session: AsyncSession, owner_id: uuid.UUID, data: WorkflowCreate
) -> Workflow:
    wf = Workflow(owner_id=owner_id, **data.model_dump())
    session.add(wf)
    await session.commit()
    await session.refresh(wf)
    return wf


async def get_workflow(session: AsyncSession, wf_id: uuid.UUID, owner_id: uuid.UUID) -> Workflow:
    return await _owned(session, wf_id, owner_id)


async def update_workflow(
    session: AsyncSession, wf_id: uuid.UUID, owner_id: uuid.UUID, data: WorkflowUpdate
) -> Workflow:
    wf = await _owned(session, wf_id, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(wf, k, v)
    await session.commit()
    await session.refresh(wf)
    return wf


async def delete_workflow(session: AsyncSession, wf_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    wf = await _owned(session, wf_id, owner_id)
    await session.delete(wf)
    await session.commit()


async def run(
    session: AsyncSession, wf_id: uuid.UUID, owner_id: uuid.UUID, user_input: str
) -> WorkflowRun:
    wf = await _owned(session, wf_id, owner_id)
    run_row = WorkflowRun(workflow_id=wf.id, status="running", input=user_input)
    session.add(run_row)
    await session.commit()
    await session.refresh(run_row)

    try:
        output, trace, _vars = await run_workflow(wf.definition, user_input)
        run_row.output = output
        run_row.trace = trace
        run_row.status = "done"
    except Exception as exc:  # noqa: BLE001
        run_row.status = "error"
        run_row.output = f"{exc.__class__.__name__}: {exc}"
    await session.commit()
    await session.refresh(run_row)
    return run_row


async def get_run(session: AsyncSession, run_id: uuid.UUID, owner_id: uuid.UUID) -> WorkflowRun:
    run_row = await session.get(WorkflowRun, run_id)
    if run_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run 不存在")
    await _owned(session, run_row.workflow_id, owner_id)
    return run_row
