"""ai litellm settings singleton (UI-managed OpenRouter key + model routing)

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-11

Creates only the ai_litellm_settings table. Like 0001/0002, the model is the
source of truth — this migration just materializes the one new table so
existing deployments pick it up with a normal `alembic upgrade head`.
"""
from typing import Sequence, Union

from alembic import op

from chronarch_core.models.ai_settings import AILiteLLMSettings

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    AILiteLLMSettings.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    AILiteLLMSettings.__table__.drop(bind, checkfirst=True)
