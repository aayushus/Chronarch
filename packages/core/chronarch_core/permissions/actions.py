from enum import Enum

from ..models.enums import PermissionLevel


class CalendarAction(str, Enum):
    VIEW_AVAILABILITY = "view_availability"
    VIEW_TITLE = "view_title"
    VIEW_FULL_DETAILS = "view_full_details"
    CREATE = "create"
    EDIT = "edit"
    RESCHEDULE = "reschedule"
    DELETE = "delete"
    MANAGE_ATTENDEES = "manage_attendees"
    RESPOND_TO_INVITATION = "respond_to_invitation"
    IMPORT_ICS = "import_ics"
    MOVE_BETWEEN_CALENDARS = "move_between_calendars"


# The minimum PermissionLevel each action requires. Used to compare against
# the three-way min() of source/calendar/user authority.
ACTION_REQUIRED_LEVEL: dict[CalendarAction, PermissionLevel] = {
    CalendarAction.VIEW_AVAILABILITY: PermissionLevel.FREE_BUSY,
    CalendarAction.VIEW_TITLE: PermissionLevel.READ_TITLE,
    CalendarAction.VIEW_FULL_DETAILS: PermissionLevel.READ_FULL,
    CalendarAction.CREATE: PermissionLevel.WRITE,
    CalendarAction.EDIT: PermissionLevel.WRITE,
    CalendarAction.RESCHEDULE: PermissionLevel.WRITE,
    CalendarAction.MANAGE_ATTENDEES: PermissionLevel.WRITE,
    CalendarAction.RESPOND_TO_INVITATION: PermissionLevel.WRITE,
    CalendarAction.IMPORT_ICS: PermissionLevel.WRITE,
    CalendarAction.MOVE_BETWEEN_CALENDARS: PermissionLevel.WRITE,
    CalendarAction.DELETE: PermissionLevel.DELETE,
}
