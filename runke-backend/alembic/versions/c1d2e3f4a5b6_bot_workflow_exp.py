"""bot.workflow_exp（工作流实验区：实验图 + Copilot 对话，独立于正式 workflow_definition）

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bots", sa.Column("workflow_exp", JSONB, nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("bots", "workflow_exp")
