"""add_teams_users_memberships

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-03-14 10:00:00.000000

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Legacy teams carried over from the hardcoded frontend constant
_LEGACY_TEAMS = [
    ('ML Platform',      'ml-platform'),
    ('Risk Engine',      'risk-engine'),
    ('Growth',           'growth'),
    ('Search',           'search'),
    ('Recommendations',  'recommendations'),
    ('NLP Core',         'nlp-core'),
]


def upgrade() -> None:
    op.create_table(
        'teams',
        sa.Column('id',              sa.String(36),  primary_key=True),
        sa.Column('name',            sa.String(200), nullable=False, unique=True),
        sa.Column('slug',            sa.String(200), nullable=False, unique=True),
        sa.Column('description',     sa.Text(),      nullable=True),
        sa.Column('external_id',     sa.String(200), nullable=True),
        sa.Column('external_source', sa.String(50),  nullable=True),
        sa.Column('created_at',      sa.DateTime(),  nullable=False),
        sa.Column('updated_at',      sa.DateTime(),  nullable=False),
    )

    op.create_table(
        'users',
        sa.Column('id',              sa.String(36),  primary_key=True),
        sa.Column('email',           sa.String(200), nullable=False, unique=True),
        sa.Column('display_name',    sa.String(200), nullable=False),
        sa.Column('external_id',     sa.String(200), nullable=True),
        sa.Column('external_source', sa.String(50),  nullable=True),
        sa.Column('is_active',       sa.Boolean(),   nullable=False, server_default='1'),
        sa.Column('created_at',      sa.DateTime(),  nullable=False),
        sa.Column('updated_at',      sa.DateTime(),  nullable=False),
    )

    op.create_table(
        'team_memberships',
        sa.Column('id',         sa.String(36), primary_key=True),
        sa.Column('team_id',    sa.String(36), sa.ForeignKey('teams.id'), nullable=False),
        sa.Column('user_id',    sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('role',       sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('team_id', 'user_id', name='uq_team_user'),
    )

    # Seed legacy teams so existing model.team string values remain valid
    now = sa.func.now()
    teams_table = sa.table(
        'teams',
        sa.column('id', sa.String),
        sa.column('name', sa.String),
        sa.column('slug', sa.String),
        sa.column('description', sa.String),
        sa.column('external_id', sa.String),
        sa.column('external_source', sa.String),
        sa.column('created_at', sa.DateTime),
        sa.column('updated_at', sa.DateTime),
    )
    from datetime import datetime
    seed_now = datetime(2026, 3, 14, 10, 0, 0)
    op.bulk_insert(teams_table, [
        {
            'id': str(uuid.uuid4()),
            'name': name,
            'slug': slug,
            'description': None,
            'external_id': None,
            'external_source': None,
            'created_at': seed_now,
            'updated_at': seed_now,
        }
        for name, slug in _LEGACY_TEAMS
    ])


def downgrade() -> None:
    op.drop_table('team_memberships')
    op.drop_table('users')
    op.drop_table('teams')
