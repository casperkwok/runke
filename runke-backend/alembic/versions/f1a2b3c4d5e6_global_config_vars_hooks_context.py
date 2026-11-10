"""global config: bot variables/data_hooks/context + conversation variables

Revision ID: f1a2b3c4d5e6
Revises: e082e44486b7
Create Date: 2026-06-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f1a2b3c4d5e6"
down_revision = "e082e44486b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bots", sa.Column("variables", JSONB(), nullable=False, server_default="[]"))
    op.add_column("bots", sa.Column("data_hooks", JSONB(), nullable=False, server_default="[]"))
    op.add_column(
        "bots",
        sa.Column("context_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("bots", sa.Column("context_template", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "conversations", sa.Column("variables", JSONB(), nullable=False, server_default="{}")
    )


def downgrade() -> None:
    op.drop_column("conversations", "variables")
    op.drop_column("bots", "context_template")
    op.drop_column("bots", "context_enabled")
    op.drop_column("bots", "data_hooks")
    op.drop_column("bots", "variables")
