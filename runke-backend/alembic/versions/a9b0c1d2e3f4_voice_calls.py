"""call_tasks(语音外呼任务) + call_records(通话记录)

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "a9b0c1d2e3f4"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "call_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("bot_id", UUID(as_uuid=True), sa.ForeignKey("bots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("voice_id", UUID(as_uuid=True), sa.ForeignKey("voices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pack_id", UUID(as_uuid=True), sa.ForeignKey("customer_packs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("total", sa.Integer, nullable=False, server_default="0"),
        sa.Column("connected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("done", sa.Integer, nullable=False, server_default="0"),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "call_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("bot_id", UUID(as_uuid=True), sa.ForeignKey("bots.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("call_tasks.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("conversation_id", UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_id", UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("contact", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("direction", sa.String(length=16), nullable=False, server_default="preview"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="completed"),
        sa.Column("duration_sec", sa.Integer, nullable=False, server_default="0"),
        sa.Column("summary", sa.Text, nullable=False, server_default=""),
        sa.Column("intent", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("transcript", JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("call_records")
    op.drop_table("call_tasks")
