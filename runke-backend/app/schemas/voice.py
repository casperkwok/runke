"""音色库 Schema。"""
import uuid

from pydantic import BaseModel, ConfigDict, Field


class VoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    gender: str
    lang: str
    tags: list
    scene: str
    sample: str
    provider_voice: str
    provider_resource: str
    rate: float
    pitch: int
    vol: int
    system: bool
    cloned: bool


class VoiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    gender: str = "女"
    lang: str = "中文 · 普通话"
    tags: list = []
    scene: str = ""
    sample: str = ""
    provider_voice: str = ""
    provider_resource: str = "seed-tts-2.0"
    rate: float = 1.0
    pitch: int = 0
    vol: int = 80
    cloned: bool = True   # 用户新建默认为克隆音色


class VoiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    gender: str | None = None
    lang: str | None = None
    tags: list | None = None
    scene: str | None = None
    sample: str | None = None
    provider_voice: str | None = None
    provider_resource: str | None = None
    rate: float | None = None
    pitch: int | None = None
    vol: int | None = None
