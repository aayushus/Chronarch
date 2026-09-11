"""oauth provider configs (UI-managed client credentials)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-11

Creates only the oauth_provider_configs table (admin-configured Google /
Microsoft OAuth client credentials). Like 0001, the model is the source of
truth — this migration just materializes the one new table so existing
deployments pick it up with a normal `alembic upgrade head`.
"""
from typing import Sequence, Union

from alembic import op

from chronarch_core.models.oauth_config import OAuthProviderConfig

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    OAuthProviderConfig.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    OAuthProviderConfig.__table__.drop(bind, checkfirst=True)
