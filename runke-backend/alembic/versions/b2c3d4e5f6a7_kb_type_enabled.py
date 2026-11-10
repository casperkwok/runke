"""knowledge_base kb_type + enabled

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-06 20:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("knowledge_bases", sa.Column("kb_type", sa.String(length=20), nullable=False, server_default="text"))
    op.add_column("knowledge_bases", sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("knowledge_bases", "enabled")
    op.drop_column("knowledge_bases", "kb_type")
