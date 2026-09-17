import logging
from typing import Optional

from fastapi import HTTPException, Request, status

from .auth import get_redis_client

logger = logging.getLogger(__name__)


class RateLimiter:
    """Fixed-window rate limiter backed by Redis.

    Returns HTTP 429 Too Many Requests with a Retry-After header
    when the caller exceeds `requests` within `window_seconds`.
    Fails open with a warning if Redis is unreachable.
    """

    def __init__(
        self,
        requests: int,
        window_seconds: int,
        key_prefix: str,
        by_ip: bool = True,
    ):
        self.requests = requests
        self.window_seconds = window_seconds
        self.key_prefix = key_prefix
        self.by_ip = by_ip

    def _get_identifier(self, request: Request) -> str:
        if self.by_ip:
            # request.client.host is the TCP peer address, set by the ASGI
            # server itself and not spoofable by the caller. X-Forwarded-For
            # is client-supplied and would let a caller reset their own
            # rate-limit bucket on every request by sending a new value.
            return request.client.host if request.client else "127.0.0.1"
        # If not by IP, use authenticated user id if present, else fallback to IP
        user = getattr(request.state, "user", None)
        if user and hasattr(user, "id"):
            return f"user:{user.id}"
        return request.client.host if request.client else "127.0.0.1"

    async def __call__(self, request: Request) -> None:
        identifier = self._get_identifier(request)
        key = f"rate_limit:{self.key_prefix}:{identifier}"

        try:
            r = get_redis_client()
            current = await r.incr(key)
            if current == 1:
                await r.expire(key, self.window_seconds)

            if current > self.requests:
                ttl = await r.ttl(key)
                retry_after = str(max(ttl, 1))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
                    headers={"Retry-After": retry_after},
                )
        except HTTPException:
            raise
        except Exception as exc:
            # Fail-open if Redis is temporarily unreachable
            logger.warning("Redis rate limiter check failed for %s: %s", key, exc)
