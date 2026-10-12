# Don Norman Principles Usability Audit: Chronarch Calendar & Workspace

**Evaluation Target**: Chronarch Web Application (`apps/web`)  
**Methodology**: Don Norman's 7 Fundamental Design Principles (*The Design of Everyday Things*)  
**Evaluator**: Principal UX / Human-Computer Interaction Specialist  
**Status**: Completed  
**Overall Usability Score**: **8.2 / 10**

---

## Executive Summary

Chronarch demonstrates strong foundational adherence to modern calendar mental models and desktop interaction standards (fluid view toggles, natural vertical/horizontal time mapping, command palette, and reactive sidebar rails). However, several key micro-interactions fall victim to common Norman usability traps:
1. **Hidden Signifiers**: Drag-to-create and event resizing capabilities rely on user discovery or chance hovering rather than visible signifiers.
2. **Weak Feedback Loops**: Core mutating operations (event creation, rescheduling via drag-and-drop, and background sync completion) lack immediate transient feedback (toasts or audible/haptic cues) confirming the resulting state.
3. **Mismatched Conceptual Models**: Coexistence of a local event filter (`/`) alongside a global Command Palette (`⌘K`) in the top navigation creates ambiguity regarding scope and search intention.
4. **Soft Constraints**: Time selection dropdowns allow picking invalid end times (prior to start times) rather than enforcing physical/logical constraints at the selection point.

---

## Principle-by-Principle Evaluation

```
┌─────────────────────────────────────────────────────────────┐
│ NORMAN PRINCIPLES SCORECARD                                 │
├──────────────────────────────┬─────────────┬────────────────┤
│ Principle                    │ Compliance  │ Score (1-10)   │
├──────────────────────────────┼─────────────┼────────────────┤
│ 1. Discoverability           │ Moderate    │ 7.8 / 10       │
│ 2. Affordance                │ Strong      │ 8.6 / 10       │
│ 3. Signifiers                │ Moderate    │ 7.6 / 10       │
│ 4. Feedback                  │ Good        │ 8.0 / 10       │
│ 5. Mapping                   │ Exceptional │ 9.4 / 10       │
│ 6. Constraints               │ Good        │ 8.2 / 10       │
│ 7. Conceptual Models         │ Good        │ 8.4 / 10       │
└──────────────────────────────┴─────────────┴────────────────┤
```

---

### 1. Discoverability
> *Can the user figure out what actions are possible and where they can be performed?*

- **Compliance**: **Moderate (7.8 / 10)**
- **Positive Findings**:
  - The top navigation bar clearly surfaces core actions: view modes (`Day`, `Week`, `Month`, `Agenda`, `Year`), `Today` anchor button, date navigation chevrons, and primary `New Event` action button.
  - Shortcut badges (`/`, `⌘K`, `?`) directly advertise alternative access methods on their trigger buttons.
  - The Help (`?`) modal provides a comprehensive inventory of all available keyboard interactions.
- **Deficiencies & Violations**:
  - **DN-D1 (Medium)**: *Hidden Grid Creation Affordance*: An uninitiated user has no visual clue that clicking and dragging across empty time slots creates an event until they accidentally hover or drag.
  - **DN-D2 (Low)**: *Today Rail Rediscovery*: When the right-hand Today agenda rail is collapsed, the small calendar icon in the top utility toolbar does not explicitly indicate that it restores the right sidebar.
  - **DN-D3 (Medium)**: *Context Menu Discovery*: Right-clicking on an event reveals critical power tools (color customization, duplicate, delete), but there is no 3-dot overflow menu (`...`) on event cards to signal that secondary actions exist for touch/pointer users.

---

### 2. Affordance
> *What can an object do? Are the actual physical and digital properties perceivable?*

- **Compliance**: **Strong (8.6 / 10)**
- **Positive Findings**:
  - Primary and secondary buttons feature tactile depth, elevation, hover scaling, and clear button borders.
  - Checkboxes in calendar lists have clear binary toggle affordances.
  - Draggable elements update pointer styles to `grab` / `grabbing` on mousedown.
- **Deficiencies & Violations**:
  - **DN-A1 (Medium)**: *Event Resize Handles*: Events can be resized by dragging their bottom edges, but the bottom edge has zero visible height or visual grip indicator. Users must guess that the bottom border affords vertical stretching.

---

### 3. Signifiers
> *Where should the action take place? Do signals clearly communicate where and how to interact?*

- **Compliance**: **Moderate (7.6 / 10)**
- **Positive Findings**:
  - Tooltips with hotkey badges on navigation buttons clearly explain intended actions.
  - Sync button icon spins during network activity to signify work in progress.
  - `DirtyDraftDialog` alerts the user when an action will cause loss of unsaved state.
- **Deficiencies & Violations**:
  - **DN-S1 (High)**: *Absence of Resize Gripper*: Event blocks lack a subtle bottom drag bar or horizontal handle (`═` or chevron) to signify resizing capability.
  - **DN-S2 (Medium)**: *Filter vs. Command Palette Signifiers*: The `/` quick search input and `⌘K` command palette look nearly identical in geometry and styling within the top bar, confusing users about which tool searches current events vs. commands/navigation.
  - **DN-S3 (Low)**: *Time Indicator Precision*: The current time red line clearly signifies the present moment, but hovering along the time gutter does not render a ghost time pill to signify exactly what slot a click will target.

---

### 4. Feedback
> *Is the user informed about the results of their action immediately and clearly?*

- **Compliance**: **Good (8.0 / 10)**
- **Positive Findings**:
  - Non-blocking `ErrorBanner` communicates backend synchronization and network errors.
  - Copilot drawer displays a streaming typing indicator during prompt processing.
  - Drag-selection renders a shaded ghost block reflecting the temporary time range in real time.
- **Deficiencies & Violations**:
  - **DN-F1 (High)**: *Missing Transient Mutation Confirmation (Toasts)*: When an event is moved, resized, or created, the visual block shifts on the grid, but there is no explicit confirmation toast (e.g., *"Event rescheduled to Thursday, 3:00 PM - Undo"*). If an event moves out of the current viewport, the user receives zero feedback.
  - **DN-F2 (Medium)**: *Sync Success Silent State*: When background sync completes successfully, the rotating spinner simply stops. There is no subtle checkmark or "Synced just now" indicator to confirm fresh data was obtained.

---

### 5. Mapping
> *Is the relationship between controls and their movements or results natural and predictable?*

- **Compliance**: **Exceptional (9.4 / 10)**
- **Positive Findings**:
  - Spatial mapping in Week/Day views is 1:1 with standard physical schedules: vertical distance directly maps to elapsed time; horizontal position maps to chronological calendar days.
  - Left navigation mini-month calendar visually maps dates directly onto the main viewport.
  - Next/Previous date controls match Western reading direction (Left = Past, Right = Future).
- **Deficiencies & Violations**:
  - **DN-M1 (Low)**: *View Mode Switch Direction*: The view mode pill is ordered `[Day, Week, Month, Agenda, Year]`. While logical, transitioning between `Week` and `Agenda` changes the spatial metaphor from a 2D spatial grid to a 1D vertical list without a view transition signifier.

---

### 6. Constraints
> *Are physical, logical, semantic, and cultural constraints utilized to prevent errors?*

- **Compliance**: **Good (8.2 / 10)**
- **Positive Findings**:
  - `handleStartTimeChange` in `QuickCreateModal` enforces a logical constraint: advancing start time automatically shifts end time forward by 30 minutes.
  - Unsaved draft guard prevents accidental modal closure via `Escape` or backdrop click.
  - Read-only calendar events disallow drag mutations.
- **Deficiencies & Violations**:
  - **DN-C1 (High)**: *End-Time Dropdown Pre-Start Times*: While submitting an event with `end <= start` is blocked by validation logic, the End Time dropdown still allows selecting times earlier than the Start Time. Disabling or filtering earlier options in the dropdown enforces a physical constraint rather than a post-action error.
  - **DN-C2 (Medium)**: *Drag Beyond Calendar Boundaries*: Dragging an event near the edge of the visible week does not auto-scroll or advance the view to adjacent weeks.

---

### 7. Conceptual Models
> *Does the user's mental model of the system match the actual system model?*

- **Compliance**: **Good (8.4 / 10)**
- **Positive Findings**:
  - Follows established conventions from Google Calendar, Outlook, and Apple Calendar.
  - Multi-calendar visibility with toggleable color-coded checkboxes mirrors standard personal/work organization habits.
- **Deficiencies & Violations**:
  - **DN-CM1 (Medium)**: *Dual Search Mental Model*: Having both an in-page search bar (`/`) and a command palette (`⌘K`) splits the search mental model. Users wonder: *"Does ⌘K search my events? Does `/` let me execute commands?"*
  - **DN-CM2 (Low)**: *ICS Subscription Sync Latency*: Users subscribing to an external ICS feed expect instant bi-directional updates. The UI does not clearly convey that external ICS feeds are read-only and polled periodically.

---

## Prioritized Action Plan

| ID | Issue | Principle | Severity | Effort | Recommended Action |
|---|---|---|---|---|---|
| **DN-F1** | Missing Mutation Feedback & Undo Toast | Feedback | **High** | Medium | Implement toast notification with an **Undo** action upon moving/resizing/creating events. |
| **DN-S1** | Invisible Resize Handle on Event Cards | Signifiers | **High** | Low | Add a subtle 3-dot or ribbed gripper indicator on event card bottom hover. |
| **DN-C1** | End-Time Dropdown Allows Prior Times | Constraints | **High** | Low | Filter or disable all times in the End Time picker that precede the Start Time. |
| **DN-D3** | No Overflow Menu on Event Cards | Discoverability | **Medium** | Low | Add an accessible 3-dot context trigger (`...`) on event cards alongside right-click. |
| **DN-CM1** | Duplicate Search Modalities (`/` vs `⌘K`) | Conceptual Models | **Medium** | Medium | Clarify search placeholder: `"Filter this week's events (/)"` vs `"Commands & Navigation (⌘K)"`. |
| **DN-F2** | Sync Success Indicator | Feedback | **Medium** | Low | Transition sync icon to a green checkmark pill for 2 seconds upon successful sync completion. |

---

## Architectural Redesign Proposals

### Proposal 1: Unified Action Feedback & Undo Stack (DN-F1)
Introduce a global or view-scoped Toast system for calendar mutations.
- **Pattern**:
  ```tsx
  toast.success("Rescheduled 'Architecture Review' to Thu 2:00 PM", {
    action: {
      label: "Undo",
      onClick: () => revertEventMutation(previousEventState),
    },
    duration: 4000,
  });
  ```
- **Norman Principle**: Feedback + Error Recovery. Enables the user to confirm their action succeeded without scrutinizing the grid, and provides a safety net for accidental slips.

### Proposal 2: Signified Interaction Handles on Event Cards (DN-S1, DN-D3)
Update `EventBlock` component with explicit interactive affordances on hover:
- Add a bottom drag handle bar with cursor `ns-resize` and visible styling:
  ```tsx
  <div className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize flex items-center justify-center group-hover:bg-black/10 dark:group-hover:bg-white/10">
    <div className="w-6 h-0.5 rounded-full bg-current opacity-40" />
  </div>
  ```
- Add a 3-dot trigger in the top-right corner of the event card that opens the existing context menu.
