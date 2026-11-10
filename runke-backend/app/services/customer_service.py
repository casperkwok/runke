"""CRM 客户服务：客户 CRUD（跟进记录/标签/AI 标记内嵌于客户，整体保存）。"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate


async def _owned(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID) -> Customer:
    c = await session.get(Customer, cid)
    if c is None or c.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="客户不存在")
    return c


async def list_customers(session: AsyncSession, owner_id: uuid.UUID) -> list[Customer]:
    rows = (
        await session.execute(
            select(Customer).where(Customer.owner_id == owner_id).order_by(Customer.updated_at.desc())
        )
    ).scalars().all()
    return list(rows)


async def create_customer(session: AsyncSession, owner_id: uuid.UUID, data: CustomerCreate) -> Customer:
    c = Customer(owner_id=owner_id, **data.model_dump())
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


async def update_customer(
    session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID, data: CustomerUpdate
) -> Customer:
    c = await _owned(session, cid, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await session.commit()
    await session.refresh(c)
    return c


async def get_customer(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID) -> Customer:
    return await _owned(session, cid, owner_id)


async def delete_customer(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID) -> None:
    c = await _owned(session, cid, owner_id)
    await session.delete(c)
    await session.commit()
