"""组织架构服务：部门树 + 成员 CRUD（按 owner 隔离）。首次访问自动补建「创建者」成员。"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org import Department, Member
from app.models.user import User
from app.schemas.org import DeptCreate, DeptUpdate, MemberCreate, MemberUpdate


# ---------------- 部门 ----------------
async def _owned_dept(session: AsyncSession, did: uuid.UUID, owner_id: uuid.UUID) -> Department:
    d = await session.get(Department, did)
    if d is None or d.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部门不存在")
    return d


async def list_departments(session: AsyncSession, owner_id: uuid.UUID) -> list[Department]:
    rows = (await session.execute(
        select(Department).where(Department.owner_id == owner_id).order_by(Department.sort, Department.created_at)
    )).scalars().all()
    return list(rows)


async def create_department(session: AsyncSession, owner_id: uuid.UUID, data: DeptCreate) -> Department:
    if data.parent_id is not None:
        await _owned_dept(session, data.parent_id, owner_id)
    d = Department(owner_id=owner_id, name=data.name.strip(), parent_id=data.parent_id)
    session.add(d)
    await session.commit()
    await session.refresh(d)
    return d


async def update_department(session: AsyncSession, did: uuid.UUID, owner_id: uuid.UUID, data: DeptUpdate) -> Department:
    d = await _owned_dept(session, did, owner_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("parent_id") == did:
        raise HTTPException(status_code=400, detail="不能把部门挂到自己下面")
    for k, v in payload.items():
        setattr(d, k, v.strip() if isinstance(v, str) else v)
    await session.commit()
    await session.refresh(d)
    return d


async def delete_department(session: AsyncSession, did: uuid.UUID, owner_id: uuid.UUID) -> None:
    d = await _owned_dept(session, did, owner_id)
    await session.delete(d)  # 子部门 CASCADE；成员 department_id SET NULL（回到未分配）
    await session.commit()


# ---------------- 成员 ----------------
async def _owned_member(session: AsyncSession, mid: uuid.UUID, owner_id: uuid.UUID) -> Member:
    m = await session.get(Member, mid)
    if m is None or m.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在")
    return m


async def ensure_creator(session: AsyncSession, owner_id: uuid.UUID) -> None:
    """首次访问：把账号本人补建为「创建者」成员。"""
    exists = (await session.execute(
        select(Member.id).where(Member.owner_id == owner_id, Member.is_creator.is_(True))
    )).first()
    if exists:
        return
    user = await session.get(User, owner_id)
    if user is None:
        return
    session.add(Member(owner_id=owner_id, name=user.name or "我", email=user.email or "",
                       role="", status="joined", is_creator=True))
    await session.commit()


async def list_members(session: AsyncSession, owner_id: uuid.UUID, department_id: uuid.UUID | None) -> list[Member]:
    await ensure_creator(session, owner_id)
    q = select(Member).where(Member.owner_id == owner_id)
    if department_id is not None:
        q = q.where(Member.department_id == department_id)
    q = q.order_by(Member.is_creator.desc(), Member.created_at)
    return list((await session.execute(q)).scalars().all())


async def create_member(session: AsyncSession, owner_id: uuid.UUID, data: MemberCreate) -> Member:
    if data.department_id is not None:
        await _owned_dept(session, data.department_id, owner_id)
    m = Member(owner_id=owner_id, name=data.name.strip(), email=data.email.strip(), phone=data.phone.strip(),
               role=data.role.strip(), department_id=data.department_id, status=data.status or "joined")
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def update_member(session: AsyncSession, mid: uuid.UUID, owner_id: uuid.UUID, data: MemberUpdate) -> Member:
    m = await _owned_member(session, mid, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, v.strip() if isinstance(v, str) else v)
    await session.commit()
    await session.refresh(m)
    return m


async def delete_member(session: AsyncSession, mid: uuid.UUID, owner_id: uuid.UUID) -> None:
    m = await _owned_member(session, mid, owner_id)
    if m.is_creator:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="创建者不可删除")
    await session.delete(m)
    await session.commit()
