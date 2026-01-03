page.tsx structural index
version: 1.0
scope: single-file structural mapping only
last-reviewed: 2026-01-02

SECTION MAP

Section 1
Lines: ~1–80
Responsibility: Imports and top-level wiring of components, hooks, controllers, utilities, and drag primitives.
Primary state touched: none

Section 2
Lines: ~80–170
Responsibility: SortableTaskItem wrapper providing visual state, drag block styling, indent snap indicators, and drop target feedback.
Primary state touched: none (props only)
Notes: UI-only, driven by drag state

Section 3
Lines: ~180–270
Responsibility: Domain types and models including Task, List, TaskMeta, TaskIntent, and UndoAction.
Primary state touched: none
Notes: Referenced across most logic paths

Section 4
Lines: ~270–300
Responsibility: Constants for indentation, drag thresholds, and special row identifiers.
Primary state touched: none

Section 5
Lines: ~300–430
Responsibility: Home component initialization, persistent task hook usage, active list resolution, and list CRUD state.
Primary state touched:
- allTasks
- activeListId
- lists
- undoStacksByList

Section 6
Lines: ~430–520
Responsibility: Search query state, search scope, derived task slices, recent views, and momentum view toggling.
Primary state touched:
- searchQuery
- searchScope
- recentViews
- isMomentumViewActive

Section 7
Lines: ~520–620
Responsibility: Focus controller, caret tracking, UI state persistence, and editing lifecycle wiring.
Primary state touched:
- activeTaskId
- editingId
- editingText
- caretPos
Notes: Heavy cross-cutting dependencies

Section 8
Lines: ~620–720
Responsibility: List and search lifecycle effects, hydration guards, one-time data migrations.
Primary state touched:
- allTasks
- searchQuery
- searchScope

Section 9
Lines: ~720–820
Responsibility: Drag enablement rules, canonical drag task slice derivation, dnd-kit controller initialization.
Primary state touched:
- dragState
- allTasks
- undoStack
Notes: Tight coupling with UI feedback

Section 10
Lines: ~820–950
Responsibility: Tag parsing, inline token extraction, canonical task commit logic, intent and momentum handling.
Primary state touched:
- allTasks
- undoStack
Notes: Enforces canonical data rules

Section 11
Lines: ~950–1030
Responsibility: Editing controller creation and exposure of editing operations.
Primary state touched:
- editingId
- editingText
- activeTaskId
Notes: Boundary between UI and editing logic

Section 12
Lines: ~1030–1100
Responsibility: Tag click handling and search query composition, including edit commits before context switch.
Primary state touched:
- searchQuery
- undoStack
- editingId

Section 13
Lines: ~1100–1160
Responsibility: Lifecycle effects for focus management and capture row enforcement.
Primary state touched:
- activeTaskId

Section 14
Lines: ~1160–1210
Responsibility: Keyboard controller wiring for global navigation and undo integration.
Primary state touched:
- undoStack
- activeTaskId

Section 15
Lines: ~1210–1300
Responsibility: Task mutation helpers including completion, deletion, momentum toggle, and tag removal.
Primary state touched:
- allTasks
- undoStack

Section 16
Lines: ~1300–1550
Responsibility: Core textarea key handling including merge, split, indent, and caret navigation.
Primary state touched:
- allTasks
- undoStack
- editingId
- caretPos
Notes: Highest-risk section

Section 17
Lines: ~1550–1650
Responsibility: Row-level key handling when not editing, including selection, activation, and indentation.
Primary state touched:
- activeTaskId
- editingId

Section 18
Lines: ~1650–1750
Responsibility: Derived render state including normalized queries, tag tokens, visible task calculations.
Primary state touched: none (derived only)

Section 19
Lines: ~1750–1950
Responsibility: Sidebar rendering for lists, including rename, delete, and create flows.
Primary state touched:
- lists
- activeListId

Section 20
Lines: ~1950–2300
Responsibility: Search UI, tag overlays, active filters, recent views, and momentum view UI.
Primary state touched:
- searchQuery
- searchScope
- recentViews
- isMomentumViewActive

Section 21
Lines: ~2300–2850
Responsibility: Task list rendering including capture row, sortable task rows, drag visuals, and TaskRow integration.
Primary state touched:
- activeTaskId
- editingId
- dragState
Notes: Extremely sensitive to behavioral changes

CROSS-CUTTING STATE

- allTasks
- undoStack
- activeTaskId
- editingId
- editingText
- caretPos
- searchQuery
- effectiveActiveListId

HIGH-RISK ZONES

- Section 16: Textarea key handling (merge, split, indent, undo)
- Section 9: Drag controller and block logic
- Section 7: Focus and caret orchestration
- Section 21: Render and drag integration

SAFE EXTRACTION CANDIDATES

- Section 2: SortableTaskItem wrapper
- Section 10: Tag parsing and commit helpers
- Section 12: Tag search click logic
- Section 15: Task mutation helpers

UNSAFE WITHOUT DEEP TESTING

- Sections 7, 9, 16, 21
