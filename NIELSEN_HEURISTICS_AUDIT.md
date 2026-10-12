# Nielsen Heuristics UX Audit Report

**Interface**: Chronarch Intelligent Calendar & Scheduling Web Application  
**Date**: October 11, 2026  
**Evaluator**: AI Agent (Senior UX & Cognitive Ergonomics Evaluator)  
**Platform**: Web (Desktop & Mobile Responsive - React 19 / Vite / TailwindCSS / Radix UI)  

---

## Executive Summary

### Overview
This report conducts an exhaustive heuristic evaluation of the Chronarch calendar and scheduling platform across its five core flows: Calendar Navigation & View Switching (`CalendarPage`, `WeekView`, `MonthView`, `AgendaView`), Event Creation & Editing (`QuickCreateModal`, `EventDetailPanel`, `ConflictConfirmModal`), Copilot AI Conversational Scheduling (`CopilotDrawer`), Public Booking (`BookPage`), and Account/CalDAV Settings (`SettingsPage`, `AccountsSettings`). The evaluation strictly applies Jakob Nielsen's 10 Usability Heuristics for User Interface Design.

### Key Findings
- **Total Issues Found**: 14
  - **Catastrophic (Severity 4)**: 0
  - **Major (Severity 3)**: 3
  - **Minor (Severity 2)**: 7
  - **Cosmetic (Severity 1)**: 4

### Top 3 Critical Issues
1. **Accidental Event Deletion Without Undo / Recycle Bin** - Severity 3 - Heuristic #3 (User Control & Freedom) & #5 (Error Prevention)  
   *Location*: `apps/web/src/components/EventDetailPanel.tsx` (Single event deletion executes immediately upon confirmation without a transient "Undo" toast or undo shortcut).
2. **Missing Keyboard Shortcut Cheat Sheet / Discovery Overlay** - Severity 3 - Heuristic #6 (Recognition Rather than Recall) & #7 (Flexibility & Efficiency of Use)  
   *Location*: `apps/web/src/pages/CalendarPage.tsx` (Shortcuts `t`, `j`, `k`, `w`, `m`, `d`, `c`, `?` exist in keydown handlers but have no on-screen HUD or dialog when pressing `?`).
3. **CalDAV & Sync Failure Diagnostics Masked Behind Generic Error Messages** - Severity 3 - Heuristic #9 (Help Users Recognize, Diagnose, & Recover from Errors)  
   *Location*: `apps/web/src/pages/SettingsPage.tsx` / `AccountsSettings.tsx` (Authentication errors from third-party CalDAV servers like iCloud/Fastmail do not explain app-specific password requirements or provide deep links to troubleshooting guides).

### Overall Usability Score
**8.2 / 10** - **Good to Excellent**  
The interface features Apple-grade visual polish, disciplined design token usage, subtle micro-interactions, responsive Radix primitives, and proactive error mitigation (e.g. `ConflictConfirmModal` preventing double bookings, hold timers on booking links, and streaming draft safety guards in Copilot). The primary gaps relate to discoverability of power-user features, quick undo mechanisms, and CalDAV protocol error clarity.

---

## Detailed Findings by Heuristic

### H1: Visibility of System Status
**Compliance**: ⭐⭐⭐⭐⚪ (4/5)

#### Issues Found

**Issue 1.1: Lack of Visual Sync State & Background Polling Indicator**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/pages/CalendarPage.tsx` top navigation bar
- **Description**: While active API mutations trigger toasts via `useToast`, background CalDAV sync, remote calendar polling, and offline reconnect states provide no persistent visual status (e.g., "Updated 2m ago" or an active spinner pill). Users cannot easily determine whether remote calendars have finished synchronizing.
- **Affected Tasks**: Verifying up-to-date schedule, cross-client sync verification.
- **Recommendation**:
  - Add a subtle status pill in the calendar header displaying `"All calendars synced · 2m ago"` with a manual refresh button.
  - Show an animated sync icon during active background polling cycles.

**Issue 1.2: No Optimistic Skeleton Shimmer During Month Navigation**
- **Severity**: 1 (Cosmetic)
- **Location**: `apps/web/src/components/calendar/MonthView.tsx`
- **Description**: Rapidly paging through months using `j`/`k` or chevron buttons causes grid content to momentarily blank or delay rendering until the month's date bounds query resolves, without an animated skeleton or progress rail.
- **Affected Tasks**: Long-range date browsing.
- **Recommendation**:
  - Implement a ghost skeleton grid or retain previous month's cells with a 50% opacity fade while new month events are loading.

#### Positive Examples
- ✅ Clear amber streaming draft pill indicator (`"Copilot is typing / proposed schedule ready"`) in `CopilotDrawer.tsx`.
- ✅ Real-time countdown timer ("Slot held for 14:59") on `BookPage.tsx` providing unmistakable visibility of reservation holds.
- ✅ Instant optimistic visual updates for event color category toggles.

---

### H2: Match Between System & the Real World
**Compliance**: ⭐⭐⭐⭐⚪ (4/5)

#### Issues Found

**Issue 2.1: Technical CalDAV Protocol Terminology in Account Management**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/settings/AccountsSettings.tsx`
- **Description**: Technical protocol terms like "Sync Token", "Principal URL", and "CTag" are surfaced in advanced diagnostic logs and input descriptions, which alienates non-technical users migrating from Apple Calendar or Google Calendar.
- **Affected Tasks**: Connecting custom CalDAV / Radicale / Nextcloud accounts.
- **Recommendation**:
  - Replace raw protocol labels with human terms: "Server Address" instead of "CalDAV Base URL", "Synchronization Key" instead of "CTag".
  - Tuck raw protocol metadata into a collapsible `<details>` section labelled "Technical Details".

#### Positive Examples
- ✅ Natural calendar terminology: "All day", "Repeats weekly on Tuesday", "Guests", "Location / Video Call".
- ✅ Automatic detection and logo badging for Zoom, Google Meet, and Microsoft Teams links.
- ✅ Familiar 7-column grid layout and real-world agenda list view mirroring physical planners.

---

### H3: User Control & Freedom
**Compliance**: ⭐⭐⭐⭐⚪ (4/5)

#### Issues Found

**Issue 3.1: No Global Undo for Event Deletion or Drag-and-Drop Moves**
- **Severity**: 3 (Major)
- **Location**: `apps/web/src/components/EventDetailPanel.tsx` & `apps/web/src/components/calendar/WeekView.tsx`
- **Description**: When an event is deleted or dragged to a different time slot on the grid, there is no global `Cmd+Z` / `Ctrl+Z` undo handler or "Event deleted — [Undo]" floating action toast. If a user deletes an event by mistake or accidentally misclicks a drag handle, they must manually recreate or reschedule it from scratch.
- **Affected Tasks**: Quick rescheduling, cleaning up calendar clutter.
- **Recommendation**:
  - Add an undo stack for the last 5 calendar mutations.
  - Surface a temporary 6-second snackbar toast with an explicit `[Undo]` button upon deletion or drag reschedule.

**Issue 3.2: Dismissing Quick Create Closes Without Draft Protection**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/QuickCreateModal.tsx`
- **Description**: Pressing `Escape` or clicking outside the backdrop closes `QuickCreateModal` immediately. If a user has entered a lengthy description, added multiple attendees, or selected custom recurrence rules, that work is immediately wiped without confirmation.
- **Affected Tasks**: Quick event creation.
- **Recommendation**:
  - If form fields are dirty (`title.length > 5` or attendees added), intercept `Escape` and backdrop clicks with a small confirmation dialog: "Discard changes or keep editing?".

#### Positive Examples
- ✅ Recurrence edit freedom in `EventDetailPanel.tsx`: cleanly offers "This event only", "This and following events", or "All events in the series".
- ✅ Unsaved draft guard in `CopilotDrawer.tsx` when closing with an unapplied pending proposal.
- ✅ Prominent "Discard" and "Cancel" buttons on all critical modals.

---

### H4: Consistency and Standards
**Compliance**: ⭐⭐⭐⭐⭐ (5/5)

#### Issues Found

**Issue 4.1: Mixed Modality for Slot Duration Representation**
- **Severity**: 1 (Cosmetic)
- **Location**: `apps/web/src/components/QuickCreateModal.tsx` vs `apps/web/src/pages/BookPage.tsx`
- **Description**: In `QuickCreateModal`, durations are chosen via start/end time dropdowns (`HH:mm`), whereas on `BookPage`, durations are presented as pill buttons (`15 min`, `30 min`, `45 min`). Standardizing duration presets across both would harmonize user expectations.
- **Affected Tasks**: Creating meetings of standard lengths.
- **Recommendation**:
  - Add quick duration pills (`15m`, `30m`, `1h`) directly underneath the end-time selector in `QuickCreateModal`.

#### Positive Examples
- ✅ Cohesive design system: consistent typography (`Inter` / system font stack), rounded border tokens (`rounded-xl`, `rounded-2xl`), elevation shadows, and high-contrast color badges.
- ✅ Standardized keyboard shortcuts (`t` for Today, `w` for Week, `m` for Month, `c` for Create) following de facto Google Calendar & Superhuman conventions.
- ✅ Consistent modal dialog interactions built on accessible Radix UI dialog primitives.

---

### H5: Error Prevention
**Compliance**: ⭐⭐⭐⭐⭐ (5/5)

#### Issues Found

**Issue 5.1: End Date Before Start Date Allowed Until Form Submit**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/QuickCreateModal.tsx`
- **Description**: If a user selects an end time earlier than the start time, the validation error is only highlighted after clicking "Save" or via an error banner, rather than auto-adjusting the end time or disabling invalid options in the dropdown.
- **Affected Tasks**: Quick event creation.
- **Recommendation**:
  - Dynamically constrain the end time picker to only show times after the selected start time, or automatically advance the end time to `start + 30m` when the start time is changed past the existing end time.

#### Positive Examples
- ✅ `ConflictConfirmModal.tsx`: Intercepts event saves that overlap with existing commitments, displaying conflicting event titles with options to "Save anyway", "Change time", or "Cancel".
- ✅ Public booking slot lock tokens prevent race conditions where two simultaneous bookers attempt to grab the same slot.
- ✅ Explicit confirmation gate before removing synced external calendar accounts.

---

### H6: Recognition Rather Than Recall
**Compliance**: ⭐⭐⭐⚪⚪ (3/5)

#### Issues Found

**Issue 6.1: Keyboard Shortcuts Hidden Without an In-App Cheatsheet**
- **Severity**: 3 (Major)
- **Location**: `apps/web/src/pages/CalendarPage.tsx`
- **Description**: Power-user hotkeys (`t`, `w`, `m`, `d`, `j`, `k`, `c`, `/`) are active in the global event listener, but there is no keyboard shortcut legend or cheatsheet triggerable by pressing `?` or accessible via the help menu. Users must memorize or guess the shortcuts.
- **Affected Tasks**: Power-user navigation and keyboard productivity.
- **Recommendation**:
  - Add a dedicated `<KeyboardShortcutsModal />` triggered by `?` or `Cmd+/`.
  - Include visual shortcut tooltips on navigation buttons (e.g. "Week (W)", "Today (T)").

**Issue 6.2: Attendee Autocomplete Lacks Recent Interactions List**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/QuickCreateModal.tsx`
- **Description**: When adding attendees, the input field requires the user to remember and type the exact name or email from memory before suggestions appear, rather than showing a list of frequent/recent collaborators when the field gains focus.
- **Affected Tasks**: Inviting teammates to meetings.
- **Recommendation**:
  - Display top 5 recent collaborators as click-to-add pills upon focusing the attendee input field.

#### Positive Examples
- ✅ Quick create automatically pre-fills clicked slot date and time from the visual grid coordinate.
- ✅ Search bar surfaces immediate dropdown previews with date, calendar color, and attendee avatars.
- ✅ Time zone selector in `BookPage` prominently displays both the organizer's and attendee's local time zones side by side.

---

### H7: Flexibility and Efficiency of Use
**Compliance**: ⭐⭐⭐⭐⚪ (4/5)

#### Issues Found

**Issue 7.1: Lack of Multi-Event Selection & Batch Actions**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/calendar/AgendaView.tsx` & `WeekView.tsx`
- **Description**: Users cannot `Shift+Click` or drag-select multiple events to perform bulk actions (e.g., delete multiple cancelled meetings, change calendar category, or export to ICS).
- **Affected Tasks**: Bulk calendar cleanup and reorganization.
- **Recommendation**:
  - Allow `Shift+Click` multi-selection in `AgendaView` with a floating action bar offering "Change Calendar", "Mark Private", or "Delete Selected".

**Issue 7.2: No Customizable Default View Preference Stored in UI**
- **Severity**: 1 (Cosmetic)
- **Location**: `apps/web/src/pages/CalendarPage.tsx`
- **Description**: The calendar defaults to `WeekView` on initial load. Users who prefer starting their day in `DayView` or `MonthView` must manually switch every time they open a new browser session.
- **Affected Tasks**: Daily launch workflow.
- **Recommendation**:
  - Persist the last selected view mode in `localStorage` or user preferences.

#### Positive Examples
- ✅ Dual input modes: Natural language AI scheduling in `CopilotDrawer` for expressive requests, alongside rapid click-and-drag grid creation for precision.
- ✅ Keyboard accelerator support throughout the main view.
- ✅ One-click quick presets for popular CalDAV providers (iCloud, Fastmail, Nextcloud).

---

### H8: Aesthetic and Minimalist Design
**Compliance**: ⭐⭐⭐⭐⭐ (5/5)

#### Issues Found

**Issue 8.1: Crowded Event Detail Panel on Low-Height Laptop Displays**
- **Severity**: 1 (Cosmetic)
- **Location**: `apps/web/src/components/EventDetailPanel.tsx`
- **Description**: When viewing an event with a long description, multiple attendees, conference link, and recurrence rules on a 768px height viewport, the panel requires heavy vertical scrolling, and action buttons at the bottom are pushed below the fold.
- **Affected Tasks**: Reviewing complex meeting invitations.
- **Recommendation**:
  - Pin the action buttons (Edit, Delete, Close) in a fixed sticky footer at the bottom of the slide-over panel.

#### Positive Examples
- ✅ Exceptional visual hierarchy: clean sans-serif typography, generous breathing room, and intentional use of whitespace.
- ✅ Subdued background surfaces (`var(--bg-raised)`, `var(--bg-subtle)`) that ensure calendar event colors remain the dominant focal point.
- ✅ Zero unnecessary decorative clutter; every on-screen element serves an immediate operational purpose.

---

### H9: Help Users Recognize, Diagnose, and Recover from Errors
**Compliance**: ⭐⭐⭐⭐⚪ (4/5)

#### Issues Found

**Issue 9.1: CalDAV Authentication Failures Lack Actionable Remediation Links**
- **Severity**: 3 (Major)
- **Location**: `apps/web/src/components/settings/AccountsSettings.tsx`
- **Description**: When connecting an iCloud or Fastmail account with regular credentials rather than an app-specific password, the backend returns `401 Unauthorized`. The UI reports `"Authentication failed: Invalid credentials"`, leaving users puzzled as to why their primary password failed.
- **Affected Tasks**: Connecting external calendar accounts.
- **Recommendation**:
  - Detect Apple/Fastmail domains and provide contextual troubleshooting: *"For Apple iCloud, you must generate an App-Specific Password at appleid.apple.com."* with an external link button.

**Issue 9.2: Conflict Detection Does Not Show Alternative Free Slots Directly**
- **Severity**: 2 (Minor)
- **Location**: `apps/web/src/components/ConflictConfirmModal.tsx`
- **Description**: When a conflict is detected, `ConflictConfirmModal` alerts the user to the clash and offers "Save anyway" or "Back", but does not suggest the next available free 30-minute opening.
- **Affected Tasks**: Resolving schedule collisions.
- **Recommendation**:
  - Add a "Next available slot" button (e.g., "Move to 3:30 PM (No conflicts)") powered by the local schedule solver.

#### Positive Examples
- ✅ Plain-English client error translation via `friendlyError` mapping raw HTTP status codes to user-friendly explanations.
- ✅ In-line red validation boundaries on email input fields with exact format requirements (`"Please enter a valid email address"`).

---

### H10: Help and Documentation
**Compliance**: ⭐⭐⭐⚪⚪ (3/5)

#### Issues Found

**Issue 10.1: Lack of Dedicated In-App Help Center or Quick Tour**
- **Severity**: 2 (Minor)
- **Location**: Main navigation / Settings
- **Description**: There is no persistent "Help" icon or FAQ modal in the app shell. First-time users are dropped directly onto the calendar canvas without an introductory tooltip tour of key capabilities (Copilot scheduling, CalDAV sync, public booking links).
- **Affected Tasks**: First-time user onboarding.
- **Recommendation**:
  - Introduce a persistent `?` help menu in the top-right user menu with links to "Keyboard Shortcuts", "CalDAV Setup Guide", and "Copilot Prompts Cheat Sheet".

**Issue 10.2: Copilot Input Lacks Example Prompt Suggestions**
- **Severity**: 1 (Cosmetic)
- **Location**: `apps/web/src/components/CopilotDrawer.tsx`
- **Description**: The Copilot drawer opens with a blank chat area. While placeholder text says "Ask me to schedule...", it does not present clickable example pills (e.g., *"Schedule 30m with Sarah tomorrow afternoon"*, *"Find 2 hours of focus time this week"*).
- **Affected Tasks**: Discovering Copilot's scheduling capabilities.
- **Recommendation**:
  - Display 3 clickable sample query chips above the input textarea when the conversation history is empty.

#### Positive Examples
- ✅ Contextual provider setup badges for iCloud, Google, and Nextcloud explaining required server port and SSL options.
- ✅ Clear tooltip explanations on subtle icon buttons (View switches, AI drawer toggle, mini calendar collapse).

---

## Prioritized Action Items

### Must Fix (Severity 3)
1. **Add Transient Undo (`Cmd+Z` / Toast) for Event Deletion & Rescheduling** - H3 (User Control & Freedom)
   - **Impact**: Protects users from permanent accidental data loss and provides peace of mind.
   - **Fix**: Maintain a client-side undo stack; trigger a 6s snackbar with an `[Undo]` button upon deletion or drag mutation.
   - **Effort**: Medium (1-2 days)
2. **Implement Keyboard Shortcuts Legend (`?` Key Overlay)** - H6 (Recognition Rather than Recall)
   - **Impact**: Transforms hidden keyboard power-user features into discoverable everyday productivity gains.
   - **Fix**: Create `<KeyboardShortcutsModal />` bound to the `?` hotkey and add a header trigger button.
   - **Effort**: Low (0.5 day)
3. **Contextual CalDAV App-Specific Password Error Guidance** - H9 (Error Recovery)
   - **Impact**: Eliminates onboarding drop-off and frustration when connecting iCloud/Fastmail accounts.
   - **Fix**: Parse provider domain during 401 errors and render explicit step-by-step guidance to generate an app password.
   - **Effort**: Low (0.5 day)

### Should Fix (Severity 2)
1. **Dynamic End-Time Auto-Adjustment in Event Form** - H5 (Error Prevention)
   - Auto-advance end time to `start + 30m` whenever the start time exceeds current end time.
2. **Dirty Form Guard on Quick Create Escape** - H3 (User Control & Freedom)
   - Prompt confirmation before discarding modal if title or attendees have been entered.
3. **Recent Collaborator Suggestions in Attendee Picker** - H6 (Recognition Rather than Recall)
   - Show recent attendees as click-to-add chips on input focus.
4. **Sync Status Indicator Pill in App Header** - H1 (Visibility of System Status)
   - Surface "Synced 2m ago" with manual reload button.
5. **Alternative Free Slot Proposal in Conflict Modal** - H9 (Error Recovery)
   - Suggest nearest clash-free 30-minute slot directly in the conflict dialog.

### Nice to Have (Severity 1)
1. **Sticky Action Footer in Event Detail Slide-Over** - H8 (Aesthetic & Minimalist Design)
2. **Copilot Starter Prompt Chips** - H10 (Help & Documentation)
3. **Persist User's Preferred Calendar View in Local Storage** - H7 (Flexibility & Efficiency)
4. **Quick Duration Preset Buttons in Event Form** - H4 (Consistency & Standards)

---

## Quick Wins
- **Keyboard Shortcut Overlay Modal**: Build a clean Radix Dialog showing shortcuts for navigation (`T`, `W`, `M`, `D`, `J`, `K`), event actions (`C`, `E`, `Delete`), and AI (`Cmd+K`).
- **Starter Prompt Chips for Copilot**: Add 3 quick buttons above the Copilot input for empty states.
- **End-Time Auto-Calculation**: Update the `onChange` handler of the start time field in `QuickCreateModal` to automatically set `endTime = addMinutes(startTime, 30)` if `endTime <= startTime`.

---

## Recommendations Summary

| Timeline | Action Item | Target File(s) | Primary Heuristic |
|---|---|---|---|
| **Immediate (1-2 weeks)** | Keyboard Shortcut Cheat Sheet Modal (`?`) | `CalendarPage.tsx`, `KeyboardShortcutsModal.tsx` | H6 / H7 |
| **Immediate (1-2 weeks)** | Event Deletion Undo Toast | `EventDetailPanel.tsx`, `useToast.ts` | H3 / H5 |
| **Immediate (1-2 weeks)** | CalDAV App-Specific Password Guidance | `AccountsSettings.tsx`, `friendlyError.ts` | H9 |
| **Short-term (1-2 months)** | Smart Conflict Slot Suggestions | `ConflictConfirmModal.tsx` | H9 |
| **Short-term (1-2 months)** | Sync Status & Background Activity Pill | `CalendarPage.tsx` | H1 |
| **Short-term (1-2 months)** | Dirty Form Confirmation on Quick Create | `QuickCreateModal.tsx` | H3 |
| **Long-term (3+ months)** | Multi-Event Shift Selection & Batch Actions | `WeekView.tsx`, `AgendaView.tsx` | H7 |
| **Long-term (3+ months)** | Interactive In-App Onboarding Tour | `OnboardingModal.tsx` | H10 |

---

## Methodology Notes
- **Evaluation Framework**: Jakob Nielsen's 10 Usability Heuristics (1994).
- **Severity Rating Scale**: 0 (Not a problem) to 4 (Usability catastrophe).
- **Scope**: Chronarch Web Frontend client (`apps/web/src`).
- **Complementary Audits**: Cross-referenced with `COGNITIVE_WALKTHROUGH.md`, `DESIGN_AUDIT.md`, and WCAG Accessibility audits.
