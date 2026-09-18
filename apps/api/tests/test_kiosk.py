"""Kiosk wall-display tests.

Pins the security contract: token-only public access, owner isolation,
PRIVATE masking, and the kiosk.manage gate on the admin surface.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.routers import kiosk_router as kiosk
from app.routers import public_kiosk_router as pub
from app.routers.kiosk_router import KioskCreate
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import (
    ActorType, CalendarKind, EventVisibility, ProviderType, UserRole,
)
from chronarch_core.models.kiosk import KioskDisplay
from chronarch_core.models.user import User
from chronarch_core.permissions import AuthContext


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


async def _host(session, email="host@x.com"):
    user = User(id=f"u-{email}", email=email, display_name="Host",
                password_hash="x", role=UserRole.ADMIN, is_active=True,
                home_timezone="UTC",
                working_hours_start="09:00", working_hours_end="17:00")
    session.add(user)
    await session.flush()
    account = Account(owner_user_id=user.id, provider=ProviderType.GOOGLE,
                      provider_account_email=email, provider_account_id=email)
    session.add(account)
    await session.flush()
    calendar = Calendar(account_id=account.id, provider_calendar_id="g:kiosk",
                        kind=CalendarKind.PRIMARY, name="Work",
                        provider_writable=True, blocks_availability=True)
    session.add(calendar)
    await session.flush()
    return user, calendar


async def _event(session, user, calendar, title="Standup", visibility=None):
    from chronarch_core import ai_tools

    ctx = AuthContext(user_id=user.id, role=UserRole.ADMIN, actor_type=ActorType.ADMIN_UI)
    created = await ai_tools.create_event(
        session, ctx, calendar_id=calendar.id, title=title,
        start=_utc(2026, 9, 22, 15, 0), end=_utc(2026, 9, 22, 16, 0), is_owner=True)
    if visibility is not None:
        created.visibility = visibility
        await session.flush()
    return created


async def test_create_validate_and_isolate(session):
    from fastapi import HTTPException

    from chronarch_core import rbac as _rbac

    user, _ = await _host(session)
    created = await kiosk.create_display(
        KioskCreate(name="Kitchen", location_label="Edmonton",
                    sleep_start="21:30", sleep_end="06:30"),
        user=user, session=session)
    assert created["url_path"].startswith("/kiosk/")
    assert created["token"] and len(created["token"]) >= 32
    listed = await kiosk.list_displays(user=user, session=session)
    assert len(listed) == 1 and "token" not in listed[0]

    with pytest.raises(HTTPException) as exc:
        await kiosk.create_display(KioskCreate(name="Bad", sleep_start="25:00"),
                                   user=user, session=session)
    assert exc.value.status_code == 422

    # RBAC gate: admins pass, bare delegates don't (enforced by
    # require_permission at the HTTP layer).
    delegate = User(id="u-delegate", email="ea@x.com", display_name="EA",
                    password_hash="x", role=UserRole.DELEGATE, is_active=True)
    session.add(delegate)
    await session.flush()
    assert await _rbac.has_permission(session, user, "kiosk.manage") is True
    assert await _rbac.has_permission(session, delegate, "kiosk.manage") is False
    assert await _rbac.has_permission(session, delegate, "kiosk.view") is False

    # Cross-owner isolation on the admin surface: a second admin sees
    # nothing of the first admin's displays.
    outsider, _ = await _host(session, email="other@x.com")
    assert await kiosk.list_displays(user=outsider, session=session) == []
    from app.routers.kiosk_router import KioskUpdate

    for op in (lambda: kiosk.update_display(created["id"], KioskUpdate(name="Hijacked"),
                                            user=outsider, session=session),
               lambda: kiosk.rotate_token(created["id"], user=outsider, session=session),
               lambda: kiosk.delete_display(created["id"], user=outsider, session=session)):
        with pytest.raises(HTTPException) as exc:
            await op()
        assert exc.value.status_code == 404


async def test_public_meta_and_unknown_token(session):
    from fastapi import HTTPException

    user, _ = await _host(session)
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    meta = await pub.display_meta(created["token"], session=session)
    assert meta["name"] == "Hall" and meta["sleep_start"] == "22:00"

    with pytest.raises(HTTPException) as exc:
        await pub.display_meta("bogus-token", session=session)
    assert exc.value.status_code == 404


async def test_revoked_display_goes_dark(session):
    from fastapi import HTTPException

    user, _ = await _host(session)
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    row = (await session.execute(
        select(KioskDisplay).where(KioskDisplay.id == created["id"]))).scalar_one()
    row.active = False
    await session.flush()
    with pytest.raises(HTTPException) as exc:
        await pub.display_agenda(created["token"], session=session)
    assert exc.value.status_code == 404


async def test_agenda_masks_private_and_isolates_owners(session):
    user, calendar = await _host(session)
    await _event(session, user, calendar, title="Team sync")
    await _event(session, user, calendar, title="Therapy", visibility=EventVisibility.PRIVATE)
    outsider, outsider_cal = await _host(session, email="other@x.com")
    await _event(session, outsider, outsider_cal, title="Stranger meeting")

    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    agenda = await pub.display_agenda(created["token"], session=session)
    by_title = {e["title"]: e for e in agenda["events"]}

    assert "Team sync" in by_title
    assert "Therapy" not in by_title
    assert "Busy" in by_title and by_title["Busy"]["masked"] is True
    assert by_title["Busy"]["location"] is None
    assert "Stranger meeting" not in by_title


async def test_rotate_and_delete(session):
    user, _ = await _host(session)
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    old_token = created["token"]
    rotated = await kiosk.rotate_token(created["id"], user=user, session=session)
    assert rotated["token"] != old_token

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await pub.display_meta(old_token, session=session)
    assert exc.value.status_code == 404

    assert await kiosk.delete_display(created["id"], user=user, session=session) is None
    with pytest.raises(HTTPException) as exc:
        await pub.display_meta(rotated["token"], session=session)
    assert exc.value.status_code == 404


async def test_pair_code_flow_end_to_end(session):
    from fastapi import HTTPException

    from app.routers.kiosk_router import PairApprove
    from app.routers.public_kiosk_router import PairCodeRequest

    user, _ = await _host(session)
    code_res = await pub.request_pair_code(
        PairCodeRequest(name="Lobby TV", location_label="Edmonton"))
    assert len(code_res["code"]) == 6 and code_res["code"].isdigit()

    pending = await pub.pair_status(code_res["pairing_id"])
    assert pending == {"status": "pending"}

    paired = await kiosk.pair_with_code(PairApprove(code=code_res["code"]),
                                        user=user, session=session)
    assert paired["name"] == "Lobby TV"
    assert paired["location_label"] == "Edmonton"
    assert paired["url_path"].startswith("/kiosk/")

    delivered = await pub.pair_status(code_res["pairing_id"])
    assert delivered == {"status": "approved", "token": paired["token"]}

    # Single-shot delivery: the token comes back once.
    with pytest.raises(HTTPException) as exc:
        await pub.pair_status(code_res["pairing_id"])
    assert exc.value.status_code == 404

    # Single-use code: pairing again with the same code fails.
    with pytest.raises(HTTPException) as exc:
        await kiosk.pair_with_code(PairApprove(code=code_res["code"]),
                                   user=user, session=session)
    assert exc.value.status_code == 404


async def test_pair_wrong_code_rejected(session):
    from fastapi import HTTPException

    from app.routers.kiosk_router import PairApprove

    user, _ = await _host(session)
    with pytest.raises(HTTPException) as exc:
        await kiosk.pair_with_code(PairApprove(code="000000"), user=user, session=session)
    assert exc.value.status_code == 404


async def test_pairing_store_single_use():
    from chronarch_core.kiosk_pairing import PairingStore

    store = PairingStore(None)
    created = await store.create("Screen", "")
    assert await store.approve(created["code"], "tok-1") == created["pairing_id"]
    assert await store.approve(created["code"], "tok-2") is None
    assert await store.peek(created["code"]) is None


async def test_agenda_start_and_calendars(session):
    user, calendar = await _host(session)
    await _event(session, user, calendar, title="Team sync")
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)

    full = await pub.display_agenda(created["token"], session=session)
    assert {c["name"] for c in full["calendars"]} == {"Work"}
    assert any(e["title"] == "Team sync" for e in full["events"])

    # Week nav: starting after the event shows an empty week.
    later = await pub.display_agenda(created["token"], start="2026-09-23T00:00:00+00:00",
                                     session=session)
    assert later["events"] == []
    assert later["calendars"] == full["calendars"]

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await pub.display_agenda(created["token"], start="not-a-date", session=session)
    assert exc.value.status_code == 422


async def test_kiosk_quick_add_create(session):
    from chronarch_core.models.event import UnifiedEvent

    user, _ = await _host(session)
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    out = await pub.kiosk_quick_add_create(
        created["token"],
        pub.KioskQuickAddCreate(draft={
            "title": "Dentist", "start": "2026-09-24T15:00:00+00:00",
            "end": "2026-09-24T15:30:00+00:00"}),
        session=session)
    assert out["title"] == "Dentist" and out["calendar_name"] == "Work"
    stored = await session.get(UnifiedEvent, out["id"])
    assert stored is not None and stored.title == "Dentist"

    agenda = await pub.display_agenda(
        created["token"], start="2026-09-24T00:00:00+00:00", days=1, session=session)
    assert "Dentist" in {e["title"] for e in agenda["events"]}


async def test_kiosk_quick_add_parse_empty(session):
    from fastapi import HTTPException

    user, _ = await _host(session)
    created = await kiosk.create_display(KioskCreate(name="Hall"), user=user, session=session)
    with pytest.raises(HTTPException) as exc:
        await pub.kiosk_quick_add_parse(
            created["token"], pub.KioskQuickAddParse(text="   "), session=session)
    assert exc.value.status_code == 422


