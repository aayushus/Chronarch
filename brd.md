Business Requirements Document

Unified Calendar, Executive Assistant & AI Scheduling Platform

Version: 1.1
Date: September 11, 2026
Status: Draft
Working Name: Chronarch

⸻

1. Executive Summary

UnifiedCal is a self-hosted, privacy-first calendar aggregation and management platform for professionals who maintain calendars across multiple organizations and providers.

The platform provides a single Apple Calendar–style interface across:

* Google Calendar
* Google Workspace
* Microsoft 365
* Outlook
* CalDAV
* shared calendars
* subscribed calendars
* imported .ics files

The platform preserves the underlying source calendars and their native permissions wherever possible.

A primary use case is an executive with multiple personal and corporate calendars who needs an Executive Assistant to see the executive’s complete availability and manage permitted events without receiving credentials or access to administrative configuration.

UnifiedCal also exposes calendar capabilities through MCP so external AI tools such as ChatGPT and Claude can query and manage calendars.

Additionally, UnifiedCal may include an optional built-in AI copilot directly in the UI. The copilot shall use LiteLLM as the model abstraction layer, allowing deployments to route requests to OpenRouter and other model providers. Free OpenRouter models should be preferred where practical.

The product objective is to combine:

Apple Calendar–quality usability + multi-provider aggregation + EA delegation + self-hosting + MCP + optional AI copilot.

⸻

2. Problem Statement

Professionals increasingly maintain calendars across multiple systems:

* Corporate Microsoft 365
* Secondary Microsoft 365 tenants
* Google Workspace
* Personal Gmail
* Shared calendars
* CalDAV calendars
* ICS feeds
* one-off .ics meeting/event files

Corporate security policies frequently prohibit direct authorization of third-party calendar applications.

Users therefore often expose corporate calendars indirectly through supported sharing arrangements.

Existing products typically solve only part of the problem.

Fragmented visibility

Users cannot easily see their complete schedule across organizations.

Executive Assistant access

An EA needs operational access to the executive’s calendar but should not have access to:

* OAuth credentials
* provider configuration
* AI provider configuration
* MCP configuration
* system settings
* server administration
* API tokens

Permission complexity

Some calendars are writable.

Others may expose:

* full details but read-only access
* Free/Busy only
* subscribed events
* imported events

The system must accurately represent these differences.

Weak calendar UX

Many calendar aggregation products provide functionality but lack the fluid interactions users expect from Apple Calendar, such as:

* drag-and-drop rescheduling
* direct event resizing
* intuitive Day/Week/Month navigation
* fast event creation
* calendar color identification
* contextual menus
* keyboard shortcuts

AI access

AI assistants need a standardized and secure method to access the user’s scheduling environment.

For the initial product, the primary AI clients are expected to be external tools such as:

* ChatGPT
* Claude
* other MCP-compatible agents

A built-in copilot may also provide AI interaction directly inside UnifiedCal.

⸻

3. Product Vision

Create:

One calendar control plane for the executive, the assistant, and AI agents.

The platform should feel as simple and direct as Apple Calendar to end users while providing significantly more sophisticated aggregation, permissions, delegation, and AI functionality behind the scenes.

UnifiedCal should separate:

Calendar Source

Where an event actually exists.

Example:

Microsoft 365
    ↓
Executive Calendar

Calendar View

How events from multiple calendars are displayed together.

Calendar Authority

What UnifiedCal is allowed to do with the source calendar.

User Authority

What the currently logged-in user is allowed to do.

These permissions are separate.

For example:

Source permits WRITE
Executive permits EA READ ONLY
Result:
EA = READ ONLY

⸻

4. Target Users

4.1 Executive / Administrator

The executive is the primary owner of the UnifiedCal workspace.

The executive may have calendars across:

1. Corporate Microsoft 365
2. Personal Google
3. Secondary company Microsoft/Google
4. CalDAV
5. Shared calendars
6. ICS subscriptions

The executive has access to administrative configuration.

This includes:

* calendar connections
* provider OAuth
* user management
* EA delegation
* AI provider settings
* LiteLLM configuration
* MCP configuration
* calendar permission policies
* workspace settings
* audit logs

⸻

4.2 Executive Assistant

The EA is an operational calendar user.

The EA shall use the same high-quality calendar interface as the executive.

The EA may:

* view permitted calendars
* view availability
* create events
* edit permitted events
* reschedule events
* delete/cancel permitted events
* manage attendees
* import .ics events where permitted
* use drag-and-drop calendar interactions

The EA shall NOT see administrative configuration unless explicitly granted a separate administrator role.

By default, the EA shall not see:

* connected account credentials
* OAuth integrations
* provider tokens
* system configuration
* LiteLLM configuration
* OpenRouter keys
* MCP tokens
* deployment settings
* server configuration
* user administration
* provider synchronization status pages intended for administrators

The EA experience should feel like a calendar application rather than an administrative dashboard.

⸻

4.3 External AI Client

For the initial product, AI usage should primarily occur through external tools.

Examples:

* ChatGPT
* Claude
* Cursor
* Claude Code
* other MCP-compatible clients

These tools connect to UnifiedCal through MCP.

Example requests:

“What’s on my schedule tomorrow?”

“Find me 45 minutes with no conflicts next week.”

“Schedule Sarah for Thursday afternoon.”

“Move my 2 PM to Friday morning.”

UnifiedCal shall enforce the same permissions for AI operations as for human users.

⸻

4.4 Built-In AI Copilot

UnifiedCal may provide an optional conversational AI assistant directly inside the calendar interface.

Example UI:

┌─────────────────────────────────────┐
│ Ask UnifiedCal                     │
│                                     │
│ "Find me 30 minutes tomorrow       │
│  afternoon."                       │
│                                     │
│ Suggested:                         │
│ 3:00 PM – 3:30 PM                  │
│                                     │
│ [Create Event]                     │
└─────────────────────────────────────┘

The built-in copilot shall use:

LiteLLM

as the model abstraction layer.

This prevents the product from being tightly coupled to one model provider.

Supported providers may include:

* OpenRouter
* OpenAI
* Anthropic
* Gemini
* local OpenAI-compatible endpoints
* Ollama
* other LiteLLM-compatible providers

The preferred default configuration should prioritize:

OpenRouter free-tier/free models where suitable.

Administrators must be able to configure:

* preferred model
* fallback model
* provider
* API credentials
* model routing
* model timeout
* usage limits

The AI copilot should use UnifiedCal’s internal APIs/tools rather than directly connecting to provider calendars.

⸻

5. Product Principles

5.1 Apple Calendar–Quality UX

The calendar should prioritize direct manipulation.

Core interactions should feel familiar to users of:

* Apple Calendar
* Google Calendar
* Outlook Calendar

The UI should not feel like an enterprise admin system.

⸻

5.2 Source of Truth Preservation

UnifiedCal should avoid unnecessary event duplication.

Whenever possible:

Provider Calendar
       ↓
UnifiedCal cached representation
       ↓
Unified Calendar View

rather than creating cloned events.

⸻

5.3 Permissions Follow the Source

UnifiedCal must never imply that an event can be modified if the source calendar does not permit modification.

⸻

5.4 One Availability Model

All calendars configured to block availability must contribute to the executive’s scheduling state.

⸻

5.5 Delegation First

EA workflows shall be a first-class capability.

⸻

5.6 AI Is a Client

The AI system does not receive special access.

Whether an action originates from:

* executive UI
* EA UI
* built-in copilot
* ChatGPT MCP
* Claude MCP

it must pass through the same permission and calendar-authority engine.

⸻

6. High-Level Architecture

                 CALENDAR PROVIDERS
 Google          Microsoft        CalDAV        ICS
   │                 │               │            │
   └──────────┬──────┴───────┬───────┴────────────┘
              │              │
              ▼              ▼
                CONNECTOR LAYER
          Google Calendar API
          Microsoft Graph
          CalDAV Adapter
          ICS Parser / Importer
                    │
                    ▼
               CALENDAR ENGINE
        ┌───────────────────────────┐
        │ Calendar Registry         │
        │ Event Normalization       │
        │ Availability Engine       │
        │ Permission Engine         │
        │ Recurrence Engine         │
        │ Conflict Detection        │
        │ Import Engine             │
        │ Sync Engine               │
        │ Audit Engine              │
        └───────────────────────────┘
                    │
        ┌───────────┼────────────┐
        │           │            │
        ▼           ▼            ▼
   Calendar UI    MCP Server   Internal AI API
        │           │            │
        │           │            ▼
 Executive / EA  ChatGPT      LiteLLM
                 Claude          │
                             OpenRouter /
                            other providers

⸻

7. Calendar Connection Requirements

BR-CAL-001 — Google Calendar

Support OAuth-based connection to:

* Gmail
* Google Workspace

Multiple Google accounts shall be supported.

⸻

BR-CAL-002 — Microsoft Calendar

Support:

* Microsoft 365
* Outlook.com

using Microsoft Graph.

Multiple Microsoft accounts and tenants shall be supported.

⸻

BR-CAL-003 — CalDAV

Support standard CalDAV accounts.

⸻

BR-CAL-004 — ICS Subscription

Users may subscribe to a calendar using an ICS URL.

These calendars will ordinarily be treated as read-only.

⸻

BR-CAL-005 — Shared Calendars

Calendars shared into connected accounts shall be discoverable.

UnifiedCal must retain the distinction between:

* primary calendars
* shared calendars
* delegated calendars
* subscribed calendars

⸻

8. ICS File Import

BR-ICS-001 — Upload .ics

Users shall be able to upload a local .ics file.

Supported methods:

* file picker
* drag-and-drop onto the calendar
* drag-and-drop into an import area

⸻

BR-ICS-002 — Import Preview

Before importing, UnifiedCal shall parse the file and display:

* event title
* date/time
* timezone
* location
* attendees
* recurrence
* organizer
* description

⸻

BR-ICS-003 — Destination Calendar Selection

The user shall select which writable calendar receives the imported event.

Example:

Import Event
Board Meeting
Tuesday, September 15
10:00 AM – 11:00 AM
Add to:
○ Personal
● Company #2
○ Family
[Cancel] [Import]

Read-only calendars must not appear as valid import destinations.

⸻

BR-ICS-004 — Multiple Events

If an ICS file contains multiple events, users shall be able to:

* import all
* select individual events
* choose a single destination calendar
* optionally choose different destination calendars per event

⸻

BR-ICS-005 — Drag .ics Directly Onto Calendar

A user may drag an .ics file from their computer directly onto the calendar UI.

UnifiedCal should:

1. parse the file
2. show a preview
3. determine candidate destination date/time
4. ask which calendar to use
5. create the event after confirmation

⸻

9. Unified Calendar UX

The calendar interface should borrow heavily from the usability patterns of Apple Calendar.

⸻

9.1 Calendar Views

The application shall provide:

Day View

Detailed timeline for one day.

Week View

Primary scheduling view showing the week as vertical day columns.

Month View

Traditional month grid.

Agenda / List View

Chronological event list.

At minimum, MVP must ship:

* Day
* Week
* Month

⸻

9.2 View Navigation

Users shall be able to:

* move forward/backward
* jump to Today
* select a date
* switch views without losing context

Example:

<    Today    >        Day | Week | Month

⸻

9.3 Drag-and-Drop Rescheduling

Users shall be able to drag an event to a new time.

Example:

Monday 10:00
     │
     │ drag
     ▼
Tuesday 2:00

Before committing the move, UnifiedCal must check:

* source permissions
* user permissions
* conflicts
* recurrence rules

If allowed, the authoritative source event shall be updated.

⸻

9.4 Drag Across Days

Events may be dragged:

* within the same day
* between days
* between weeks where supported by the current view

⸻

9.5 Event Resize

Users shall be able to adjust an event duration by dragging the top or bottom edge.

Example:

Before:
2:00–3:00
drag bottom edge
After:
2:00–3:30

⸻

9.6 Create Event by Clicking

Clicking an empty calendar time should create an event.

Example:

Click:
Wednesday 11:00 AM
→ Quick Event popup

⸻

9.7 Create Event by Dragging

Users shall be able to drag across an empty time range.

Example:

Drag from:

1:00 PM
   ↓
2:30 PM

UnifiedCal initializes:

New Event
1:00 PM – 2:30 PM

⸻

9.8 Quick Event Creation

The initial event editor should be lightweight.

Fields:

* title
* calendar
* start
* end
* location
* attendees

Advanced fields should be available through:

More Options

⸻

9.9 All-Day Events

All-day events shall display in a dedicated section at the top of Day and Week views.

Users shall be able to drag events between:

* timed section
* all-day section

where provider functionality permits.

⸻

9.10 Multi-Day Events

Multi-day events shall display continuously across applicable date ranges.

⸻

9.11 Calendar Colors

Each calendar shall have an assigned display color.

Events shall visually identify their source calendar using that color.

Users may configure calendar colors locally without changing the source provider where appropriate.

⸻

9.12 Calendar Sidebar

Example:

My Calendars
☑ Personal
☑ Corporate
☑ Company #2
☐ Birthdays
Other Calendars
☑ Holidays
☐ Team Calendar

Clicking a calendar toggles visibility.

⸻

9.13 Context Menus

Right-click or equivalent context menus should provide actions such as:

* Edit
* Duplicate
* Move to Calendar
* Delete
* Copy event link
* Mark private

Actions shall be dynamically limited by permissions.

⸻

9.14 Keyboard Shortcuts

The application should support common calendar keyboard shortcuts.

Examples:

T       Today
D       Day
W       Week
M       Month
N       New event
Delete  Delete selected event
Esc     Close dialog

⸻

9.15 Responsive UI

Desktop is the primary MVP target.

The UI must remain usable on:

* laptops
* tablets
* mobile browsers

A future PWA or native client may be considered.

⸻

10. Event Management

BR-EVT-001 — Create Event

Users with appropriate permissions may create events.

The destination calendar must be explicitly identifiable.

⸻

BR-EVT-002 — Edit Event

Events shall be edited against their authoritative source where possible.

⸻

BR-EVT-003 — Delete Event

Users may delete or cancel writable events.

⸻

BR-EVT-004 — Move Event Between Calendars

Where technically possible, a user may move an event from one writable calendar to another.

Because providers may not support native cross-calendar move semantics, UnifiedCal may internally perform:

1. create on destination
2. validate
3. delete from source

This action must be clearly represented in the audit log.

Organizer behavior must be handled carefully.

⸻

BR-EVT-005 — Attendees

Support:

* attendee addition
* attendee removal
* RSVP state
* organizer visibility

⸻

BR-EVT-006 — Recurrence

Support:

* daily
* weekly
* monthly
* yearly
* custom recurrence

Editing recurring events must offer:

This event
This and future events
Entire series

where supported.

⸻

11. Availability Engine

All calendars configured with:

Blocks Availability = TRUE

must influence availability calculations.

Availability should not depend on whether the event can be edited.

A read-only corporate meeting still blocks the executive’s availability.

⸻

12. Calendar Configuration

Each calendar shall expose administrative settings.

Setting	Description
Visible	Show in calendar UI
Blocks Availability	Include in Free/Busy
Default Calendar	Default for event creation
Writable	Derived from provider
EA Can View	Delegated permission
EA Can Edit	Delegated permission
AI Can Read	AI permission
AI Can Write	AI permission
Privacy Mask	Hide sensitive details

These settings are available only to authorized administrators.

⸻

13. Executive Assistant Experience

The EA should land directly in:

Calendar View

not an admin dashboard.

Example:

┌─────────────────────────────────────────────┐
│ UnifiedCal                           Sarah  │
├────────────┬────────────────────────────────┤
│ Calendars  │                                │
│            │       WEEK VIEW                │
│ ☑ Personal │                                │
│ ☑ Work     │                                │
│ ☑ Company2 │                                │
│            │                                │
└────────────┴────────────────────────────────┘

The EA should not need to understand:

* which OAuth connection exists
* which Graph tenant is connected
* which API created the event
* MCP
* LiteLLM
* OpenRouter
* provider refresh tokens

Technical source information may be surfaced only where operationally useful.

Example:

Corporate — Read Only

rather than exposing provider internals.

⸻

14. Delegation Permissions

Permissions should include:

View availability
View event titles
View full details
Create events
Edit events
Reschedule events
Delete events
Manage attendees
Respond to invitations
Import ICS
Move events between calendars

Administrative permissions are separate.

⸻

15. Privacy Controls

Events may be marked:

* Public
* Standard
* Private

A private event might appear to the EA as:

Private Event
2:00 PM – 3:00 PM
Busy

instead of exposing the title and description.

⸻

16. External MCP Integration

UnifiedCal shall expose a first-party MCP server.

Primary initial consumers:

* ChatGPT
* Claude
* other external MCP clients

The MCP server should be considered an interface into UnifiedCal rather than an independent calendar synchronization system.

⸻

17. MCP Read Tools

Initial MCP tools:

list_accounts
list_calendars
get_events
get_event
get_schedule
get_availability
find_free_slots
find_conflicts

⸻

18. MCP Write Tools

Authorized MCP clients should support:

create_event
update_event
move_event
delete_event
add_attendee
remove_attendee
respond_to_event

⸻

19. MCP Authentication

The MCP server should support remote HTTPS transport.

Authentication shall use scoped UnifiedCal credentials.

Example scopes:

calendar.read
calendar.write
calendar.delete
availability.read

Provider OAuth credentials shall never be exposed to MCP clients.

⸻

20. Built-In Copilot

UnifiedCal may provide a collapsible AI copilot.

Suggested location:

Calendar
-------------------------------------------------
|                                               |
|                                               |
|                                               |
-------------------------------------------------
                             [Ask AI ✨]

Opening it provides a conversational panel.

⸻

20.1 Copilot Capabilities

Example prompts:

“What does my afternoon look like?”

“Find 30 minutes tomorrow.”

“Move my 3 PM later.”

“When do I have two uninterrupted hours this week?”

“Create a meeting with John Friday morning.”

The copilot should call UnifiedCal’s internal tool layer.

⸻

20.2 LiteLLM

All built-in AI requests shall flow through LiteLLM.

Architecture:

UnifiedCal Copilot
        │
        ▼
     LiteLLM
        │
   ┌────┼─────────┐
   ▼    ▼         ▼
OpenRouter OpenAI Anthropic

This allows provider flexibility and future model changes without changing product logic.

⸻

20.3 OpenRouter Preference

Default recommended configuration should prioritize OpenRouter models with no or low inference cost.

Where available and suitable:

free OpenRouter models should be preferred.

Administrators may override the routing configuration.

The system should support:

Primary model
Fallback model
Emergency fallback model

⸻

20.4 AI Cost Controls

Administrators should be able to define:

* AI enabled/disabled
* allowed users
* provider
* model
* daily request limits
* per-user limits
* maximum tokens
* timeout
* fallback behavior

⸻

21. AI Safety and Confirmation

AI should distinguish operations by impact.

READ
WRITE
DESTRUCTIVE

Example:

What's tomorrow?          READ
Create a meeting          WRITE
Cancel leadership call    DESTRUCTIVE

Administrators may configure confirmation requirements.

Recommended default:

* reads: no confirmation
* creates: preview before commit
* edits: preview for material changes
* deletes: explicit confirmation

⸻

22. Audit Log

All modifications shall be logged.

Sources should include:

Executive UI
EA UI
ICS Import
Built-in Copilot
ChatGPT MCP
Claude MCP
API

Example:

Actor:
Executive Assistant
Action:
Moved Event
From:
Tuesday 2:00 PM
To:
Tuesday 3:00 PM
Calendar:
Company #2

⸻

23. Sync Architecture

Provider APIs should remain authoritative.

UnifiedCal stores a normalized cached representation.

Core event model:

UnifiedEvent
id
provider
provider_account_id
provider_calendar_id
provider_event_id
title
description
start
end
timezone
all_day
organizer
attendees
location
conference
recurrence
visibility
busy_status
source_permissions
effective_permissions
created_at
updated_at
provider_updated_at
last_synced_at

⸻

24. Synchronization

Use provider push mechanisms where available.

Also run periodic reconciliation to recover from missed webhooks.

Target normal sync latency:

<60 seconds

where provider APIs permit.

⸻

25. Conflict Detection

Dragging, editing, importing, or AI-created events should all use the same conflict engine.

Example:

Drag event → Thursday 2 PM
             │
             ▼
Availability Engine
             │
      conflict found
             ▼
Corporate meeting
2:30 PM – 3:00 PM

The user may be warned before completing the action.

⸻

26. Working Hours

Users may configure:

* working days
* working hours
* timezone
* minimum meeting notice
* meeting buffers

These settings should influence:

* UI suggestions
* find-free-time
* MCP
* built-in copilot

⸻

27. Timezones

UnifiedCal shall retain original event timezone information.

Users may configure:

* home timezone
* secondary timezone

Week/Day views may optionally display two timezone scales similar to advanced calendar clients.

⸻

28. Self-Hosting

The application shall support Docker-first deployment.

Target:

docker compose up -d

Recommended services:

Reverse Proxy
      │
      ▼
Frontend / API
      │
      ├── MCP Service
      ├── Worker
      ├── Scheduler
      ├── LiteLLM
      │
      ▼
PostgreSQL
      │
    Redis

Redis may support:

* jobs
* caching
* distributed locks
* webhook processing

⸻

29. Security

OAuth tokens shall be encrypted at rest.

Provider credentials shall never be accessible to EA users.

Secrets shall never be exposed through:

* UI logs
* MCP responses
* copilot prompts
* audit logs

Production deployments should support external secret managers.

⸻

30. Administrative UI

The administrator receives a separate settings area.

Example navigation:

Settings
Calendars
Accounts
Delegates
Users
AI / LiteLLM
MCP
Security
Audit Log
System

The EA should not see this navigation unless explicitly assigned an administrative role.

⸻

31. MVP Scope

MVP should include:

Calendar Providers

* Google
* Microsoft 365

Calendar Types

* primary
* shared
* delegated
* ICS subscription
* .ics file import

Calendar UI

* Day
* Week
* Month
* calendar sidebar
* source colors
* click-to-create
* drag-to-create
* drag-and-drop rescheduling
* event resizing
* all-day events
* event editor
* conflict warnings

Event Operations

* create
* edit
* move
* resize
* delete
* attendees
* recurrence

Delegation

* Executive role
* EA role
* calendar-specific permissions
* privacy masking

MCP

* external ChatGPT/Claude-compatible MCP endpoint

AI

* LiteLLM integration
* optional built-in copilot
* OpenRouter support
* preference for free models where suitable

Deployment

* Docker Compose
* PostgreSQL
* Redis
* encrypted provider credentials

⸻

32. Phase 2

Add:

* CalDAV
* more advanced ICS handling
* natural-language Quick Add
* advanced recurrence
* secondary timezone UI
* multiple executives per EA
* multiple EAs per executive
* notification preferences
* Meet/Teams/Zoom creation
* contact integration
* keyboard shortcut expansion
* PWA

⸻

33. Phase 3

Introduce more advanced scheduling intelligence.

Example:

“Schedule 30 minutes with Sarah next week.”

UnifiedCal:

1. resolves Sarah
2. determines required calendars
3. calculates availability
4. applies working hours
5. considers buffers
6. proposes candidate times
7. creates the event after authorization

⸻

34. Non-Goals for MVP

The MVP should not attempt to become:

* an email client
* a task manager
* a CRM
* a Slack replacement
* an Outlook replacement
* a video conferencing platform

The focus remains:

Unified Calendar + Delegation + MCP + AI scheduling.

⸻

35. UX Benchmark

The calendar experience should use Apple Calendar as a major usability benchmark.

Key behaviors to emulate conceptually include:

* clean Day/Week/Month views
* fluid calendar navigation
* event color coding
* direct drag-and-drop
* resize to change duration
* quick event creation
* all-day event handling
* calendar visibility toggles
* minimal visual clutter
* simple event popovers
* fast interaction without full-page reloads

The goal is not to visually clone Apple Calendar.

The goal is to achieve comparable interaction quality.

⸻

36. Success Metrics

Reliability

≥99.9% of supported provider events represented correctly.

Synchronization

95% of webhook-supported changes reflected within 60 seconds.

Availability

100% of calendars configured to block availability included.

EA workflow

EA can manage permitted calendars without receiving provider credentials or administrative system access.

UX

Core operations require no more interaction than comparable operations in Apple Calendar.

ICS

A user can drag an .ics file into UnifiedCal, select a writable destination calendar, and successfully create the event.

MCP

ChatGPT or Claude can:

1. retrieve schedule
2. determine availability
3. create a meeting
4. reschedule a meeting
5. cancel a meeting

subject to permissions.

Copilot

The built-in copilot can perform the same basic scheduling actions through UnifiedCal’s internal tool layer using a LiteLLM-backed model.

⸻

37. Primary Product Differentiator

UnifiedCal should not position itself merely as an open-source calendar client.

Its positioning should be:

The calendar control plane for executives, assistants, and AI agents.

The key combination is:

Apple Calendar–quality UI

Google/Microsoft aggregation

Executive Assistant delegation

ICS import and direct manipulation

self-hosting

MCP

LiteLLM-powered AI

The human UI, EA interface, MCP server, and built-in copilot all operate through the same:

* event model
* permission model
* availability engine
* provider connectors
* audit system

This shared architecture is the core of the product.

⸻

38. Primary Acceptance Scenario

An executive has:

Calendar A
Corporate Microsoft 365
Restricted third-party access
Calendar B
Personal Gmail
Includes shared visibility of Calendar A
Calendar C
Second work account
Full integration allowed

UnifiedCal connects to B and C.

It discovers the calendars available through those accounts.

The executive’s Week view shows:

☑ Personal
☑ Corporate
☑ Second Work

Events from all three calendars appear together.

The executive can:

* switch Day/Week/Month
* drag writable meetings
* resize events
* click to create meetings
* drag across time to create meetings
* import .ics files
* choose which destination calendar receives an imported event

The EA logs in.

The EA sees the calendar experience immediately.

She does not see:

* OAuth
* provider integrations
* MCP configuration
* LiteLLM
* OpenRouter
* API credentials
* system settings

She can perform only the scheduling actions delegated to her.

A corporate event that is read-only may still block availability but cannot be moved.

A writable Company #2 event can be dragged from:

Tuesday 2 PM

to:

Wednesday 4 PM

and UnifiedCal updates the original provider event.

An external ChatGPT or Claude client connects through MCP and asks:

“Find me 45 minutes tomorrow afternoon without conflicting with any calendar.”

UnifiedCal considers all blocking calendars.

Separately, the executive may open the built-in copilot and ask the same question.

The copilot uses:

UnifiedCal
   ↓
Internal AI Tools
   ↓
LiteLLM
   ↓
OpenRouter / configured provider

and provides the same availability result.

This scenario constitutes the core MVP.

Keep MCP and the built-in copilot as two separate clients of the same internal tool/API layer. That way ChatGPT, Claude, and your LiteLLM/OpenRouter copilot all invoke exactly the same scheduling logic and permissions.