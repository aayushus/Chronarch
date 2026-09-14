"""Seed demo accounts/calendars/events for visual QA of the calendar UI.

Usage: python scripts/seed_demo.py exec@example.com [--reset]
(run seed_admin.py first to create that user)

Idempotent: re-running skips accounts/calendars/events that already exist.
--reset wipes all demo-seeded rows first (events with the demo marker plus
any accounts/calendars this script created).
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from sqlalchemy import select

from chronarch_core.db import SessionLocal
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import BusyStatus, CalendarKind, EventVisibility, ProviderType
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User

DEMO_MARKER = "seed_demo.py"

DEMO_ACCOUNTS = [
    ("acme-corp@example.com", ProviderType.MICROSOFT, [
        ("Calendar", "#0a84ff", True),
        ("Birthdays", "#ff9f0a", False),
        ("Holidays", "#30d158", False),
    ]),
    ("personal@example.com", ProviderType.GOOGLE, [
        ("Calendar", "#bf5af2", True),
        ("Family", "#ff375f", True),
    ]),
]


def _at(day_offset: int, hour: int, minute: int = 0) -> datetime:
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return base + timedelta(days=day_offset, hours=hour, minutes=minute)


async def main(email: str, reset: bool = False) -> None:
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"User {email} not found — run seed_admin.py first.")
            return

        if reset:
            await _reset_demo(session, user.id)

        calendars_by_name: dict[str, Calendar] = {}
        for account_email, provider, cal_specs in DEMO_ACCOUNTS:
            account = (
                await session.execute(
                    select(Account).where(
                        Account.owner_user_id == user.id,
                        Account.provider == provider,
                        Account.provider_account_email == account_email,
                    )
                )
            ).scalar_one_or_none()
            if account is None:
                account = Account(
                    owner_user_id=user.id, provider=provider,
                    provider_account_email=account_email, provider_account_id=account_email,
                )
                session.add(account)
                await session.flush()

            for name, color, writable in cal_specs:
                cal = (
                    await session.execute(
                        select(Calendar).where(
                            Calendar.account_id == account.id,
                            Calendar.provider_calendar_id == f"{account_email}:{name}",
                        )
                    )
                ).scalar_one_or_none()
                if cal is None:
                    cal = Calendar(
                        account_id=account.id, provider_calendar_id=f"{account_email}:{name}",
                        kind=CalendarKind.PRIMARY, name=name, color=color,
                        provider_writable=writable, visible=True, blocks_availability=True,
                        ea_can_view=True, ea_can_edit=writable,
                    )
                    session.add(cal)
                    await session.flush()
                calendars_by_name[f"{account_email}:{name}"] = cal

        work_cal = calendars_by_name["acme-corp@example.com:Calendar"]
        personal_cal = calendars_by_name["personal@example.com:Calendar"]
        family_cal = calendars_by_name["personal@example.com:Family"]
        birthdays_cal = calendars_by_name["acme-corp@example.com:Birthdays"]
        holidays_cal = calendars_by_name["acme-corp@example.com:Holidays"]

        # (calendar, title, start, end, all_day, attendees, extra kwargs)
        demo_events = [
            # ---- Today: a full day for Day view + copilot summaries ----
            (work_cal, "Weekly Alignment Call", _at(0, 8, 0), _at(0, 8, 30), False,
             [{"email": "sarah@acme.com", "name": "Sarah Lin", "response_status": "accepted"},
              {"email": "raj@acme.com", "name": "Raj Patel", "response_status": "needs_action"}], {}),
            (work_cal, "Sprint Demo", _at(0, 9, 0), _at(0, 10, 0), False,
             [{"email": "team@acme.com", "name": "Eng Team", "response_status": "accepted"}], {}),
            (work_cal, "FDE Stand-up", _at(0, 9, 15), _at(0, 9, 30), False, [], {}),
            (work_cal, "1:1 with Manager", _at(0, 11, 0), _at(0, 12, 0), False,
             [{"email": "manager@acme.com", "name": "Alex Chen", "response_status": "organizer"}], {}),
            (work_cal, "Release Status Review", _at(0, 13, 0), _at(0, 14, 0), False, [], {}),
            (work_cal, "Lunch with Priya (Vendor)", _at(0, 12, 30), _at(0, 13, 30), False,
             [{"email": "priya@vendor.io", "name": "Priya Nair", "response_status": "accepted"}],
             {"location": "Cafe Luna"}),
            # ---- Tomorrow: external guests + conflict pair for warning demo ----
            (personal_cal, "Dentist Appointment", _at(1, 15, 0), _at(1, 16, 0), False, [],
             {"location": "Bright Smile Clinic"}),
            (work_cal, "Design Review with Acme Labs", _at(1, 10, 0), _at(1, 11, 0), False,
             [{"email": "jordan@acmelabs.com", "name": "Jordan Wu", "response_status": "accepted"},
              {"email": "sarah@acme.com", "name": "Sarah Lin", "response_status": "accepted"}], {}),
            (work_cal, "Investor Update (overlaps)", _at(1, 10, 30), _at(1, 11, 30), False,
             [{"email": "cfo@acme.com", "name": "CFO", "response_status": "needs_action"}], {}),
            (birthdays_cal, "Sonal's Birthday", _at(1, 0, 0), _at(2, 0, 0), True, [], {}),
            # ---- This week ----
            (personal_cal, "Flight to Denver", _at(2, 17, 15), _at(2, 19, 55), False, [],
             {"location": "SFO → DEN", "description": "UA 1234, confirmation ABC123"}),
            (family_cal, "Soccer Practice (Ari)", _at(3, 17, 0), _at(3, 18, 0), False, [],
             {"location": "Community Field"}),
            (work_cal, "Deep Work Block", _at(4, 9, 0), _at(4, 11, 0), False, [],
             {"busy_status": BusyStatus.BUSY, "description": "No meetings — shipping the sync engine."}),
            (personal_cal, "Therapy (private)", _at(4, 16, 0), _at(4, 17, 0), False, [],
             {"visibility": EventVisibility.PRIVATE}),
            # ---- Next week ----
            (work_cal, "Q3 Planning Session", _at(8, 10, 0), _at(8, 12, 0), False,
             [{"email": "sarah@acme.com", "name": "Sarah Lin", "response_status": "accepted"},
              {"email": "consultant@outside.co", "name": "Robin Grey", "response_status": "needs_action"}],
             {"location": "Board Room"}),
            (family_cal, "Weekend Hike", _at(9, 8, 0), _at(9, 12, 0), False, [], {}),
            # ---- Month view: multi-day + holiday ----
            (work_cal, "Offsite Conference", _at(14, 9, 0), _at(16, 17, 0), False,
             [{"email": "team@acme.com", "name": "Eng Team", "response_status": "accepted"}],
             {"location": "Moscone Center"}),
            (holidays_cal, "Company Holiday", _at(20, 0, 0), _at(21, 0, 0), True, [],
             {"busy_status": BusyStatus.FREE}),
            # ---- Year view dots across months ----
            (work_cal, "Board Meeting", _at(30, 14, 0), _at(30, 15, 30), False,
             [{"email": "board@acme.com", "name": "Board", "response_status": "accepted"}], {}),
            (personal_cal, "Anniversary Dinner", _at(45, 19, 0), _at(45, 21, 0), False, [],
             {"location": "Chez Panisse"}),
            (family_cal, "Thanksgiving Travel", _at(75, 8, 0), _at(78, 20, 0), False, [],
             {"location": "ORD → SFO"}),
            (work_cal, "Performance Reviews", _at(-10, 10, 0), _at(-10, 12, 0), False, [], {}),
        ]

        created = 0
        for cal, title, start, end, all_day, attendees, extra in demo_events:
            exists = (
                await session.execute(
                    select(UnifiedEvent).where(
                        UnifiedEvent.calendar_id == cal.id,
                        UnifiedEvent.title == title,
                        UnifiedEvent.start == start,
                    )
                )
            ).scalar_one_or_none()
            if exists is not None:
                continue
            session.add(
                UnifiedEvent(
                    provider_account_id=cal.account_id, calendar_id=cal.id, provider_event_id="",
                    title=title, start=start, end=end, all_day=all_day,
                    attendees=attendees, busy_status=extra.pop("busy_status", BusyStatus.BUSY),
                    visibility=extra.pop("visibility", EventVisibility.STANDARD),
                    location=extra.pop("location", None),
                    description=extra.pop("description", DEMO_MARKER),
                )
            )
            created += 1

        await session.commit()
        print(f"Demo ready: {len(calendars_by_name)} calendars, {created} new events ({len(demo_events)} in set).")


async def _reset_demo(session, owner_user_id: str) -> None:
    """Remove demo-seeded events (marked by description) and demo accounts.

    Only touches rows this script owns: events whose description is the demo
    marker on demo calendars, then the demo accounts + their calendars.
    Real connected accounts are never matched (different emails).
    """
    from sqlalchemy import delete

    demo_emails = [email for email, _, _ in DEMO_ACCOUNTS]
    accounts = list(
        (
            await session.execute(
                select(Account).where(
                    Account.owner_user_id == owner_user_id,
                    Account.provider_account_email.in_(demo_emails),
                )
            )
        ).scalars()
    )
    for account in accounts:
        cal_ids = list(
            (await session.execute(select(Calendar.id).where(Calendar.account_id == account.id))).scalars()
        )
        if cal_ids:
            await session.execute(delete(UnifiedEvent).where(UnifiedEvent.calendar_id.in_(cal_ids)))
            await session.execute(delete(Calendar).where(Calendar.account_id == account.id))
        await session.delete(account)
    await session.flush()
    print(f"Reset: removed {len(accounts)} demo accounts and their calendars/events.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    asyncio.run(main(sys.argv[1], reset="--reset" in sys.argv[2:]))
