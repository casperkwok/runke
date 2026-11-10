import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.models.voice import Voice
from app.schemas.common import Envelope
from app.schemas.voice import VoiceCreate, VoiceOut, VoiceUpdate
from app.services import tts_service, voice_service

_SAMPLE_FALLBACK = "您好，很高兴为您服务，这是音色试听效果。"

router = APIRouter(prefix="/voices", tags=["voices"])


@router.get("", summary="音色库列表（系统音色 + 克隆音色）")
async def list_voices(
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[list[VoiceOut]]:
    rows = await voice_service.list_voices(session, current.id)
    return Envelope(data=[VoiceOut.model_validate(v) for v in rows])


@router.post("", status_code=status.HTTP_201_CREATED, summary="新建/克隆音色")
async def create_voice(
    body: VoiceCreate, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[VoiceOut]:
    v = await voice_service.create_voice(session, current.id, body)
    return Envelope(data=VoiceOut.model_validate(v))


@router.get("/{voice_id}/sample", summary="音色试听（火山 TTS 实时合成 WAV）")
async def voice_sample(
    voice_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Response:
    v = await session.get(Voice, voice_id)
    if v is None or v.owner_id != current.id:
        raise HTTPException(status_code=404, detail="音色不存在")
    text = (v.sample or "").strip() or _SAMPLE_FALLBACK
    try:
        wav = await tts_service.synthesize(
            text, v.provider_voice, resource=v.provider_resource or None,
            speed=v.rate or 1.0, pitch_ratio=1.0, volume_ratio=1.0,
        )
    except tts_service.TTSError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"合成失败：{e}")
    return Response(content=wav, media_type="audio/wav")


@router.patch("/{voice_id}", summary="编辑音色")
async def update_voice(
    voice_id: uuid.UUID, body: VoiceUpdate,
    current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Envelope[VoiceOut]:
    v = await voice_service.update_voice(session, current.id, voice_id, body)
    if v is None:
        raise HTTPException(status_code=404, detail="音色不存在")
    return Envelope(data=VoiceOut.model_validate(v))


@router.delete("/{voice_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除克隆音色（系统音色不可删）")
async def delete_voice(
    voice_id: uuid.UUID, current: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> None:
    err = await voice_service.delete_voice(session, current.id, voice_id)
    if err == "not_found":
        raise HTTPException(status_code=404, detail="音色不存在")
    if err == "system_protected":
        raise HTTPException(status_code=400, detail="系统音色不可删除")
