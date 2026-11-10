"""音色库：Voice。系统音色平台预置(不可删)，也可克隆专属音色。被「编排·语音/预览/外呼」引用。"""
import uuid
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Voice(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "voices"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    gender: Mapped[str] = mapped_column(String(8), default="女")        # 女 / 男
    lang: Mapped[str] = mapped_column(String(40), default="中文 · 普通话")
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)        # ["warm","sweet"]
    scene: Mapped[str] = mapped_column(String(80), default="")          # 适用场景
    sample: Mapped[str] = mapped_column(Text, default="")               # 试听文案
    provider_voice: Mapped[str] = mapped_column(String(80), default="")  # 火山 TTS voice/speaker key
    # 火山 TTS resource_id（不同音色族不同：uranus 大模型音色=seed-tts-2.0；声音复刻=volc.megatts.default）
    provider_resource: Mapped[str] = mapped_column(String(60), default="seed-tts-2.0")
    rate: Mapped[float] = mapped_column(Float, default=1.0)
    pitch: Mapped[int] = mapped_column(Integer, default=0)
    vol: Mapped[int] = mapped_column(Integer, default=80)
    system: Mapped[bool] = mapped_column(Boolean, default=False)        # 系统预置(不可删)
    cloned: Mapped[bool] = mapped_column(Boolean, default=False)        # 克隆音色
