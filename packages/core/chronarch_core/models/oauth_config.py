from typing import Optional

from sqlalchemy import String, LargeBinary, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin
from .enums import ProviderType


class OAuthProviderConfig(Base, TimestampMixin):
    """Admin-configured OAuth client credentials per provider (BRD §30).

    Lets admins set Google/Microsoft client IDs and secrets from the
    Settings > Accounts UI instead of requiring server env vars — the same
    Fernet envelope encryption as Account tokens (BRD §29) protects the
    secrets at rest. Env vars remain as fallback/override (DB wins when set).
    Secrets are never returned by any API: admin reads only get
    configured/not-configured flags.
    """

    __tablename__ = "oauth_provider_configs"

    provider: Mapped[ProviderType] = mapped_column(SAEnum(ProviderType), primary_key=True)

    encrypted_client_id: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    encrypted_client_secret: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    # Microsoft tenant (BR-CAL-002); unused by Google.
    tenant_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
