"""api tokens

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bot_id", sa.Uuid(), sa.ForeignKey("bots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False, server_default="Runke-Token"),
        sa.Column("prefix", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_api_tokens_owner_id", "api_tokens", ["owner_id"])
    op.create_index("ix_api_tokens_bot_id", "api_tokens", ["bot_id"])
    op.create_index("ix_api_tokens_key_hash", "api_tokens", ["key_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_api_tokens_key_hash", table_name="api_tokens")
    op.drop_index("ix_api_tokens_bot_id", table_name="api_tokens")
    op.drop_index("ix_api_tokens_owner_id", table_name="api_tokens")
    op.drop_table("api_tokens")
