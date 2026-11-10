"""bot preset_key (拆分 bot_role 的预置匹配语义)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None

# 已知内置预置 key
_PRESET_KEYS = ("pet_doctor", "general")


def upgrade() -> None:
    op.add_column("bots", sa.Column("preset_key", sa.String(length=40), nullable=False, server_default=""))
    # 历史数据：bot_role 若是预置 key（非展示副标题），迁移到 preset_key 并清空 bot_role
    keys = ", ".join(f"'{k}'" for k in _PRESET_KEYS)
    op.execute(f"UPDATE bots SET preset_key = bot_role WHERE bot_role IN ({keys})")
    op.execute(f"UPDATE bots SET bot_role = '' WHERE bot_role IN ({keys})")


def downgrade() -> None:
    op.execute("UPDATE bots SET bot_role = preset_key WHERE preset_key <> '' AND bot_role = ''")
    op.drop_column("bots", "preset_key")
