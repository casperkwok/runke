"""conversation human takeover + channel

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("human", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("conversations", sa.Column("channel", sa.String(length=20), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("conversations", "channel")
    op.drop_column("conversations", "human")
