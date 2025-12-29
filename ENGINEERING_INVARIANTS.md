# ENGINEERING_INVARIANTS

This document is **authoritative**. If this document conflicts with any other document, code comment, or informal guidance, **this document wins**.

These invariants describe rules that must remain true even if implementation details change.

## App Identity Invariants

- The app **must** optimize for **speed of capture**.
- The app **must** optimize for **keyboard-first editing**.
- The app **must** remain **local-first**.
- The app **must not** require accounts, backend services, or sync to function.
- The app **must** maintain **predictable text-editor semantics** for split/merge/indent/navigation.
- The app **must** remain **low architecture / low dependency** at the feature logic level.
- The app **must not** adopt plugin-based drag-and-drop or editor frameworks as the primary interaction model.

## Editing & Text Semantics Invariants

- A persistent capture row **must** exist and **must** allow immediate typing without hunting for an input.
- Pressing **Enter** in the capture row **must** create a new task and **must** keep focus ready for continued capture.
- Clicking task text **must** enter edit mode at the clicked caret position using caret-from-point APIs.
- Pressing **Enter** on a focused row **must** enter edit mode at the end of the row text.
- Typing a character on a focused row **must** enter edit mode and **must** append the typed character.

### Edit mode (textarea) invariants

- **Enter** (without Shift) **must** split the task at the caret into two tasks.
- Split **must** preserve indent.
- **Backspace** at the start of the textarea **must** merge the current task into the previous task.
- **Delete** at the end of the textarea **must** merge the next task into the current task.
- **Tab / Shift+Tab** **must** indent/outdent the current task without losing focus.
- **ArrowUp** at the start **must** move to the previous task and enter edit at the end.
- **ArrowDown** at the end **must** move to the next task and enter edit at the end.
- **Escape** **must** exit edit mode and **must** save.

### Edit mode precedence invariants

- Inside the textarea, normal caret movement and selection **must** remain native behavior.
- Row navigation/merge semantics **must** trigger only at textarea boundaries (start/end) when defined by the interaction rules.

## Undo & State Integrity Invariants

- Undo **must** be triggered by **Ctrl/Cmd+Z**.
- Undo **must** be deterministic and **must** apply a well-defined inverse of the last supported action.
- Undo **must** be **undo-safe** for split/merge/indent/reorder/edit/toggle/delete operations.
- Undo restoration for split/merge **must** be **ID-based**, not index-based.
- Undo **must** attempt to restore **focus and caret** to a sensible location after undo.
- Undo state **must** be represented as a stack of undoable actions (LIFO) if an undo stack exists.

## Focus, Caret, and Keyboard Invariants

- The app **must** maintain a single active row selection concept (“active row”) for keyboard operations.
- Focus restoration after mutations (including undo) **must** preserve the existing timing semantics (post-mutation restore after tasks update).
- Caret restoration when entering edit mode **must** preserve existing semantics:
  - caret position **must** be restored to the stored caret if provided
  - otherwise caret **must** be placed at the end of the text
- Global keyboard handling **must** run in the capture phase.
- Arrow-key list navigation outside edit mode **must** not hijack checkbox or button interactions.
- Global keyboard handling **must not** interfere with in-textarea editing behavior beyond defined boundary rules.

## Drag & Pointer Interaction Invariants

- Drag interactions **must** use a dedicated drag handle.
- Pointer drag vertical movement **must** reorder tasks by swapping at the midpoint threshold (existing responsiveness semantics).
- Pointer drag horizontal movement **must** indent/outdent while dragging and **must** clamp indent to the configured maximum.
- Drag **must** use pointer capture and **must** suppress user text selection during an active drag.
- Drag state **must** complete cleanly on pointer up and **must** restore cursor and selection behavior.
- While a search/view filter is active, drag/reorder **must** be disabled to avoid surprising mutations.

## State Ownership & Persistence Invariants

- Tasks **must** be stored as a single ordered array.
- Reorder **must** be implemented by moving items within the array.
- Split **must** insert the new task immediately below the current one.
- Merge **must** remove one row and concatenate text into the other row.

### Task model invariants

- Tasks **must** be plain objects.
- Task IDs **must** be unique and **must** be used as stable identifiers.
- Task tags **must** be canonicalized into `task.tags` as lowercase, de-duplicated strings.
- `task.text` **must** represent human-readable text and **must not** be the canonical source of tag state once tags are extracted.
- `task.meta.tags` (when present) **must** remain a compatibility mirror of tag state.
- Indent **must** be a bounded integer in the configured range.

### Local persistence invariants

- Primary task persistence **must** use localStorage key `tasks`.
- Backup persistence **must** use localStorage key `tasks_backup`.
- Writes **must** store a payload object containing `version` and `tasks`.
- Writes **must** write backup before primary.
- Loads **must** validate and de-duplicate by task ID.
- Loads **must** fall back to `tasks_backup` if `tasks` is missing or corrupt.

### UI persistence invariants

- UI state persistence **must** use localStorage key `task_ui_state`.
- UI persistence **must** store:
  - `activeTaskId`
  - `editingTaskId`
  - `caret`

## Theming & Separation of Concerns Invariants

- Task logic **must not** depend on theme selection or theme mode.
- Theme selection **must** be layout-owned and **must** remain separate from task features.
- Theme selection **must** default to system preference and **must** allow explicit override.
- Theme override **must** be stored in localStorage key `theme`.
- Theme application **must** apply the `dark` class to `<html>` before paint (pre-hydration behavior).
- Theme tokens **must** remain token-based (`bg-*`, `text-*`, `border-*`, `ring-*`) rather than feature-specific hardcoding.

## Refactor Permission Boundaries

- Refactors **must not** change user-visible behavior or interaction semantics.
- Refactors **must not** change timing or ordering of focus, caret, undo, drag, or keyboard effects.
- Refactors **must not** change filtering semantics for search/tag views.
- Refactors **must not** change persistence keys, persistence payload shape, or persistence ordering guarantees.
- Refactors **must not** weaken invariants by “best effort” wording; invariants **must** remain strict.


