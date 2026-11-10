"""音色库服务：系统音色自动补建(不可删) + 克隆音色 CRUD。"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.voice import Voice
from app.schemas.voice import VoiceCreate, VoiceUpdate

# 系统预置音色。provider_voice 为火山 TTS voice key —— 仅收录已在本账号火山资源(uranus 集群)
# 实测可合成的音色，确保「试听」一定出声。
_URANUS = "seed-tts-2.0"      # 大模型音色族
_MEGATTS = "volc.megatts.default"  # 声音复刻族（S_ 开头的克隆音）
SYSTEM_VOICES: list[dict] = [
    {"name": "专属 · 默认音色", "gender": "女", "lang": "中文 · 普通话", "tags": ["专属", "克隆"],
     "scene": "默认 · 外呼 / 客服", "sample": "您好，很高兴为您服务，这是您的专属音色。",
     "provider_voice": "S_8nTlUkT32", "provider_resource": _MEGATTS, "rate": 1.0, "pitch": 0, "vol": 80},
    {"name": "小鹤 · 暖阳", "gender": "女", "lang": "中文 · 普通话", "tags": ["温暖", "亲和"],
     "scene": "客服 / 售后陪伴", "sample": "您好，很高兴为您服务，请问有什么可以帮您？",
     "provider_voice": "zh_female_xiaohe_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 80},
    {"name": "灿灿 · 活力", "gender": "女", "lang": "中文 · 普通话", "tags": ["活泼", "年轻"],
     "scene": "营销 / 活动邀约", "sample": "好消息！我们这边有个超划算的活动想第一时间告诉您～",
     "provider_voice": "zh_female_cancan_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 82},
    {"name": "知心 · 客服", "gender": "女", "lang": "中文 · 普通话", "tags": ["亲切", "耐心"],
     "scene": "客服热线 / 咨询", "sample": "您好，这里是客服中心，您的问题我来帮您处理。",
     "provider_voice": "zh_female_kefunvsheng_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 80},
    {"name": "御姐 · 沉稳", "gender": "女", "lang": "中文 · 普通话", "tags": ["沉稳", "高级"],
     "scene": "高端 / VIP 沟通", "sample": "您好，很高兴与您沟通，接下来由我为您专属服务。",
     "provider_voice": "zh_female_gaolengyujie_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 80},
    {"name": "浩然 · 浑厚", "gender": "男", "lang": "中文 · 普通话", "tags": ["沉稳", "专业"],
     "scene": "销售 / 商务沟通", "sample": "您好，我是负责对接的同事，跟您简单介绍一下我们的方案。",
     "provider_voice": "zh_male_dongfanghaoran_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 80},
    {"name": "思朗 · 清朗", "gender": "男", "lang": "中文 · 普通话", "tags": ["清朗", "可信"],
     "scene": "咨询 / 答疑", "sample": "别着急，我先了解一下情况，再给您一些建议。",
     "provider_voice": "zh_male_silang_uranus_bigtts", "provider_resource": _URANUS, "rate": 1.0, "pitch": 0, "vol": 80},
]


async def ensure_system_voices(db: AsyncSession, owner_id: uuid.UUID) -> None:
    """同步当前用户的系统音色到 SYSTEM_VOICES：按名匹配则就地更新(修正 provider_voice 等，
    保留 id 以免引用失效)，缺失则新增，不在目录中的旧系统音色则删除。"""
    rows = (await db.execute(
        select(Voice).where(Voice.owner_id == owner_id, Voice.system.is_(True))
    )).scalars().all()
    by_name = {r.name: r for r in rows}
    catalog_names = {v["name"] for v in SYSTEM_VOICES}
    changed = False
    for v in SYSTEM_VOICES:
        cur = by_name.get(v["name"])
        if cur is None:
            db.add(Voice(owner_id=owner_id, system=True, cloned=False, **v))
            changed = True
        else:
            for k, val in v.items():
                if getattr(cur, k) != val:
                    setattr(cur, k, val)
                    changed = True
    for r in rows:
        if r.name not in catalog_names:
            await db.delete(r)
            changed = True
    if changed:
        await db.commit()


async def list_voices(db: AsyncSession, owner_id: uuid.UUID) -> list[Voice]:
    await ensure_system_voices(db, owner_id)
    rows = (await db.execute(
        select(Voice).where(Voice.owner_id == owner_id).order_by(Voice.system.desc(), Voice.created_at)
    )).scalars().all()
    return list(rows)


async def create_voice(db: AsyncSession, owner_id: uuid.UUID, data: VoiceCreate) -> Voice:
    v = Voice(owner_id=owner_id, system=False, **data.model_dump())
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


async def _get_owned(db: AsyncSession, owner_id: uuid.UUID, voice_id: uuid.UUID) -> Voice | None:
    return (await db.execute(
        select(Voice).where(Voice.id == voice_id, Voice.owner_id == owner_id)
    )).scalar_one_or_none()


async def update_voice(db: AsyncSession, owner_id: uuid.UUID, voice_id: uuid.UUID,
                       data: VoiceUpdate) -> Voice | None:
    v = await _get_owned(db, owner_id, voice_id)
    if v is None:
        return None
    for k, val in data.model_dump(exclude_unset=True).items():
        setattr(v, k, val)
    await db.commit()
    await db.refresh(v)
    return v


async def delete_voice(db: AsyncSession, owner_id: uuid.UUID, voice_id: uuid.UUID) -> str | None:
    """删除克隆音色。系统音色不可删，返回错误信息字符串；成功返回 None。"""
    v = await _get_owned(db, owner_id, voice_id)
    if v is None:
        return "not_found"
    if v.system:
        return "system_protected"
    await db.delete(v)
    await db.commit()
    return None
