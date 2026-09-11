import os
import warnings

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

# Public origin the browser uses to reach this deployment — used to build
# OAuth redirect URIs (must exactly match what's registered with the
# provider) and where the OAuth callback sends the browser back to.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")


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

# Rate limiting settings (requests per window)
LOGIN_RATE_LIMIT_REQUESTS = int(os.environ.get("LOGIN_RATE_LIMIT_REQUESTS", "10"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "60"))
PASSWORD_RATE_LIMIT_REQUESTS = int(os.environ.get("PASSWORD_RATE_LIMIT_REQUESTS", "5"))
PASSWORD_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("PASSWORD_RATE_LIMIT_WINDOW_SECONDS", "60"))

