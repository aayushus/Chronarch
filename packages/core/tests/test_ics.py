import pytest
from datetime import datetime, timezone
from chronarch_core.ics import parse_ics_events, parse_ics_to_remote_events

SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chronarch//Test Calendar//EN
BEGIN:VEVENT
UID:test-event-1@chronarch.local
DTSTAMP:20260911T120000Z
DTSTART:20260915T140000Z
DTEND:20260915T150000Z
SUMMARY:Board Meeting
DESCRIPTION:Quarterly executive board alignment
LOCATION:Conference Room A
ORGANIZER;CN=Executive:mailto:exec@chronarch.local
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Sarah EA:mailto:sarah@chronarch.local
END:VEVENT
BEGIN:VEVENT
UID:test-event-2@chronarch.local
DTSTAMP:20260911T120000Z
DTSTART;VALUE=DATE:20260916
SUMMARY:All Day Strategy Retreat
LOCATION:Offsite
END:VEVENT
END:VCALENDAR"""


def test_parse_ics_events():
    events = parse_ics_events(SAMPLE_ICS)
    assert len(events) == 2

    # Timed event
    ev1 = events[0]
    assert ev1["title"] == "Board Meeting"
    assert ev1["location"] == "Conference Room A"
    assert ev1["description"] == "Quarterly executive board alignment"
    assert ev1["all_day"] is False
    assert ev1["organizer"]["email"] == "exec@chronarch.local"
    assert len(ev1["attendees"]) == 1
    assert ev1["attendees"][0]["email"] == "sarah@chronarch.local"

    # All-day event
    ev2 = events[1]
    assert ev2["title"] == "All Day Strategy Retreat"
    assert ev2["all_day"] is True
    assert ev2["location"] == "Offsite"


def test_parse_ics_to_remote_events():
    remotes = parse_ics_to_remote_events(SAMPLE_ICS)
    assert len(remotes) == 2
    assert remotes[0].provider_event_id == "test-event-1@chronarch.local"
    assert remotes[0].writable is False
    assert remotes[1].all_day is True


def test_parse_ics_to_remote_events_missing_uid_fallback():
    ics_no_uid = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260920T100000Z
DTEND:20260920T110000Z
SUMMARY:No UID Sync
END:VEVENT
END:VCALENDAR"""
    remotes = parse_ics_to_remote_events(ics_no_uid)
    assert len(remotes) == 1
    assert remotes[0].provider_event_id.startswith("ics-")
    assert len(remotes[0].provider_event_id) > 10


def test_validate_feed_url_ssrf():
    from chronarch_core.ics import _validate_feed_url

    with pytest.raises(ValueError, match="Connecting to local/internal network addresses is not allowed"):
        _validate_feed_url("http://127.0.0.1/feed.ics")

    with pytest.raises(ValueError, match="Invalid URL scheme"):
        _validate_feed_url("file:///etc/passwd")


# --- fetch_ics_feed redirect handling (E2E-011) ------------------------------
#
# `fetch_ics_feed` disables httpx's automatic redirect following and re-validates
# every hop itself. Validating only the URL the caller supplied is the classic
# SSRF bypass: an attacker hosts a public URL that 302s to 169.254.169.254 and
# every naive guard passes. Each hop must go back through the same validation.


class _FakeStream:
    def __init__(self, hop):
        self._hop = hop

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def is_redirect(self):
        return self._hop.get("location") is not None

    @property
    def headers(self):
        loc = self._hop.get("location")
        return {"location": loc} if loc else {}

    def raise_for_status(self):
        pass

    async def aiter_bytes(self):
        yield self._hop.get("body", b"")


class _FakeClient:
    """Serves canned per-URL hops and records the URL sequence requested."""

    def __init__(self, hops, **kwargs):
        self._hops = hops
        self.kwargs = kwargs
        self.requested = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method, url, headers=None):
        self.requested.append(url)
        return _FakeStream(self._hops.get(url, {}))


def _install_fake_client(monkeypatch, hops):
    created = {}

    def _factory(**kwargs):
        created["client"] = _FakeClient(hops, **kwargs)
        return created["client"]

    monkeypatch.setattr("chronarch_core.ics.httpx.AsyncClient", _factory)
    return created


def _resolve_public_ip(monkeypatch):
    """Pin DNS to a public address so the guard's real logic runs without
    touching the network (or depending on the sandbox's resolver)."""

    def _getaddrinfo(*args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr("chronarch_core.ics.socket.getaddrinfo", _getaddrinfo)


async def test_ics_redirect_to_loopback_is_rejected(monkeypatch):
    """A public URL that redirects to loopback must fail the hop guard."""
    from chronarch_core.ics import fetch_ics_feed

    _resolve_public_ip(monkeypatch)
    created = _install_fake_client(monkeypatch, {
        "https://public.example.com/feed.ics": {"location": "http://127.0.0.1/admin"},
    })

    with pytest.raises(ValueError, match="not allowed"):
        await fetch_ics_feed("https://public.example.com/feed.ics")

    assert created["client"].requested == [
        "https://public.example.com/feed.ics",
    ], "the request must be refused before the second hop is issued"


async def test_ics_redirect_to_link_local_metadata_is_rejected(monkeypatch):
    """Cloud metadata endpoints are the highest-value SSRF target."""
    from chronarch_core.ics import fetch_ics_feed

    created = _install_fake_client(monkeypatch, {
        "https://public.example.com/feed.ics": {
            "location": "http://169.254.169.254/latest/meta-data/",
        },
    })

    with pytest.raises(ValueError, match="private or reserved"):
        await fetch_ics_feed("https://public.example.com/feed.ics")

    assert created["client"].requested == ["https://public.example.com/feed.ics"]


async def test_ics_redirect_to_file_scheme_is_rejected(monkeypatch):
    """A hop that downgrades to a non-HTTP scheme must be refused."""
    from chronarch_core.ics import fetch_ics_feed

    _install_fake_client(monkeypatch, {
        "https://public.example.com/feed.ics": {"location": "file:///etc/passwd"},
    })

    with pytest.raises(ValueError, match="Invalid URL scheme"):
        await fetch_ics_feed("https://public.example.com/feed.ics")


async def test_ics_follows_redirect_chain_between_public_hosts(monkeypatch):
    """Legitimate multi-hop redirects still resolve to the feed body."""
    from chronarch_core.ics import fetch_ics_feed

    _resolve_public_ip(monkeypatch)
    created = _install_fake_client(monkeypatch, {
        "https://public.example.com/feed.ics": {
            "location": "https://cdn.example.net/real.ics",
        },
        "https://cdn.example.net/real.ics": {"body": SAMPLE_ICS.encode()},
    })

    body = await fetch_ics_feed("https://public.example.com/feed.ics")

    assert body == SAMPLE_ICS.encode()
    assert created["client"].requested == [
        "https://public.example.com/feed.ics",
        "https://cdn.example.net/real.ics",
    ]


async def test_ics_relative_redirect_is_resolved_against_current_url(monkeypatch):
    from chronarch_core.ics import fetch_ics_feed

    _resolve_public_ip(monkeypatch)
    _install_fake_client(monkeypatch, {
        "https://public.example.com/subs/feed.ics": {"location": "/moved.ics"},
        "https://public.example.com/moved.ics": {"body": SAMPLE_ICS.encode()},
    })

    body = await fetch_ics_feed("https://public.example.com/subs/feed.ics")

    assert body == SAMPLE_ICS.encode()


async def test_ics_redirect_without_location_is_rejected(monkeypatch):
    """A 3xx with no Location header is unusable, not a silent empty feed."""
    from chronarch_core.ics import fetch_ics_feed

    _resolve_public_ip(monkeypatch)

    class _RedirectNoLocation(_FakeStream):
        @property
        def is_redirect(self):
            return True

        @property
        def headers(self):
            return {}

    class _Client(_FakeClient):
        def stream(self, method, url, headers=None):
            self.requested.append(url)
            return _RedirectNoLocation({})

    created = _Client({}, follow_redirects=False, timeout=20.0)
    monkeypatch.setattr("chronarch_core.ics.httpx.AsyncClient", lambda **kw: created)

    with pytest.raises(ValueError, match="did not include a location"):
        await fetch_ics_feed("https://public.example.com/feed.ics")

    assert created.requested == ["https://public.example.com/feed.ics"]


async def test_ics_redirect_loop_is_bounded(monkeypatch):
    """An unbounded redirect chain must terminate instead of hanging."""
    from chronarch_core.ics import fetch_ics_feed

    created = _install_fake_client(monkeypatch, {
        "https://public.example.com/feed.ics": {
            "location": "https://public.example.com/feed.ics",
        },
    })

    with pytest.raises(ValueError, match="maximum redirect limit"):
        await fetch_ics_feed("https://public.example.com/feed.ics")

    assert len(created["client"].requested) == 6, "hop budget must be enforced"
