import os
import warnings
from urllib.parse import urlparse

_INSECURE_JWT_VALUES = {"", "dev-secret-change-me", "change-me-to-a-random-string"}

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if JWT_SECRET in _INSECURE_JWT_VALUES:
    if os.environ.get("ALLOW_INSECURE_DEV_SECRET") != "1":
        raise RuntimeError(
            "JWT_SECRET is not set (or is still the placeholder). Generate one with: "
            "python -c 'import secrets; print(secrets.token_urlsafe(48))' "
            "and set it in .env. For throwaway local dev only, set "
            "ALLOW_INSECURE_DEV_SECRET=1 instead."
        )
    warnings.warn(
        "Using an insecure JWT_SECRET for local dev (ALLOW_INSECURE_DEV_SECRET=1). "
        "Never enable this in production.",
        UserWarning,
        stacklevel=2,
    )
    JWT_SECRET = "dev-secret-change-me"
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))
# "Remember me" sessions: long-lived JWTs for users who opt in at login.
# Revocable via the same Redis jti blocklist as short sessions.
REMEMBER_ME_DAYS = int(os.environ.get("REMEMBER_ME_DAYS", "30"))

# Public origin the browser uses to reach this deployment — used to build
# OAuth redirect URIs (must exactly match what's registered with the
# provider) and where the OAuth callback sends the browser back to.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").strip().lower()


def get_cors_origins() -> list[str]:
    """Allowed browser origins for the REST API.

    Set CORS_ORIGINS as a comma-separated list in production, e.g.
    `CORS_ORIGINS=https://calendar.example.com`. Defaults to APP_BASE_URL
    (single-origin, credentials-safe). A wildcard `*` is only honored
    without credentials — see main.py.
    """
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        if raw.strip() == "*":
            return ["*"]
        return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return [APP_BASE_URL.rstrip("/")]


CORS_ORIGINS = get_cors_origins()

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def validate_runtime_config() -> None:
    """Fail closed for production instead of silently using dev fallbacks."""
    if ENVIRONMENT not in {"production", "prod"}:
        return

    parsed = urlparse(APP_BASE_URL)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Production APP_BASE_URL must be an absolute HTTPS URL on a public hostname")
    if not CORS_ORIGINS or CORS_ORIGINS == ["*"] or any(
        urlparse(origin).scheme != "https" or urlparse(origin).hostname in {"localhost", "127.0.0.1", "::1"}
        for origin in CORS_ORIGINS
    ):
        raise RuntimeError("Production CORS_ORIGINS must contain only explicit HTTPS origins")
    if os.environ.get("ALLOW_INSECURE_DEV_SECRET") == "1" or JWT_SECRET in _INSECURE_JWT_VALUES:
        raise RuntimeError("ALLOW_INSECURE_DEV_SECRET is forbidden in production")
    if not os.environ.get("LITELLM_MASTER_KEY") or os.environ["LITELLM_MASTER_KEY"] == "sk-litellm-dev":
        raise RuntimeError("LITELLM_MASTER_KEY must be explicitly configured in production")
    if not REDIS_URL or "localhost" in REDIS_URL or "127.0.0.1" in REDIS_URL:
        raise RuntimeError("Production REDIS_URL must point to the configured Redis service")

# Rate limiting settings (requests per window)
LOGIN_RATE_LIMIT_REQUESTS = int(os.environ.get("LOGIN_RATE_LIMIT_REQUESTS", "10"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "60"))
PASSWORD_RATE_LIMIT_REQUESTS = int(os.environ.get("PASSWORD_RATE_LIMIT_REQUESTS", "5"))
PASSWORD_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("PASSWORD_RATE_LIMIT_WINDOW_SECONDS", "60"))

# Public self-signup. Default OFF: accounts are created by an admin (or the
# seed script). Set ALLOW_SIGNUPS=true to expose registration — every
# signup is a workspace admin, so the gate is the access control.
ALLOW_SIGNUPS = os.environ.get("ALLOW_SIGNUPS", "false").strip().lower() in ("1", "true", "yes")

# SMTP Email Configuration
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", SMTP_USER or "noreply@chronarch.internal")
SMTP_TLS = os.environ.get("SMTP_TLS", "true").lower() in ("true", "1", "yes")
