# Task App Engineering Guide

## 1. App Philosophy

### What the app optimizes for
- **Speed of capture**: add tasks quickly, stay in flow.
- **Keyboard-first editing**: most structure changes (split, merge, indent/outdent, undo, navigate) are doable without the mouse.
- **Low architecture / low dependency**: keep logic local, avoid heavy libraries unless needed.
- **Predictable text-editor semantics**: split/merge behaviors should feel like a lightweight outliner.
- **System-first theming**: default to system preference, allow explicit override; keep theme logic out of task logic.

### What it deliberately avoids
- **Accounts / backend / sync** (for now): data is local-first.
- **Plugin-based DnD / editor frameworks**: custom pointer + keyboard logic instead.
- **Complex state frameworks**: no Redux, no external state machine.
- **Premature “task model explosion”**: tasks are plain objects with minimal fields.
- **Theme logic in features**: task interactions must not depend on theme; theme is layout-owned.

---

## 2. Core Interaction Rules

### Add
- **Enter in the top input**: creates a new task (prepended to the list) and keeps focus in the input.

### Select / Focus / Edit
- **Row focus (“active” row)**: one row is considered active for keyboard ops.
- **Click task text**: enters edit mode at the clicked caret position (multiline/wrapped safe; uses caret-from-point APIs).
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

### Edit mode notes (important)
- Arrow keys do **not** always jump between items: they only jump at **start/end** of the textarea; in the middle they move the caret normally.
- Merge operations (backspace/delete) and split operations are designed to be **undo-safe** and **ID-based**.

### Reorder + Indent (drag handle)
- **Pointer drag vertical**: reorder tasks (swap at midpoint for responsiveness).
- **Pointer drag horizontal**: indent/outdent while dragging (clamped to max indent).
- **Pointer capture + user-select suppression**: prevents accidental text selection during drag.

### Undo
- **Ctrl/Cmd+Z**: undo the last supported action.
- Undo attempts to restore **focus and caret** to a sensible place (especially for split/merge).
- Undo is **single-step** (not a stack).

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

### Persistence key
- Tasks are stored under **localStorage key**: `tasks` (JSON array).

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
All cross-row and document-level state is owned by the page component:
- **tasks** (source of truth)
- editing state (**editingId**, **editingText**, **caretPos**)
- selection state (**activeTaskId**)
- drag state (**dragIndex**, refs for drag)
- undo state (**undoAction**)

Theme state is owned by the layout layer:
- **System preference**: `prefers-color-scheme`
- **Optional override**: localStorage `theme` = `"light" | "dark"` (absence implies "system")
- The **dark class** is applied to `<html>`

### What components are stateless
- Presentational helpers like the drag handle are stateless.
- **TaskRow is a controlled component**: it renders state and emits intent but does not own cross-row state or persistence.

### Undo ownership
- Undo is a single “last action” slot (`undoAction`), not a stack.
- Undo is triggered via a window keydown handler (capture phase) and applies a deterministic inverse operation.
- Split/merge undo uses **IDs**, not indexes, to avoid corruption when the list changes.

---

## 5. Component Responsibilities

### page.tsx
- Owns all document-level state, persistence, and orchestration logic.
- Renders the input + task list UI.
- Implements:
  - task creation and deletion
  - split/merge behaviors
  - keyboard navigation and shortcuts
  - drag reorder + drag indent logic
  - undo orchestration
  - localStorage persistence

### TaskRow (implemented)
- Renders UI for a single task row (indent rail, drag handle, checkbox, text/editor, delete button).
- Handles interactions **within the boundaries of one row**:
  - text vs textarea rendering
  - caret positioning inside the textarea
  - row-local key handling
  - pointer events on the drag handle
- Emits intent via callbacks for cross-row operations.
- Does **not** own task list mutation, undo, persistence, or ordering.

### layout.tsx + theme components
- `app/layout.tsx` owns theme:
  - inline pre-hydration script to apply theme before paint
  - mounts `ThemeManager` + renders a minimal UI `ThemeSwitcher`
- `components/theme-manager.tsx`:
  - syncs `<html class="dark">` with system preference unless overridden
  - listens to matchMedia changes and cleans up listeners
- `components/theme-switcher.tsx`:
  - dropdown with **System / Light / Dark**
  - writes/removes `localStorage.theme`

### hooks (if any)
None currently. Potential future hooks:
- `useLocalStorageTasks()`
- `useUndo()`
- `useRovingFocus()`
- `useDragReorderIndent()`

---

## Current State – Post TaskRow Extraction
- `TaskRow` has been extracted as a controlled component.
- No user-visible behavior changed.
- `page.tsx` still owns:
  - the tasks array and ordering
  - undo logic
  - persistence (localStorage)
  - cross-row operations (split, merge, reorder, indent)
- Row-level rendering and interaction logic now lives in `TaskRow`.
- The build compiles and UX is unchanged.

---

## 6. Theming Strategy (current or planned)

### Current
- **System-first** with optional override:
  - default uses `prefers-color-scheme`
  - optional override in localStorage key `theme` with values `"light" | "dark"`
  - override wins over system preference
- Applies the **`dark`** class to the `<html>` element.
- **No theme logic in task logic** (`page.tsx` remains theme-agnostic).
- UI is mostly token-based (`bg-background`, `text-foreground`, `border-border`, `ring-ring`).

### Planned direction
- Prefer **tokenized CSS variables** (e.g., background/foreground/border/ring).
- Keep theme selection outside task logic.

### What components must not know
- Task logic should not depend on theme mode.
- Keyboard/undo/drag logic should remain theme-agnostic.
- Avoid Tailwind `dark:` variants in feature components; rely on tokens and `<html class="dark">`.

---

## 7. Known Pain Points

### Brittle areas
- **Large `page.tsx`**: many intertwined behaviors still live at the document level.
- **Index usage**: some interactions still rely on `index`; IDs are safer.
- **LocalStorage corruption**: duplicate IDs can break reconciliation; may require dedupe-on-load.
- **Multiple input modalities**: mouse + keyboard + pointer drag require strict precedence rules.
- **Dev cache issues**: deleting `.next` may be required after crashes.

### Suspected wrong / risky
- Undo is single-step; complex sessions can feel inconsistent.
- Caret restoration is best-effort; browser APIs vary.
- Arrow navigation semantics are subjective.

### Areas intentionally avoided (so far)
- True outliner semantics (collapse, parent/child constraints).
- Persistent focus across reloads.
- Undo stack / redo.
- Rich theme primitives in feature code.

---

## 8. Non-Goals

- Multi-user sync, accounts, cloud storage.
- Rich text / markdown formatting.
- Complex prioritization (due dates, reminders).
- Full Kanban/project management features.
- Plugin architecture or editor frameworks unless unavoidable.
