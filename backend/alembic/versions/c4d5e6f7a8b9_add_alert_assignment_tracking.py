"""add_alert_assignment_tracking

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-03-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from alembic import op as _op
    from sqlalchemy import inspect
    conn = op.get_bind()
    existing = [col['name'] for col in inspect(conn).get_columns('alerts')]

    if 'assigned_to_user_id' not in existing:
        op.add_column('alerts', sa.Column('assigned_to_user_id', sa.String(36), nullable=True))
    if 'acknowledged_at' not in existing:
        op.add_column('alerts', sa.Column('acknowledged_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    from sqlalchemy import inspect
    conn = op.get_bind()
    existing = [col['name'] for col in inspect(conn).get_columns('alerts')]

    if 'acknowledged_at' in existing:
        op.drop_column('alerts', 'acknowledged_at')
    if 'assigned_to_user_id' in existing:
        op.drop_column('alerts', 'assigned_to_user_id')
