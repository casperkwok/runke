import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.common import Envelope
from app.schemas.customer import CustomerCreate, CustomerOut, CustomerUpdate
from app.services import customer_pack_service, customer_service

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", summary="客户列表（可按资源包过滤）")
async def list_customers(
    pack_id: uuid.UUID | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[CustomerOut]]:
    rows = await customer_service.list_customers(session, current.id)
    if pack_id is not None:
        member_ids = set(await customer_pack_service.list_pack_member_ids(session, pack_id, current.id))
        rows = [c for c in rows if str(c.id) in member_ids]
    return Envelope(data=[CustomerOut.model_validate(c) for c in rows])


# ---------------- 资源包（每个包 = 一条查询规则，成员实时计算） ----------------
class PackCreate(BaseModel):
    name: str
    kind: str  # rule / manual（file 用 /import）
    rule: dict | None = None
    customer_ids: list[str] | None = None


class PackUpdate(BaseModel):
    name: str | None = None
    rule: dict | None = None


class MemberOp(BaseModel):
    customer_ids: list[str]


@router.get("/packs", summary="资源包列表（count 为规则实时计算）")
async def list_packs(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[dict]]:
    return Envelope(data=await customer_pack_service.list_packs(session, current.id))


@router.post("/packs", status_code=status.HTTP_201_CREATED, summary="创建条件筛选/手动指定资源包")
async def create_pack(
    body: PackCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[dict]:
    data = await customer_pack_service.create_pack(
        session, current.id, name=body.name, kind=body.kind, rule=body.rule, customer_ids=body.customer_ids
    )
    return Envelope(data=data)


@router.post("/packs/import", status_code=status.HTTP_201_CREATED, summary="文件导入：新建/追加/覆盖 file 资源包并去重 upsert")
async def import_pack(
    file: UploadFile = File(...),
    name: str = Form(""),
    pack_id: uuid.UUID | None = Form(None),
    mode: str = Form("append"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[dict]:
    raw = await file.read()
    result = await customer_pack_service.import_customers(
        session, current.id, file.filename or "", raw, name=name, pack_id=pack_id, mode=mode
    )
    return Envelope(data=result)


@router.patch("/packs/{pack_id}", summary="重命名 / 修改条件筛选规则")
async def update_pack(
    pack_id: uuid.UUID, body: PackUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[dict]:
    await customer_pack_service.update_pack(session, pack_id, current.id, name=body.name, rule=body.rule)
    return Envelope(data={"ok": True})


@router.post("/packs/{pack_id}/members", summary="手动包：批量加入成员")
async def add_members(
    pack_id: uuid.UUID, body: MemberOp, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[dict]:
    n = await customer_pack_service.add_members(session, pack_id, current.id, body.customer_ids)
    return Envelope(data={"added": n})


@router.delete("/packs/{pack_id}/members", summary="手动包：批量移出成员")
async def remove_members(
    pack_id: uuid.UUID, body: MemberOp, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[dict]:
    await customer_pack_service.remove_members(session, pack_id, current.id, body.customer_ids)
    return Envelope(data={"ok": True})


@router.get("/export", summary="导出客户为 Excel（可按资源包）")
async def export_customers(
    pack_id: uuid.UUID | None = None,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    from urllib.parse import quote

    data, title = await customer_pack_service.export_xlsx(session, current.id, pack_id)
    fname = quote(f"{title}.xlsx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"export.xlsx\"; filename*=UTF-8''{fname}"},
    )


@router.delete("/packs/{pack_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除资源包（客户保留）")
async def delete_pack(
    pack_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await customer_pack_service.delete_pack(session, pack_id, current.id)


@router.post("", status_code=status.HTTP_201_CREATED, summary="创建客户")
async def create_customer(
    body: CustomerCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CustomerOut]:
    c = await customer_service.create_customer(session, current.id, body)
    return Envelope(data=CustomerOut.model_validate(c))


@router.get("/{cid}", summary="客户详情")
async def get_customer(
    cid: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CustomerOut]:
    c = await customer_service.get_customer(session, cid, current.id)
    return Envelope(data=CustomerOut.model_validate(c))


@router.patch("/{cid}", summary="更新客户（含跟进记录/标签整体保存）")
async def update_customer(
    cid: uuid.UUID, body: CustomerUpdate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[CustomerOut]:
    c = await customer_service.update_customer(session, cid, current.id, body)
    return Envelope(data=CustomerOut.model_validate(c))


@router.delete("/{cid}", status_code=status.HTTP_204_NO_CONTENT, summary="删除客户")
async def delete_customer(
    cid: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    await customer_service.delete_customer(session, cid, current.id)
