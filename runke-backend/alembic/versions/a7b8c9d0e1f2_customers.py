"""customers (CRM)

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "a7b8c9d0e1f2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("company", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("title", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("gender", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="lead"),
        sa.Column("intent", sa.String(length=4), nullable=True),
        sa.Column("agent", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("agent_type", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("stage", sa.String(length=40), nullable=False, server_default="线索生成"),
        sa.Column("owner", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", JSONB(), nullable=False, server_default="[]"),
        sa.Column("ai", JSONB(), nullable=False, server_default="{}"),
        sa.Column("records", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_customers_owner_id", "customers", ["owner_id"])
    op.create_index("ix_customers_name", "customers", ["name"])


def downgrade() -> None:
    op.drop_index("ix_customers_name", table_name="customers")
    op.drop_index("ix_customers_owner_id", table_name="customers")
    op.drop_table("customers")
