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
- **createdAt**: number (unix timestamp ms)
- **order**: number (stable manual ordering key)
- **completed**: boolean
- **completedAt** (optional): number (unix timestamp ms)
- **archived**: boolean
- **archivedAt** (optional): ISO timestamp string
- **indent**: number (0..MAX_INDENT)
- **tags**: string[] (lowercased, de-duped; canonical tag state)
- **intent** (optional): `"now" | "soon" | "later"`
- **momentum** (optional): boolean
- **meta** (optional): currently `{ tags: string[] }` for backward compatibility

### Persistence key
- Primary storage is **localStorage key**: `tasks`
- Backup storage is **localStorage key**: `tasks_backup`
- Stored format is a payload object:
  - `{ version: 1, tasks: Task[] }`
- Load path is:
  - validate + dedupe tasks from `tasks`
  - fallback to `tasks_backup` if `tasks` is missing/corrupt

### Tags and “metadata”
- Tags are extracted from task text via the `#tag` pattern (letters/numbers/underscore/hyphen).
- Tag extraction:
  - collected into `task.tags` (lowercased, de-duped)
  - also mirrored into `task.meta.tags` (optional) for compatibility
  - stripped from `task.text` for the stored/display text (the `#tag` tokens are removed and whitespace is normalized)

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
All cross-row and document-level state was owned by the page component and was coordinated via extracted controllers:
- **tasks** (source of truth; persisted via `usePersistentTasks()`)
- editing state (**editingId**, **editingText**)
- caret + focus state (**caretPos**, pending focus restoration) (managed by `useFocusController()`)
- selection state (**activeTaskId**)
- view state (**searchQuery**, **recentViews**, **isMomentumViewActive**; derived visibility via `lib/views.ts`)
- drag state (**dragIndex**; drag refs + pointer handlers managed by `useDragController()`)
- undo state (**undoStack**; applied via `lib/undo.ts`, triggered by `useKeyboardController()`)

Theme state is owned by the layout layer:
- **System preference**: `prefers-color-scheme`
- **Optional override**: localStorage `theme` = `"light" | "dark"` (absence implies "system")
- The **dark class** was applied to `<html>` (pre-hydration script)
- The active theme was also applied via `<html data-theme="...">` (post-hydration via `ThemeManager`)

UI state is partially persisted:
- localStorage key: `task_ui_state`
- stores last known:
  - `activeTaskId`
  - `editingTaskId`
  - `caret`

### What components are stateless
- Presentational helpers like the drag handle are stateless.
- **TaskRow is a controlled component**: it renders state and emits intent but does not own cross-row state or persistence.

### Undo ownership
- Undo was a stack (`undoStack`) of `UndoAction` snapshots (LIFO).
- Undo was triggered via a window keydown handler (capture phase) in `useKeyboardController()` and applied a deterministic inverse operation.
- Split/merge undo uses **IDs**, not indexes, to avoid corruption when the list changes.

---

## 5. Component Responsibilities

### page.tsx
- Owned document-level state and wired orchestration via extracted controller modules.
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
Implemented:
- `usePersistentTasks()`:
  - validates + dedupes loaded tasks
  - writes `{ version: 1, tasks }` to `tasks_backup` then `tasks`

### lib controllers (implemented)
- `lib/editingController.ts`: created/committed edits and split/merged tasks while maintaining undo snapshots
- `lib/views.ts`: tokenized search, derived tag views, and computed derived visibility (pure)
- `lib/uiState.ts`: persisted/restored UI state (`task_ui_state`) for active/editing row and caret
- `lib/dragController.ts`: handled pointer drag reorder + horizontal indent (with pointer capture + user-select suppression)
- `lib/focusController.ts`: handled caret math and post-mutation focus restoration (including caret-from-point)
- `lib/keyboardController.ts`: orchestrated global keydown behavior (arrow navigation + Ctrl/Cmd+Z undo + search escape)

Potential future hooks:
- `useUndo()`
- `useRovingFocus()`
- `useDragReorderIndent()`

---

## Current State – Post TaskRow Extraction
- `TaskRow` has been extracted as a controlled component.
- Search/filter/view derivation has been extracted to `lib/views.ts` (pure functions).
- UI state persistence/restoration has been extracted to `lib/uiState.ts`.
- Drag reorder/indent pointer logic has been extracted to `lib/dragController.ts`.
- Focus/caret math and focus restoration has been extracted to `lib/focusController.ts`.
- Global keyboard orchestration (arrow nav + undo + search escape) has been extracted to `lib/keyboardController.ts`.
- `page.tsx` continues to own top-level state and composes these controllers.
- Row-level rendering and interaction logic now lives in `TaskRow`.
- The build compiles and UX has remained unchanged through the extractions.

---

## 6. Theming Strategy (current or planned)

### Current
- **System-first** with optional override:
  - default used `prefers-color-scheme`
  - optional override was stored in localStorage key `theme` with values `"system" | "light" | "dark" | "dark-blue" | "black"`
  - override won over system preference
- Applied the **`dark`** class to the `<html>` element via an inline pre-hydration script.
- Applied the selected theme via `<html data-theme="...">` (used by CSS variables in `app/globals.css`).
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
- **Search semantics**: search supported text tokens and `#tag` tokens (AND semantics) against `task.text` and `task.tags`; tag-only search was treated as a view.
- **Theme token purity**: most UI uses token classes, but `highlightMatches` currently includes a Tailwind `dark:` variant for `<mark>` styling.

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

---

## 9. Major Dependencies (Current)

### Core runtime
- `next` + App Router (`app/`): provided routing, build, and SSR/CSR boundaries
- `react` / `react-dom`: provided the UI runtime
- `typescript`: provided type checking

### Styling + UI primitives
- `tailwindcss` + `tailwindcss-animate`: provided styling and motion utilities
- shadcn/ui (`components/ui/*`) + `@radix-ui/*`: provided UI primitives used throughout the app
- `lucide-react`: provided the icon set (used in UI components)
- `class-variance-authority`, `clsx`, `tailwind-merge`: provided class composition utilities (via `cn` in `lib/utils.ts`)

### Notifications
- `sonner`: provided toasts (wired via `components/ui/sonner.tsx`)
- `next-themes`: was used by the `sonner` Toaster theme adapter (`components/ui/sonner.tsx`)

### Installed but not currently used in core task flow
- `@dnd-kit/*`: was present in dependencies; drag/reorder was implemented via custom pointer logic
- `@supabase/supabase-js`: was present in dependencies; no Supabase integration was implemented in the app code
- `zod`: was present in dependencies; no runtime schema validation was used in the app code
