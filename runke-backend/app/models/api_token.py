"""ApiToken：按 Bot 维度签发的访问令牌，供外部应用以 Bearer 调用该 Bot 对话接口。

只在创建时返回明文一次；库里仅存 sha256 哈希 + 展示用前缀。
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ApiToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "api_tokens"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    bot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bots.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), default="Runke-Token")
    prefix: Mapped[str] = mapped_column(String(20), default="")  # 展示用，如 rk-a1b2c3d4
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
