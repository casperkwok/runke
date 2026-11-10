import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope
from app.schemas.org import DeptCreate, DeptOut, DeptUpdate, MemberCreate, MemberOut, MemberUpdate
from app.services import org_service

router = APIRouter(prefix="/org", tags=["org"])


# ---- 部门 ----
@router.get("/departments", summary="部门列表（扁平，前端建树）")
async def list_departments(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[DeptOut]]:
    rows = await org_service.list_departments(session, current.id)
    return Envelope(data=[DeptOut.model_validate(d) for d in rows])


@router.post("/departments", status_code=status.HTTP_201_CREATED, summary="新建部门")
async def create_department(
    body: DeptCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[DeptOut]:
    d = await org_service.create_department(session, current.id, body)
    return Envelope(data=DeptOut.model_validate(d))


@router.patch("/departments/{dept_id}", summary="编辑部门（重命名/移动）")
async def update_department(
    dept_id: uuid.UUID, body: DeptUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[DeptOut]:
    d = await org_service.update_department(session, dept_id, current.id, body)
    return Envelope(data=DeptOut.model_validate(d))


@router.delete("/departments/{dept_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除部门")
async def delete_department(
    dept_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await org_service.delete_department(session, dept_id, current.id)


# ---- 成员 ----
@router.get("/members", summary="成员列表（可按部门过滤）")
async def list_members(
    department_id: uuid.UUID | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[MemberOut]]:
    rows = await org_service.list_members(session, current.id, department_id)
    return Envelope(data=[MemberOut.model_validate(m) for m in rows])


@router.post("/members", status_code=status.HTTP_201_CREATED, summary="添加成员")
async def create_member(
    body: MemberCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[MemberOut]:
    m = await org_service.create_member(session, current.id, body)
    return Envelope(data=MemberOut.model_validate(m))


@router.patch("/members/{member_id}", summary="编辑成员")
async def update_member(
    member_id: uuid.UUID, body: MemberUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[MemberOut]:
    m = await org_service.update_member(session, member_id, current.id, body)
    return Envelope(data=MemberOut.model_validate(m))


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除成员")
async def delete_member(
    member_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await org_service.delete_member(session, member_id, current.id)
