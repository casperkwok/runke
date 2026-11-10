"""voices.provider_resource（火山 resource_id 按音色区分）

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa

revision = "b0c1d2e3f4a5"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voices", sa.Column("provider_resource", sa.String(length=60), nullable=False, server_default="seed-tts-2.0"))


def downgrade() -> None:
    op.drop_column("voices", "provider_resource")
