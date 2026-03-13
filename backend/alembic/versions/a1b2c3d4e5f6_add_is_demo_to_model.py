"""add_is_demo_to_model

Revision ID: a1b2c3d4e5f6
Revises: 7e8fcec48d54
Create Date: 2026-03-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '7e8fcec48d54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('models', sa.Column('is_demo', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('models', 'is_demo')
