"""Per-provider AI keys (Groq + Gemini alongside OpenRouter).

Adds encrypted key columns so each free tier is keyed independently; the
proxy falls back across providers when one is exhausted or down.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _columns("ai_litellm_settings")
    if "encrypted_groq_api_key" not in cols:
        op.add_column("ai_litellm_settings", sa.Column("encrypted_groq_api_key", sa.LargeBinary(), nullable=True))
    if "encrypted_gemini_api_key" not in cols:
        op.add_column("ai_litellm_settings", sa.Column("encrypted_gemini_api_key", sa.LargeBinary(), nullable=True))



def downgrade() -> None:
    op.drop_column("ai_litellm_settings", "encrypted_gemini_api_key")
    op.drop_column("ai_litellm_settings", "encrypted_groq_api_key")
