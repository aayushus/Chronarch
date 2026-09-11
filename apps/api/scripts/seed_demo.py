"""Seed demo accounts/calendars/events for visual QA of the calendar UI.

Usage: python scripts/seed_demo.py exec@example.com
(run seed_admin.py first to create that user)
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from sqlalchemy import select

from chronarch_core.db import SessionLocal
from chronarch_core.models.account import Account
from chronarch_core.models.calendar import Calendar
from chronarch_core.models.enums import BusyStatus, CalendarKind, ProviderType
from chronarch_core.models.event import UnifiedEvent
from chronarch_core.models.user import User

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


async def main(email: str) -> None:
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"User {email} not found — run seed_admin.py first.")
            return

        calendars_by_name: dict[str, Calendar] = {}
        for account_email, provider, cal_specs in DEMO_ACCOUNTS:
            account = Account(
                owner_user_id=user.id, provider=provider,
                provider_account_email=account_email, provider_account_id=account_email,
            )
            session.add(account)
            await session.flush()

            for name, color, writable in cal_specs:
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
        birthdays_cal = calendars_by_name["acme-corp@example.com:Birthdays"]

        demo_events = [
            (work_cal, "Weekly Alignment Call", _at(0, 8, 0), _at(0, 8, 30), False,
             [{"email": "sarah@acme.com", "name": "Sarah Lin", "response_status": "accepted"},
              {"email": "raj@acme.com", "name": "Raj Patel", "response_status": "needs_action"}]),
            (work_cal, "Sprint Demo", _at(0, 9, 0), _at(0, 10, 0), False,
             [{"email": "team@acme.com", "name": "Eng Team", "response_status": "accepted"}]),
            (work_cal, "FDE Stand-up", _at(0, 9, 15), _at(0, 9, 30), False, []),
            (work_cal, "1:1 with Manager", _at(0, 11, 0), _at(0, 12, 0), False,
             [{"email": "manager@acme.com", "name": "Alex Chen", "response_status": "organizer"}]),
            (work_cal, "Release Status Review", _at(0, 13, 0), _at(0, 14, 0), False, []),
            (personal_cal, "Dentist Appointment", _at(1, 15, 0), _at(1, 16, 0), False, []),
            (personal_cal, "Flight to Denver", _at(2, 17, 15), _at(2, 19, 55), False, []),
            (birthdays_cal, "Sonal's Birthday", _at(1, 0, 0), _at(2, 0, 0), True, []),
        ]

        for cal, title, start, end, all_day, attendees in demo_events:
            session.add(
                UnifiedEvent(
                    provider_account_id=cal.account_id, calendar_id=cal.id, provider_event_id="",
                    title=title, start=start, end=end, all_day=all_day,
                    attendees=attendees, busy_status=BusyStatus.BUSY,
                )
            )

        await session.commit()
        print(f"Seeded {len(DEMO_ACCOUNTS)} accounts, {len(calendars_by_name)} calendars, {len(demo_events)} events.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(1)
    asyncio.run(main(sys.argv[1]))
