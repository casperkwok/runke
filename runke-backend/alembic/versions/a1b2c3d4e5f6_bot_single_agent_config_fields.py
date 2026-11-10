"""bot single-agent config fields

avatar / system_prompt / examples / model / model_params / capabilities / published

Revision ID: a1b2c3d4e5f6
Revises: 387cabf3dc3f
Create Date: 2026-06-06 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '387cabf3dc3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_PARAMS = '{"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}'
_DEFAULT_CAPS = '{"web": false, "image": false, "memory": false}'


def upgrade() -> None:
    op.add_column('bots', sa.Column('avatar', sa.String(length=255), nullable=False, server_default=''))
    op.add_column('bots', sa.Column('system_prompt', sa.Text(), nullable=False, server_default=''))
    op.add_column('bots', sa.Column('examples', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))
    op.add_column('bots', sa.Column('model', sa.String(length=120), nullable=False, server_default=''))
    op.add_column('bots', sa.Column('model_params', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_DEFAULT_PARAMS))
    op.add_column('bots', sa.Column('capabilities', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_DEFAULT_CAPS))
    op.add_column('bots', sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('bots', 'published')
    op.drop_column('bots', 'capabilities')
    op.drop_column('bots', 'model_params')
    op.drop_column('bots', 'model')
    op.drop_column('bots', 'examples')
    op.drop_column('bots', 'system_prompt')
    op.drop_column('bots', 'avatar')
