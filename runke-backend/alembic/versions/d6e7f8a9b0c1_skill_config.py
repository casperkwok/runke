"""skill config (自带配置，如飞书多维表格回写)

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("skills", sa.Column("config", JSONB, nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("skills", "config")
