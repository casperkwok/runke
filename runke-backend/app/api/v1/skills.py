import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope
from app.schemas.skill import (
    ConnectorCreate,
    ConnectorOut,
    ConnectorUpdate,
    SkillCreate,
    SkillOut,
    SkillTestRequest,
    SkillTestResult,
    SkillUpdate,
)
from app.services import skill_service

# ---- 连接器（数据接入）----
connectors_router = APIRouter(prefix="/connectors", tags=["skills"])


@connectors_router.get("", summary="连接器列表")
async def list_connectors(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[ConnectorOut]]:
    rows = await skill_service.list_connectors(session, current.id)
    return Envelope(data=[ConnectorOut.model_validate(c) for c in rows])


@connectors_router.post("", status_code=status.HTTP_201_CREATED, summary="创建连接器")
async def create_connector(
    body: ConnectorCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[ConnectorOut]:
    c = await skill_service.create_connector(session, current.id, body)
    return Envelope(data=ConnectorOut.model_validate(c))


@connectors_router.patch("/{cid}", summary="更新连接器")
async def update_connector(
    cid: uuid.UUID, body: ConnectorUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[ConnectorOut]:
    c = await skill_service.update_connector(session, cid, current.id, body)
    return Envelope(data=ConnectorOut.model_validate(c))


@connectors_router.delete("/{cid}", status_code=status.HTTP_204_NO_CONTENT, summary="删除连接器")
async def delete_connector(
    cid: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await skill_service.delete_connector(session, cid, current.id)


# ---- 技能 ----
router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("/builtins", summary="内置技能动作列表")
async def list_builtins(current: User = Depends(get_current_user)) -> Envelope[list[dict]]:
    return Envelope(data=[{"key": k, **v} for k, v in skill_service.BUILTIN_ACTIONS.items()])


class BitableTestReq(BaseModel):
    url: str
    personal_base_token: str


@router.post("/bitable/test", summary="测试飞书多维表格连接")
async def bitable_test(body: BitableTestReq, current: User = Depends(get_current_user)) -> Envelope[dict]:
    import anyio

    from app.agents.tools.bitable_tool import test_connection

    res = await anyio.to_thread.run_sync(test_connection, body.url, body.personal_base_token)
    return Envelope(data=res)


@router.get("", summary="技能列表")
async def list_skills(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[SkillOut]]:
    rows = await skill_service.list_skills(session, current.id)
    return Envelope(data=[SkillOut.model_validate(s) for s in rows])


@router.post("", status_code=status.HTTP_201_CREATED, summary="创建技能")
async def create_skill(
    body: SkillCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[SkillOut]:
    s = await skill_service.create_skill(session, current.id, body)
    return Envelope(data=SkillOut.model_validate(s))


@router.get("/{sid}", summary="技能详情")
async def get_skill(
    sid: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[SkillOut]:
    s = await skill_service.get_skill(session, sid, current.id)
    return Envelope(data=SkillOut.model_validate(s))


@router.patch("/{sid}", summary="更新技能")
async def update_skill(
    sid: uuid.UUID, body: SkillUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[SkillOut]:
    s = await skill_service.update_skill(session, sid, current.id, body)
    return Envelope(data=SkillOut.model_validate(s))


@router.delete("/{sid}", status_code=status.HTTP_204_NO_CONTENT, summary="删除技能")
async def delete_skill(
    sid: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await skill_service.delete_skill(session, sid, current.id)


@router.post("/{sid}/test", summary="测试工具技能（真实调用连接器）")
async def test_skill(
    sid: uuid.UUID, body: SkillTestRequest, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[SkillTestResult]:
    res = await skill_service.test_skill(session, sid, current.id, body.args)
    return Envelope(data=res)
