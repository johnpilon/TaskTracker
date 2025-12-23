# Task App Engineering Guide

## 1. App Philosophy

### What the app optimizes for
- **Speed of capture**: add tasks quickly, stay in flow.
- **Keyboard-first editing**: most structure changes (split, merge, indent/outdent, undo, navigate) are doable without the mouse.
- **Low architecture / low dependency**: keep logic local, avoid heavy libraries unless needed.
- **Predictable text-editor semantics**: split/merge behaviors should feel like a lightweight outliner.

### What it deliberately avoids
- **Accounts / backend / sync** (for now): data is local-first.
- **Plugin-based DnD / editor frameworks**: custom pointer + keyboard logic instead.
- **Complex state frameworks**: no Redux, no external state machine.
- **Premature “task model explosion”**: tasks are plain objects with minimal fields.

---

## 2. Core Interaction Rules

### Add
- **Enter in the top input**: creates a new task (prepended to the list) and keeps focus in the input.

### Select / Focus / Edit
- **Row focus (“active” row)**: one row is considered active for keyboard ops.
- **Click task text**: enters edit mode at the clicked caret position (multiline/wrapped safe).
- **Enter on a focused row**: enters edit mode at end of text.
- **Typing on a focused row**: enters edit mode and appends the typed character.

### Edit mode (textarea)
- **Enter**: splits the task at caret into two tasks (keeps indent).
- **Backspace at start**: merges current task into the previous task (undoable).
- **Delete at end**: merges next task into current task (undoable).
- **Tab / Shift+Tab**: indent/outdent the current task (no focus loss).
- **ArrowUp at start**: jumps to previous task and edits at end.
- **ArrowDown at end**: jumps to next task and edits at end.
- **Escape**: exits edit mode (saves).

### Reorder + Indent (drag handle)
- **Pointer drag vertical**: reorder tasks (swap at midpoint for responsiveness).
- **Pointer drag horizontal**: indent/outdent while dragging (clamped to max indent).
- **Pointer capture + user-select suppression**: prevents accidental text selection during drag.

### Undo
- **Ctrl/Cmd+Z**: undo the last supported action.
- Undo attempts to restore **focus and caret** to a sensible place (especially for split/merge).

### Conflict resolution (what wins)
- **Text editing wins** inside the textarea: normal caret movement and selection remain intact; only boundary cases (start/end) trigger row navigation/merge.
- **Controls win**: checkbox and delete button keep their default behavior; row-level shortcuts do not hijack them.
- **Drag wins while active**: during pointer drag, keyboard focus is secondary; drag state must complete cleanly on pointer up.

---

## 3. Data Model

### Task shape
A task is a plain object persisted to localStorage:

- **id**: string (must be unique; used as React key)
- **text**: string (can be multiline)
- **createdAt**: ISO timestamp string
- **completed**: boolean
- **indent**: number (0..MAX_INDENT)

### Meaning of indent
- Visual hierarchy only (currently).
- Represents an outliner-like “depth” of the task.
- Does not currently enforce parent/child constraints, grouping, or completion rollups.

### Ordering rules
- Tasks are stored as a **single ordered array**.
- Reorder is done by moving items within the array.
- Split inserts the new task **immediately below** the current one.
- Merge removes one row and concatenates its text into the other row.

---

## 4. State Ownership

### Where state lives
Currently all state is owned by the page component:
- **tasks** (source of truth)
- editing state (**editingId**, **editingText**, **caretPos**)
- selection state (**activeTaskId**)
- drag state (**dragIndex**, refs for drag)
- undo state (**undoAction**)

### What components are stateless
- Presentational helpers like the drag handle are stateless.
- (There is no extracted `TaskRow` component yet; rows are rendered inline.)

### Undo ownership
- Undo is a single “last action” slot (`undoAction`), not a stack.
- Undo is triggered via a window keydown handler (capture phase) and applies a deterministic inverse operation.
- Split/merge undo uses **IDs**, not indexes, to avoid corruption when the list changes.

---

## 5. Component Responsibilities

### page.tsx
- Owns all state, persistence, and interaction logic.
- Renders the input + task list UI.
- Implements:
  - edit mode + caret control
  - split/merge behaviors
  - keyboard navigation and shortcuts
  - drag reorder + drag indent
  - undo orchestration
  - localStorage persistence

### TaskRow (planned extraction)
If/when extracted, it should:
- Render UI for one row (indent rail, drag handle, checkbox, text/editor, delete button).
- Receive callbacks and minimal props (task, index, active flags).
- Avoid owning cross-row behaviors (split/merge/reorder/undo) beyond emitting intents.

### hooks (if any)
None currently. Potential future hooks:
- `useLocalStorageTasks()`
- `useUndo()`
- `useRovingFocus()`
- `useDragReorderIndent()`

---

## 6. Theming Strategy (current or planned)

### Current
- Tailwind utility classes directly in the page for a dark UI.
- Focus/selection styles are expressed via ring utilities.

### Planned direction
- Prefer **tokenized CSS variables** (e.g., background/foreground/border/ring) and keep components using semantic tokens.
- Keep “theme selection” (light/dark/system) outside task logic.

### What components must not know
- Task logic should not depend on theme mode.
- Keyboard/undo/drag logic should remain theme-agnostic.

---

## 7. Known Pain Points

### Brittle areas
- **Large `page.tsx`**: many intertwined behaviors in one file.
- **Index usage**: some interactions still rely on `index` (drag, some edits). IDs are safer.
- **LocalStorage corruption**: duplicate IDs can break React reconciliation; needs a migration/dedupe-on-load if not already enforced.
- **Multiple input modalities**: mouse + keyboard + pointer drag overlapping requires careful precedence rules.

### Suspected wrong / risky
- Undo is single-step; complex multi-action sessions can feel inconsistent.
- Caret restoration is best-effort; browser caret-from-point APIs vary across environments.
- Arrow navigation semantics are subjective (boundary-only vs always-jump).

### Areas intentionally avoided (so far)
- Full “outliner semantics” (true parent/child relationships, collapsing, completion propagation).
- Persistent selection/focus state across reloads.
- Undo stack and redo.

---

## 8. Non-Goals

- Multi-user sync, accounts, cloud storage.
- Rich text / markdown formatting.
- Complex prioritization (due dates, reminders, recurring tasks).
- Full Kanban/project management features.
- Plugin architecture or editor frameworks unless unavoidable.