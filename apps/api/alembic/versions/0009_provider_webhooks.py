"""Provider push-subscription table (BRD §24 webhooks).

Model is the source of truth (like 0002/0003): materializes provider_webhooks
for existing deployments.
"""

from typing import Sequence, Union

from alembic import op

from chronarch_core.models.webhook import ProviderWebhook

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    ProviderWebhook.__table__.create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    ProviderWebhook.__table__.drop(bind, checkfirst=True)
