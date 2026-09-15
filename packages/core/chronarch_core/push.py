"""Provider push-notification plumbing (BRD §24).

Polling stays the baseline everywhere; push is opportunistic and only
armed when this deployment is publicly reachable (https + public host).
Everything else — unknown hosts, localhost, plain http — keeps polling
with zero errors: `push_enabled()` is the single gate every caller uses.
"""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlparse
import ipaddress
import secrets

GOOGLE_CALLBACK_PATH = "/api/v1/webhooks/google"
MICROSOFT_CALLBACK_PATH = "/api/v1/webhooks/microsoft"

# Requested lifetimes (renewal runs hourly and refreshes well before these).
GOOGLE_CHANNEL_LIFETIME = timedelta(days=6)
GOOGLE_RENEW_WITHIN = timedelta(hours=36)
MICROSOFT_SUBSCRIPTION_LIFETIME = timedelta(hours=48)
MICROSOFT_RENEW_WITHIN = timedelta(hours=12)


def _is_public_hostname(hostname: str) -> bool:
    host = (hostname or "").lower().rstrip(".")
    if not host or host == "localhost":
        return False
    if host.endswith((".local", ".localhost", ".internal", ".invalid", ".test")):
        return False
    if "." not in host:
        return False
    try:
        return not ipaddress.ip_address(host).is_private
    except ValueError:
        pass
    if host in ("127.0.0.1", "::1"):
        return False
    try:
        # Literal IPs that aren't private here are still unreachable for
        # provider callbacks in practice (NAT); require a real hostname.
        ipaddress.ip_address(host)
        return False
    except ValueError:
        return True


def push_enabled(base_url: str | None) -> tuple[bool, str]:
    """Whether provider callbacks can reach this deployment."""
    if not base_url:
        return False, "APP_BASE_URL is not set"
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        return False, f"callback URL must be https (APP_BASE_URL is {parsed.scheme or 'unset'})"
    if not _is_public_hostname(parsed.hostname or ""):
        return False, f"{parsed.hostname} is not publicly reachable"
    return True, ""


def callback_url(base_url: str, provider: str) -> str:
    path = GOOGLE_CALLBACK_PATH if provider == "google" else MICROSOFT_CALLBACK_PATH
    return base_url.rstrip("/") + path


def new_channel_secret() -> str:
    return secrets.token_urlsafe(32)
