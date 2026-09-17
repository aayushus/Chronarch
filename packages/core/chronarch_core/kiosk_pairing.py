"""Wall-display pairing codes (YouTube-style: code on screen, typed by admin).

Pending pairings live in Redis (primary) with a process-local fallback —
same pattern as booking `HoldStore`. Codes are 6 digits, single-use, and
short-lived; brute force is contained by the pair-attempt rate limiter on
the admin endpoint plus the tiny validity window.
"""

from __future__ import annotations

import json
import secrets
import time
import uuid

PAIR_TTL_SECONDS = 600
CODE_DIGITS = 6


def _new_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_DIGITS):06d}"


class PairingStore:
    """Pending kiosk pairings with Redis primary, memory fallback.

    Lifecycle: `create` (kiosk, unauthenticated) → `approve` (admin, typed
    code) → `status` (kiosk poll, delivers the display token once).
    """

    _memory: dict[str, tuple[dict, float]] = {}

    def __init__(self, redis_client=None):
        self._redis = redis_client

    def _key(self, pairing_id: str) -> str:
        return f"kioskpair:{pairing_id}"

    def _code_key(self, code: str) -> str:
        return f"kioskpaircode:{code}"

    async def create(self, name: str, location_label: str) -> dict:
        pairing_id = str(uuid.uuid4())
        code = _new_code()
        payload = {"code": code, "name": name, "location_label": location_label,
                   "approved_token": None}
        if self._redis is not None:
            try:
                await self._redis.set(self._key(pairing_id), json.dumps(payload),
                                      ex=PAIR_TTL_SECONDS)
                await self._redis.set(self._code_key(code), pairing_id, ex=PAIR_TTL_SECONDS)
                return {"pairing_id": pairing_id, "code": code,
                        "expires_in_seconds": PAIR_TTL_SECONDS}
            except Exception:
                pass
        self._memory[pairing_id] = (payload, time.monotonic() + PAIR_TTL_SECONDS)
        return {"pairing_id": pairing_id, "code": code,
                "expires_in_seconds": PAIR_TTL_SECONDS}

    async def _read(self, pairing_id: str) -> dict | None:
        if self._redis is not None:
            # Redis is the only place a pairing created in Redis-mode ever
            # lives (create() doesn't also write to _memory on success), so
            # a transient error here must propagate rather than fall
            # through to an always-empty _memory — otherwise a network
            # blip reads back as "pairing expired" instead of a retryable
            # failure.
            raw = await self._redis.get(self._key(pairing_id))
            if raw is not None:
                return json.loads(raw)
        held = self._memory.get(pairing_id)
        if held is None:
            return None
        payload, expires = held
        if expires <= time.monotonic():
            self._memory.pop(pairing_id, None)
            return None
        return payload

    async def _write(self, pairing_id: str, payload: dict) -> None:
        if self._redis is not None:
            try:
                await self._redis.set(self._key(pairing_id), json.dumps(payload),
                                      ex=PAIR_TTL_SECONDS, xx=True)
                return
            except Exception:
                pass
        held = self._memory.get(pairing_id)
        if held is not None:
            self._memory[pairing_id] = (payload, held[1])

    async def peek(self, code: str) -> dict | None:
        """Read a pending pairing without consuming it (admin previews
        name/location before committing the display row)."""
        code = (code or "").strip()
        if self._redis is not None:
            try:
                pairing_id = await self._redis.get(self._code_key(code))
                if pairing_id is None:
                    return None
                raw = await self._redis.get(self._key(pairing_id))
                if raw is None:
                    return None
                payload = json.loads(raw)
                if payload.get("approved_token"):
                    return None
                return {"pairing_id": pairing_id, "name": payload.get("name", ""),
                        "location_label": payload.get("location_label", "")}
            except Exception:
                pass
        for pairing_id, (payload, expires) in list(self._memory.items()):
            if expires <= time.monotonic():
                self._memory.pop(pairing_id, None)
                continue
            if payload.get("code") == code and not payload.get("approved_token"):
                return {"pairing_id": pairing_id, "name": payload.get("name", ""),
                        "location_label": payload.get("location_label", "")}
        return None

    async def approve(self, code: str, token: str) -> str | None:
        """Consume a code: bind the display token. Returns the pairing id,
        or None for unknown/expired/already-used codes."""
        code = (code or "").strip()
        if self._redis is not None:
            try:
                pairing_id = await self._redis.get(self._code_key(code))
                if pairing_id is None:
                    return None
                await self._redis.delete(self._code_key(code))
                raw = await self._redis.get(self._key(pairing_id))
                if raw is None:
                    return None
                payload = json.loads(raw)
                if payload.get("approved_token"):
                    return None
                payload["approved_token"] = token
                await self._redis.set(self._key(pairing_id), json.dumps(payload),
                                      ex=PAIR_TTL_SECONDS)
                return pairing_id
            except Exception:
                pass
        for pairing_id, (payload, expires) in list(self._memory.items()):
            if expires <= time.monotonic():
                self._memory.pop(pairing_id, None)
                continue
            if payload.get("code") == code and not payload.get("approved_token"):
                payload["approved_token"] = token
                return pairing_id
        return None

    async def status(self, pairing_id: str) -> dict | None:
        """Poll result. Approved deliveries are single-shot: the token is
        returned once, then the pairing is gone."""
        payload = await self._read(pairing_id)
        if payload is None:
            return None
        token = payload.get("approved_token")
        if not token:
            return {"status": "pending"}
        if self._redis is not None:
            try:
                await self._redis.delete(self._key(pairing_id))
            except Exception:
                pass
        self._memory.pop(pairing_id, None)
        return {"status": "approved", "token": token}
