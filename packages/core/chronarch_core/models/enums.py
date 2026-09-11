"""Enums shared across the calendar engine.

Permission levels are ordered from least to most access so that
`min(a, b)` in the permission engine picks the more restrictive of two
levels using plain comparison.
"""

from enum import IntEnum, Enum


class PermissionLevel(IntEnum):
    NONE = 0
    FREE_BUSY = 1          # only busy/free block, no details
    READ_TITLE = 2          # title visible, no description/attendees
    READ_FULL = 3           # full event details visible
    WRITE = 4                # create/edit/reschedule
    DELETE = 5                # delete/cancel (implies WRITE)


class ProviderType(str, Enum):
    GOOGLE = "google"
    MICROSOFT = "microsoft"
    CALDAV = "caldav"
    ICS = "ics"


class CalendarKind(str, Enum):
    PRIMARY = "primary"
    SHARED = "shared"
    DELEGATED = "delegated"
    SUBSCRIPTION = "subscription"
    IMPORTED = "imported"


class UserRole(str, Enum):
    EXECUTIVE = "executive"
    ASSISTANT = "assistant"
    ADMIN = "admin"


class EventVisibility(str, Enum):
    PUBLIC = "public"
    STANDARD = "standard"
    PRIVATE = "private"


class BusyStatus(str, Enum):
    BUSY = "busy"
    FREE = "free"
    TENTATIVE = "tentative"
    OUT_OF_OFFICE = "out_of_office"


class ActorType(str, Enum):
    EXECUTIVE_UI = "executive_ui"
    EA_UI = "ea_ui"
    ICS_IMPORT = "ics_import"
    COPILOT = "copilot"
    MCP = "mcp"
    API = "api"
    SYSTEM = "system"


class AuditAction(str, Enum):
    CREATE_EVENT = "create_event"
    UPDATE_EVENT = "update_event"
    MOVE_EVENT = "move_event"
    DELETE_EVENT = "delete_event"
    RESCHEDULE_EVENT = "reschedule_event"
    RESIZE_EVENT = "resize_event"
    ADD_ATTENDEE = "add_attendee"
    REMOVE_ATTENDEE = "remove_attendee"
    RESPOND_TO_EVENT = "respond_to_event"
    IMPORT_ICS = "import_ics"
    CONNECT_ACCOUNT = "connect_account"
    DISCONNECT_ACCOUNT = "disconnect_account"
    UPDATE_CALENDAR_SETTINGS = "update_calendar_settings"
    GRANT_DELEGATION = "grant_delegation"
    REVOKE_DELEGATION = "revoke_delegation"
