"""customer phone partial unique index (dedup)

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-06-07

"""
from alembic import op

revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 同一 owner 下「规范化手机号」唯一（手机号非空时生效），硬约束防重复客户
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_owner_phone "
        "ON customers (owner_id, regexp_replace(phone, '\\D', '', 'g')) "
        "WHERE phone <> ''"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_customer_owner_phone")
