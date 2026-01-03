# Project Reconstruction Specification

## Overview

TaskTracker is a capture-first task management application built with Next.js. It features a hierarchical task list with support for tags, intents (now/soon/later), momentum tracking, multiple lists, keyboard-driven navigation, drag-and-drop reordering, and local storage persistence.

---

## Project Structure

### Framework & Build
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS with CSS variables for theming
- **UI Components**: shadcn/ui (Radix-based)
- **Drag & Drop**: @dnd-kit/core and @dnd-kit/sortable
- **State Management**: React hooks (useState, useEffect, useRef, useCallback)

### Directory Structure
```
app/
  - page.tsx: Main task list component
  - layout.tsx: Root layout with theme initialization
  - globals.css: Global styles and CSS variables

components/
  - TaskRow.tsx: Individual task row rendering
  - theme-manager.tsx: Theme state synchronization
  - theme-switcher.tsx: Theme selection dropdown
  - ui/: shadcn/ui component library

hooks/
  - usePersistentTasks.ts: Task and list persistence

lib/
  - dragController.ts: Drag-and-drop block operations
  - editingController.ts: Task editing and inline tag commit
  - focusController.ts: Caret position and focus management
  - highlightMatches.tsx: Search result highlighting
  - keyboard.ts: Keyboard navigation helpers
  - keyboardController.ts: Global keyboard shortcuts
  - parseTaskMeta.ts: Tag extraction from text
  - taskTags.ts: Tag removal operations
  - uiState.ts: UI state persistence
  - undo.ts: Undo action application
  - utils.ts: Utility functions
  - views.ts: Search and filtered view logic
```

---

## Data Model

### Task Interface
```typescript
interface Task {
  id: string;                  // Format: `${timestamp}-${random16hex}`
  text: string;                // Human-readable text (no inline #tags)
  createdAt: number;           // Unix timestamp in milliseconds
  order: number;               // Manual ordering (lower = higher priority)
  listId?: string;             // Reference to containing list
  completed: boolean;          // Completion status
  completedAt?: number;        // Unix timestamp when completed
  archived: boolean;           // Archive flag (hidden by default)
  archivedAt?: string;         // ISO timestamp when archived
  indent: number;              // Nesting level (0-2)
  tags: string[];              // Normalized lowercase tags (no # prefix)
  intent?: 'now' | 'soon' | 'later';  // Intent classification
  momentum?: boolean;          // Deliberate working set flag
  meta?: {
    tags: string[];            // Mirror of tags array
  };
}
```

### List Interface
```typescript
interface List {
  id: string;                  // Format: `list-${timestamp}-${random16hex}`
  name: string;                // Display name
  createdAt: number;           // Unix timestamp
}
```

### UndoAction Types
```typescript
type UndoAction =
  | { type: 'delete'; task: Task; index: number }
  | { type: 'edit'; task: Task }
  | { type: 'toggle'; task: Task }
  | { type: 'indent'; task: Task }
  | { type: 'split'; original: Task; createdId: string; cursor: number }
  | {
      type: 'merge';
      direction: 'backward' | 'forward';
      keptOriginal: Task;
      removed: Task;
      caret: number;
    };
```

---

## Task Sorting Logic

Tasks are sorted by a fixed priority hierarchy, then by `order` field:

**Order of intent categories:**
1. `intent === 'now'`
2. `intent === 'soon'`
3. `intent === 'later'`
4. No intent (undefined/null)
5. Archived tasks (always at end)

Within each category, tasks are sorted by `order` ascending.

**Archived task sorting:**
Archived tasks are placed at the end, sorted by `archivedAt` timestamp (fallback to `order` if missing).

---

## Tag Parsing & Normalization

### Tag Extraction (parseTaskMeta.ts)
- Regex pattern: `/(^|\s)#([a-zA-Z0-9_-]+)/g`
- Tags are extracted and converted to lowercase
- Duplicates are removed via Set

### Inline Tag Commit (editingController.ts)
Tags are NOT derived from text in real-time. Tags are committed when:
1. Whitespace follows the tag token during typing
2. Task is saved (blur, Enter, Escape)
3. Task is split

**Tag commit regex (space-terminated):** `/(^|\s)#([a-zA-Z0-9_-]+)(?=\s)/g`

Tags are stripped from text upon commit and stored in `task.tags[]` only.

### Tag Search Matching
- Tags match case-insensitively
- Partial tag matches are allowed (e.g., `#bug` matches `#bugs`, `#debugging`)
- Tag tokens in search: `#tagname`

---

## Intent Tokens

### Syntax
- `!now` - Sets intent to 'now'
- `!soon` - Sets intent to 'soon'
- `!later` - Sets intent to 'later'

### Behavior
- Tokens are stripped from visible text on commit
- Intent is stored in `task.intent` field
- Multiple intents: last one wins
- Preserved across edits unless explicitly changed

### Intent Cycling (UI)
When clicking the intent indicator:
- `undefined` → `'now'`
- `'now'` → `'soon'`
- `'soon'` → `'later'`
- `'later'` → `undefined`

---

## Momentum Feature

### Toggle Syntax
- `!m` token in task text toggles momentum on

### Behavior
- Momentum is a boolean state stored in `task.momentum`
- Typing `!m` sets momentum to `true`
- Removing `!m` from text does NOT automatically unset momentum
- Momentum must be toggled via the UI indicator (dot button)

### Momentum View
- Filters tasks to show only those with `momentum === true`
- Count displayed in view toggle button
- Flattens hierarchy (indent = 0) during momentum view

---

## Task Creation

### Capture Row Behavior
- Always visible at top of task list
- ID: `__new__` (string constant)
- Accepts text input with Enter to commit
- Requires text or tags to commit (empty row ignored)
- Blur with content commits; blur with empty text cancels

### New Task Defaults
```typescript
{
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  text: parsed.text,
  createdAt: Date.now(),
  order: Date.now(),              // Timestamp as initial order
  completed: false,
  archived: false,
  indent: 0,
  tags: parsed.tags,
  listId: activeListId,
  intent: parsed.intent ?? 'now',  // Default to 'now' if not specified
  momentum: parsed.momentum,
  meta: { tags: parsed.tags },
}
```

### Tag-Only Tasks
Tasks with tags but no visible text display tags in italics below the row.

---

## Editing Behavior

### Edit Activation
- Click on task row text area
- Press Enter on active task
- Type any character on selected task
- Click text click position sets caret via `caretPositionFromPoint`/`caretRangeFromPoint`

### Text Changes During Edit
- First keystroke establishes undo snapshot (type: 'edit')
- Tags are NOT auto-committed on every keystroke
- Tags commit only when whitespace is typed after tag
- Preserves existing tags when adding new ones (union)

### Edit Commit Triggers
- Enter (without Shift)
- Escape
- Blur (losing focus)
- Switching to another task
- Tag search click

### Edit Cancellation
- Escape without changes exits edit mode without creating undo entry
- If text unchanged and no new tags, no undo action created

---

## Keyboard Shortcuts

### Global (Ctrl/Cmd + Z)
- **Ctrl/Cmd + Z**: Undo last action
- Undo stack is per-list (keyed by `effectiveActiveListId || '__default__'`)

### Navigation (when not editing)
- **ArrowUp/ArrowDown**: Move selection between tasks
- Navigation wraps at boundaries (stays at first/last)
- Start editing on selected task

### Editing Mode (in textarea)
- **Enter**: Commit and split task at cursor
- **Shift+Enter**: Newline (no commit)
- **Escape**: Commit and exit edit mode
- **Tab**: Indent/outdent (Shift+Tab = outdent)
- **Backspace** (at cursor position 0): Merge with previous task
- **Delete** (at end of text): Merge with next task
- **ArrowUp** (at cursor 0): Jump to end of previous task
- **ArrowDown** (at text end): Jump to start of next task

### Tab Behavior
- **Tab**: Increase indent (max 2)
- **Shift+Tab**: Decrease indent (min 0)
- Tab is IGNORED during tag search (avoids accidental indent)
- Blocked if `normalizedQuery.length > 0` (search active)

---

## Task Merging

### Backspace Merge (at start)
When cursor at position 0 and Backspace pressed:
- Previous task text + current task text = merged text
- Previous task intent preserved (unless specified)
- Current task tags merged with previous (union)
- Current task momentum preserved if true
- Previous task updated; current task deleted
- Undo action type: 'merge' with direction 'backward'

### Delete Merge (at end)
When cursor at text end and Delete pressed:
- Current task text + next task text = merged text
- Current task intent preserved (unless specified)
- Next task tags merged with current (union)
- Next task momentum preserved if true
- Current task updated; next task deleted
- Undo action type: 'merge' with direction 'forward'

---

## Task Splitting

### Trigger
Enter pressed during task edit (without Shift)

### Behavior
1. Text before cursor → original task
2. Text after cursor → new task
3. New task created immediately after original
4. Cursor moves to new task (position 0)
5. Any tags typed during edit session are committed to original task
6. New task gets default intent 'now' and empty tags

### Undo Record
```typescript
{
  type: 'split',
  original: { ...originalTask, text: fullOriginalText, tags: mergedTags, intent, meta },
  createdId,
  cursor,  // Original cursor position
}
```

---

## Indentation

### Constants
- **MAX_INDENT**: 2 (maximum nesting level)
- **INDENT_WIDTH**: 28px (visual indent per level)
- **DRAG_INDENT_WIDTH**: 20px (drag threshold)

### Behavior
- Tasks can be indented 0-2 levels
- Hierarchy is purely visual in standard view
- Dragging a parent task moves entire block (parent + contiguous children)
- Block children have indent > parent indent
- Views (search/momentum) flatten hierarchy to indent 0

### Indent Guides
- Visible when hovering or during drag
- Show all possible indent levels during drag with active highlight

---

## Drag and Drop

### Block Operations
- Dragging a parent task moves parent + all contiguous child tasks (indent > parent)
- Block range computed at drag start
- Child tasks maintain relative indent offsets

### Drag Sensors
- PointerSensor with 5px activation distance
- Prevents accidental drags during clicks

### Indent Adjustment During Drag
- Horizontal delta maps to indent changes
- Step = `Math.trunc(deltaX / INDENT_WIDTH)`
- Safe shift computed to preserve relative child depths
- Blocked indicator shows when cannot indent further

### Reorder Logic
- Block inserted at target position
- Neighbor constraint: base indent cannot exceed `prevIndent + 1`
- If current indent > max allowed, adjusted down
- Undo snapshot captured at drag start

### Visual Feedback
- Drag source: dimmed original position
- Drag target: highlighted drop zone
- Insert line: shows above target row
- Indent snap: visual pulse on indent change

---

## Lists

### Default List
- Created automatically on first load if none exist
- Named "Inbox"
- Cannot be renamed or deleted
- First list by `createdAt` is always Inbox

### List Operations
- **Create**: Enter name and click Add or press Enter
- **Rename**: Double-click list item (not Inbox), Enter to save, Escape to cancel
- **Delete**: Click delete icon, confirm dialog; tasks moved to Inbox
- **Switch**: Click list item

### List IDs
- Format: `list-${Date.now()}-${Math.random().toString(16).slice(2)}`

### List Tasks
- Tasks filtered by `listId` for display
- Drag only operates within current list
- Global search can scope to "All lists"

---

## Search & Views

### Search Query Parsing
- Trims whitespace, lowercases
- Multiple tokens separated by whitespace
- Tokens starting with `#` are tag searches
- Other tokens are text searches

### View State Derivation
```typescript
deriveViewState(raw: string): SearchViewState | null
// Returns null if empty, else { type: 'search', query: lowercaseTrimmed }
```

### Tag View Detection
View is "tag view" if ALL tokens start with `#` and have length > 1.

### Search Scope
- **This list**: Filters current list only
- **All lists**: Filters across all lists (shows list name in results)

### Tag Search Composition
- Clicking a tag in task row adds to search query
- Composes tags with AND logic (space-separated)
- Replaces query if non-tag tokens exist
- Prevents duplicate tags in query

### Tag Removal from Search
- Backspace at end of search with active tags removes last tag token
- Click × on filter token removes it

### Active Filters Display
- Shows current search tokens as removable chips
- Styled differently from recent views

### Views
- **Momentum View**: Toggle showing only `momentum === true` tasks
- **Tag View**: Visual styling change when all search tokens are tags
- **Text View**: Standard search result display

### Recent Views
- Maximum 8 recent search queries
- Ephemeral (not persisted across sessions)
- Capped internally, rendered freely
- Canonicalized before storage

---

## Undo System

### Undo Stack
- Per-list (keyed by active list ID or `'__default__'`)
- Unlimited stack depth
- Undo action pushed BEFORE mutation

### Undo Actions
| Action Type | Snapshot | Restoration |
|------------|----------|-------------|
| delete | Full task + index | Reinsert at index |
| edit | Pre-edit task | Restore pre-edit state |
| toggle | Pre-toggle task | Toggle back |
| indent | Pre-indent task | Restore indent |
| split | Original task | Remove created task |
| merge | KeptOriginal + Removed | Restore both tasks |

### Focus Restoration (getUndoPendingFocus)
- split: Focus original task at cursor position
- merge: Focus kept task at specified caret
- others: Focus task row

### Undo Shortcut
- **Ctrl/Cmd + Z**: Pop and apply last action
- Applies `applyUndo(prev, action)` then slices stack

---

## Persistence

### Storage Keys
- **tasks**: Primary task storage
- **tasks_backup**: Fallback backup (written before primary)
- **task_lists**: Lists storage
- **task_ui_state**: UI state (activeTaskId, editingId, caret, activeListId)
- **theme**: Theme preference

### Storage Format
```json
{
  "version": 1,
  "tasks": [/* Task objects */]
}
```

### Loading Order (loadTasks)
1. Try primary storage
2. Fallback to backup
3. Return empty array if both fail

### Write Order (useEffect)
1. Write backup first
2. Write primary second
3. Fail silently on errors

### List Persistence
- Persisted immediately on create/rename/delete
- Loaded on hydration

### UI State Persistence
- Stored on every change to: activeListId, activeTaskId, editingId, caretPos
- Restored on page load if tasks/lists available
- Checks validity (task exists, list exists) before restoring

### Data Migration
On first load after deployment:
- Missing `listId`: Assign to Inbox or active list
- Missing `intent`: Assign `'now'` to non-archived, non-completed tasks

---

## Theme System

### Themes
- **system**: Follow OS preference
- **light**: Light mode
- **dark**: Dark mode
- **dark-blue**: Dark with blue accent
- **black**: Pure black background

### Initialization (layout.tsx)
Inline script runs BEFORE React hydration:
1. Reads `localStorage.getItem('theme')`
2. Checks `matchMedia('(prefers-color-scheme: dark)')` for system
3. Resolves to concrete theme
4. Sets `document.documentElement.dataset.theme`
5. Toggles `dark` class on document

### Theme Manager
- Syncs with system theme changes if user selected 'system'
- Listens for `storage` event (other tabs)
- Listens for custom `themechange` event
- Applies theme via dataset attribute

### Theme Switcher
- Dropdown menu with theme options
- Stores selection in localStorage
- Dispatches `themechange` event

### CSS Variables
Theme is controlled via CSS custom properties on `:root` and `.dark` class.

---

## Accessibility

### ARIA
- Search input: `aria-label="Search tasks or #tags"`
- Tag buttons: `aria-label="Remove tag {tag}"`
- Remove buttons: `aria-label="Remove recent view {query}"`
- Rows: `role="listitem"`
- List container: `role="list"`

### Focus Management
- Tab index -1 on inactive rows
- Tab index 0 on active row
- Focus ring visible on active row
- Focus preserved during undo

### Keyboard
- All functionality accessible via keyboard
- Focus trapped appropriately
- Escape key handled globally

### Screen Readers
- Tag tokens visually styled, semantically plain text
- Momentum indicator has no label (decorative dot)

---

## Edge Cases & Ambiguities

### Ambiguous Behaviors
1. **Momentum toggle via text**: Typing `!m` sets momentum=true. There is no way to set momentum=false via text; must use UI toggle.
2. **Tag removal from search**: Backspace at end of search removes last tag token only if cursor at end and no selection.
3. **Tab during search**: Tab is completely ignored (no indent) when search query is non-empty. This may be unintentional but is enforced behavior.
4. **Empty row commit**: Requires text OR tags. Empty row with no content is ignored on blur.
5. **Duplicate tags**: Tags are deduplicated in both parsing and storage. No way to have duplicate tag entries.
6. **Intent preservation**: When merging or editing, intent is preserved unless explicitly changed. The rule for determining which intent to keep is based on parsed intent falling back to original.
7. **Order field updates**: Only active (non-archived, non-completed) tasks get order updates. Archived/completed tasks retain their order value.

### Known Behaviors
1. **Console logging**: Drag operations log to console (DEBUG_DRAG = true in dragController.ts)
2. **Split console logging**: Console.log of post-split tasks exists (debug code not removed)
3. **Inbox detection**: Uses first list sorted by createdAt, not a special flag
4. **Tag matching**: Uses `includes()` for partial matches, not exact matches
5. **Drag activation**: 5px movement required before drag starts (PointerSensor)
6. **Caret restoration**: Uses `setSelectionRange` which may not work in all browsers/contexts
7. **Undo snapshot timing**: First edit keystroke triggers snapshot, not edit start

---

## UI Constants

### TaskRow Layout
- **ROW_LINE_HEIGHT**: 22px (integer to avoid subpixel jitter)
- **ROW_MIN_HEIGHT**: 44px
- **TAG_ROW_HEIGHT**: 14px
- **INDENT_WIDTH**: 28px
- **DRAG_INDENT_WIDTH**: 20px
- **MAX_INDENT**: 2

### Visual Styling
- Entry row: py-2, taller feel
- Task rows: py-1.5
- Selection ring: ring-1 ring-primary/60 (hidden during drag)
- Drag source: bg-muted/30
- Drag target: shadow-[0_0_0_2px_hsl(var(--primary))]
- Indent guides: w-0.5 rounded-full, bg-muted-foreground/30
- Tag styling: bg-muted/40, outline outline-1

### Animations
- Drag transition: transform 30ms cubic-bezier(0.25, 0.1, 0.25, 1)
- Snap animation: 100ms ease-out for ring/scale
- Indent animation: 75ms transition on guides

---

## Dependencies

### Runtime Dependencies
- react, react-dom
- @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- clsx, tailwind-merge (via cn utility)
- class-variance-authority (for component variants)

### Development Dependencies
- TypeScript
- Tailwind CSS
- PostCSS
- ESLint

---

## Implementation Notes

### Pure Functions (lib/)
- **views.ts**: All pure - no React, no DOM, no side effects
- **keyboard.ts**: All pure - stateless calculations
- **undo.ts**: All pure - transformation only
- **parseTaskMeta.ts**: Pure tag extraction
- **taskTags.ts**: Pure tag operations

### State Management
- Task state: useState with usePersistentTasks hook
- List state: useState with usePersistentTasks hook
- UI state: useRef + useEffect for focus/caret
- Undo state: useState per-list
- Recent views: useState (ephemeral)

### Hook Pattern
- usePersistentTasks: Combined task+list state with persistence
- useDragController: Complex drag state machine
- useKeyboardController: Global keyboard handlers
- useFocusController: Caret position tracking
- useUIStatePersistence: Cross-session UI state

### Component Structure
- Home (page.tsx): Orchestrator, handles all actions
- TaskRow: Presentational, receives callbacks
- SortableTaskItem: Wrapper for drag/drop styling

### Performance Considerations
- `contain-layout contain-paint` on task rows
- Autosize textarea only grows, never shrinks
- Event listeners use capture phase (true)
- useCallback for stable handler references
- Ref-based cursor tracking to avoid re-renders

---

## Build & Deploy

### Build Command
```bash
npm run build
# or
next build
```

### Development Command
```bash
npm run dev
# or
next dev
```

### Output
- Static export possible with `output: 'export'` in next.config.js
- Currently configured for dynamic routes (not static export)

### Environment Variables
- `NEXT_PUBLIC_SITE_URL`: Used in metadata base URL
- Defaults to `http://localhost:3000`

---

## Known Issues & Limitations

1. **No mobile drag support**: dnd-kit pointer sensor may need touch configuration for mobile
2. **No offline support**: localStorage only, no service worker sync
3. **No task sharing**: Data stays local, no export/import
4. **No collaboration**: Single-user only
5. **No search highlighting in momentum view**: activeTags check skips highlight
6. **No nested tag views**: Tags are flattened in search results
7. **No undo for drag cancel**: Drag cancel restores from snapshot but doesn't push undo
8. **No keyboard shortcut for momentum toggle**: Must use mouse or click handler
9. **No bulk operations**: No select-all, no bulk delete/archive
10. **No task duplication**: No copy/duplicate function
