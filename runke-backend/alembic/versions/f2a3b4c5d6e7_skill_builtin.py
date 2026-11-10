"""skill builtin action

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("skills", sa.Column("builtin", sa.String(length=40), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("skills", "builtin")
