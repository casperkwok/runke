"""voices(音色库) + bot.voice_config

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bots", sa.Column("voice_config", JSONB, nullable=False, server_default="{}"))
    op.create_table(
        "voices",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("gender", sa.String(length=8), nullable=False, server_default="女"),
        sa.Column("lang", sa.String(length=40), nullable=False, server_default="中文 · 普通话"),
        sa.Column("tags", JSONB, nullable=False, server_default="[]"),
        sa.Column("scene", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("sample", sa.Text, nullable=False, server_default=""),
        sa.Column("provider_voice", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("rate", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("pitch", sa.Integer, nullable=False, server_default="0"),
        sa.Column("vol", sa.Integer, nullable=False, server_default="80"),
        sa.Column("system", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("cloned", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("voices")
    op.drop_column("bots", "voice_config")
