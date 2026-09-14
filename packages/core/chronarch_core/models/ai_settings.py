from typing import Optional

from sqlalchemy import String, Integer, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class AILiteLLMSettings(Base, TimestampMixin):
    """Admin-configured AI / LiteLLM settings (BRD §20.2-20.4), singleton row.

    Lets admins set the OpenRouter API key and model routing from Settings >
    AI / LiteLLM instead of editing `packages/litellm-config/config.yaml` and
    server env vars. The key is Fernet-encrypted at rest (same cipher as
    Account tokens, BRD §29) and never returned by any API — reads only
    report configured/not-configured. Unset fields fall back to the shipped
    defaults in `chronarch_core.ai_config.DEFAULTS`.

    Applying to the proxy: the admin router renders these into the shared
    litellm-dynamic volume (see `chronarch_core.ai_config`); the litellm
    container watches that volume and reloads itself within seconds.
    """

    __tablename__ = "ai_litellm_settings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="default")

    # One encrypted key per provider (BRD §29, same cipher as Account
    # tokens). Providers are independent free tiers — the proxy falls back
    # across them, so exhausting one never takes the copilot down.
    encrypted_openrouter_api_key: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    encrypted_groq_api_key: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    encrypted_gemini_api_key: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    primary_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    fallback_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    emergency_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    routing_strategy: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    timeout_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
