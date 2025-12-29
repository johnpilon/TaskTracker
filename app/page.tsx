'use client';

import { useState, useRef, useEffect } from 'react';
import type React from 'react';
import TaskRow from '../components/TaskRow';
import usePersistentTasks from '../hooks/usePersistentTasks';
import { parseTaskMeta } from '../lib/parseTaskMeta';
import { removeTagFromTasks } from '../lib/taskTags';
import { applyUndo, getUndoPendingFocus, pushUndo } from '../lib/undo';
import {
  nextIndentFromTab,
  nextIndexFromListArrow,
  nextIndexFromRowArrow,
  shouldIgnoreTab,
} from '../lib/keyboard';
import { createEditingController } from '../lib/editingController';
import { cn } from '../lib/utils';
import {
  applyView,
  canonicalizeViewQuery,
  deriveActiveTagTokens,
  deriveViewState,
  isTagView as isTagViewFn,
  tokenizeQuery,
} from '../lib/views';
import { useUIStatePersistence } from '../lib/uiState';
import { useDragController } from '../lib/dragController';
import { useFocusController } from '../lib/focusController';
import { useKeyboardController } from '../lib/keyboardController';

/* =======================
   Types
======================= */

export interface Task {
  id: string;
  text: string;
  createdAt: number; // unix timestamp (ms)
  order: number; // stable manual ordering
  completed: boolean;
  completedAt?: number;
  archived: boolean;
  archivedAt?: string; // ISO timestamp (set when completed becomes true)
  indent: number;
  tags: string[]; // lowercase, no '#', deduped
  intent?: 'now' | 'soon' | 'later';
  momentum?: boolean; // deliberate working set (boolean state)
  meta?: TaskMeta; // optional for backward compatibility
}

export interface TaskMeta {
  tags: string[];
}

export type TaskIntent = 'now' | 'soon' | 'later' | null;

export type UndoAction =
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
    }
  | null;

/* =======================
   Constants
======================= */

const MAX_INDENT = 2;
const INDENT_WIDTH = 28;
const NEW_TASK_ROW_ID = '__new__';

/* =======================
   Page
======================= */

export default function Home() {
  const [allTasks, setAllTasks] = usePersistentTasks();
  const tasks = allTasks.filter(t => !t.archived);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentViews, setRecentViews] = useState<string[]>([]);
  const [isMomentumViewActive, setIsMomentumViewActive] = useState(false);

  const [activeTaskId, setActiveTaskId] = useState<string>(NEW_TASK_ROW_ID);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newRowRef = useRef<HTMLDivElement | null>(null);
  const editingOriginalRef = useRef<{ taskId: string; snapshot: Task } | null>(null);
  const { caretPos, setCaretPos, resetCaretInitialized, setPendingFocus, caretOffsetFromPoint } =
    useFocusController({
      tasks,
      editingId,
      setActiveTaskId,
      setEditingId,
      setEditingText,
      rowRefs,
      editInputRef,
    });
  const { isRestoringUI } = useUIStatePersistence({
    tasks,
    activeTaskId,
    editingId,
    caretPos,
    setActiveTaskId,
    setEditingId,
    setEditingText,
    setCaretPos,
    resetCaretInitialized,
  });
  const { handlePointerDown } = useDragController<Task, UndoAction>({
    tasks,
    setAllTasks,
    setUndoStack,
    setDragIndex,
    rowRefs,
    INDENT_WIDTH,
    MAX_INDENT,
    searchQuery,
    deriveViewState,
  });

  const createId = () =>
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const computeTags = (text: string) => parseTaskMeta(text).tags;
  const searchOverlayInnerRef = useRef<HTMLDivElement | null>(null);

  const isEditingNewRow = editingId === NEW_TASK_ROW_ID;

  const MAX_RECENT_VIEWS = 8;
  // Recent views are ephemeral shortcuts, not saved state.
  // Recent views are capped internally but rendered freely by layout.
  const commitRecentView = (q: string) => {
    const next = canonicalizeViewQuery(q);
    if (next.length === 0) return;

    setRecentViews(prev => {
      const nextKey = next.toLowerCase();
      const prevFirstKey = (prev[0] ?? '').toLowerCase();
      if (nextKey === prevFirstKey) return prev; // don't add same view twice in a row

      const deduped = prev.filter(v => v.toLowerCase() !== nextKey);
      return [next, ...deduped].slice(0, MAX_RECENT_VIEWS);
    });
  };

  const parseTaskInput = (
    raw: string
  ): { text: string; tags: string[]; intent?: Task['intent']; momentum?: boolean } => {
    // Parse inline tokens on commit only (create/edit).
    // Tags are derived from text via parseTaskMeta.
    // Intent tokens (!now/!soon/!later) are stripped from visible text.
    let intent: Task['intent'] | undefined = undefined;
    let momentum = false;

    const withoutIntent = raw.replace(
      /(^|\s)!(now|soon|later)(?=\s|$)/gi,
      (_m, leading, which) => {
        intent = String(which).toLowerCase() as Task['intent'];
        return leading || ' ';
      }
    );

    // Momentum accelerator token: `!m`
    const withoutMomentum = withoutIntent.replace(
      /(^|\s)!m(?=\s|$)/gi,
      (m, leading) => {
        momentum = true;
        return leading || ' ';
      }
    );

    // Extract and remove #tags on commit.
    // Canonical model: task.text contains human-readable text ONLY; task.tags[] is the source of truth.
    const extractedTags: string[] = [];
    const withoutTags = withoutMomentum.replace(
      /(^|\s)#([a-zA-Z0-9_-]+)(?=\s|$)/g,
      (_m, leading, tag) => {
        const normalized = String(tag).toLowerCase();
        if (normalized) extractedTags.push(normalized);
        return leading || ' ';
      }
    );

    const text = withoutTags.replace(/\s+/g, ' ').trim();
    const tags = Array.from(new Set(extractedTags));
    return { text, tags, ...(intent ? { intent } : {}), ...(momentum ? { momentum } : {}) };
  };

  // Centralized commit logic: deterministic + idempotent.
  // Tags are ALWAYS derived from committed text.
  const commitTaskText = (
    taskId: string,
    rawText: string,
    opts?: { defaultIntent?: Task['intent']; preserveExistingIntent?: boolean }
  ) => {
    const parsed = parseTaskInput(rawText);
    const nextText = parsed.text;
    const nextTags = parsed.tags;

    setAllTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? {
              ...t,
              text: nextText,
              // Canonical tags: tags live in task.tags[] only (not in text).
              // When editing, the text usually contains no #tags; never wipe tags on blur.
              // If user types new #tags, merge them into existing tags.
              tags:
                nextTags.length > 0
                  ? Array.from(new Set([...(t.tags ?? []), ...nextTags.map(x => x.toLowerCase())]))
                  : (t.tags ?? []),
              ...(() => {
                const nextIntent =
                  parsed.intent ??
                  opts?.defaultIntent ??
                  (opts?.preserveExistingIntent ? t.intent : undefined);
                return nextIntent ? { intent: nextIntent } : { intent: undefined };
              })(),
              // Shorthand accelerator: typing `!m` turns Momentum on.
              // It does NOT auto-turn Momentum off if you later remove `!m` from the text.
              ...(parsed.momentum ? { momentum: true } : {}),
              meta: {
                tags:
                  nextTags.length > 0
                    ? Array.from(new Set([...(t.tags ?? []), ...nextTags.map(x => x.toLowerCase())]))
                    : (t.tags ?? []),
              },
            }
          : t
      )
    );
  };

  const editingController = createEditingController({
    tasks,
    editingId,
    editingText,
    NEW_TASK_ROW_ID,
    setAllTasks,
    setUndoStack,
    setActiveTaskId,
    setEditingId,
    setEditingText,
    setCaretPos,
    resetCaretInitialized,
    editingOriginalRef,
    createId,
    parseTaskInput,
    commitTaskText,
  });

  const {
    commitCompletedInlineTags,
    commitNewTaskFromRow,
    cancelNewRowEdit,
    startEditing,
    commitActiveEditIfAny,
    saveEdit,
    splitTaskAt,
  } = editingController;

  const cycleIntent = (current: Task['intent'] | undefined): Task['intent'] | undefined => {
    if (!current) return 'now';
    if (current === 'now') return 'soon';
    if (current === 'soon') return 'later';
    return undefined;
  };

// Tag clicks compose only with other tags.
// Text searches are exploratory and replaced by tag views.
const handleTagSearchClick = (rawTag: string) => {
  const clicked = `#${rawTag.trim().toLowerCase()}`;
  if (clicked === '#') return;

  // If currently editing, commit the edit before switching search context
  if (editingId) {
    const current = tasks.find(t => t.id === editingId) ?? null;
    if (current) {
      const originalSnapshot = structuredClone(current);

      setUndoStack(stack => [
        ...stack,
        { type: 'edit', task: originalSnapshot },
      ]);

      commitTaskText(current.id, editingText, {
        preserveExistingIntent: true,
      });

      setEditingId(null);
    }
  }

  setSearchQuery(prev => {
    const current = prev.trim().toLowerCase();
    if (current.length === 0) return clicked;


    const tokens = tokenizeQuery(current);
    const isTagOnly = tokens.every(t => t.startsWith('#') && t.length > 1);

    // If any non-tag token exists, replace with just the clicked tag.
    if (!isTagOnly) return clicked;

    // Tag-only query: compose with AND (space-separated), no duplicates.
    if (tokens.includes(clicked)) return prev;
    return [...tokens, clicked].join(' ');
  });
};

  /* =======================
     Lifecycle
  ======================= */

  useEffect(() => {
    if (isRestoringUI) return;
    // Default focus target is the capture row at the top.
    // This allows immediate typing without hunting for a special input.
    requestAnimationFrame(() => {
      newRowRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    // The persistent capture row is always present.
    // Keep it as the default active row unless the user activates a specific task.
    if (activeTaskId !== NEW_TASK_ROW_ID && !tasks.some(t => t.id === activeTaskId)) {
      setActiveTaskId(NEW_TASK_ROW_ID);
    }
  }, [tasks, activeTaskId]);

  // UI state persistence + restoration moved to lib/uiState.ts

  // UI state persistence + restoration moved to lib/uiState.ts

  useKeyboardController({
    tasks,
    activeTaskId,
    editingId,
    undoStack,
    NEW_TASK_ROW_ID,
    setAllTasks,
    setUndoStack,
    setActiveTaskId,
    startEditing,
    listRef,
    rowRefs,
    nextIndexFromListArrow,
    getUndoPendingFocus,
    setPendingFocus,
    applyUndo,
    searchQuery,
    setSearchQuery,
    searchInputRef,
  });

  const toggleCompleted = (task: Task) => {
    // Push undo snapshot BEFORE mutation
    setUndoStack(stack => [
      ...stack,
      { type: 'toggle', task },
    ]);
  
    setAllTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? {
              ...t,
              completed: !t.completed,
              ...(t.completed
                ? { completedAt: undefined }
                : { completedAt: Date.now() }),
            }
          : t
      )
    );
  };
  

  const deleteTask = (task: Task) => {
    setAllTasks(prev => {
      const index = prev.findIndex(t => t.id === task.id);
      if (index < 0) return prev;
  
      // Push undo BEFORE mutation
      setUndoStack(stack => [
        ...stack,
        { type: 'delete', task, index },
      ]);
  
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };
  

  const toggleMomentum = (task: Task) => {
    setUndoStack(stack => pushUndo(stack, { type: 'edit', task }));    setAllTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, momentum: t.momentum === true ? false : true }
          : t
      )
    );
  };

  const removeTagFromTask = (task: Task, tag: string) => {
    // 🔒 SNAPSHOT THE TASK BEFORE MUTATION
    const taskSnapshot: Task = structuredClone(task);

    // Push undo snapshot (one action per tag removal)
    setUndoStack(stack => [
      ...stack,
      { type: 'edit', task: taskSnapshot },
    ]);
    
    setAllTasks(prev => removeTagFromTasks(prev, task.id, tag));
    
  
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
    task: Task
  ) => {
    const el = e.currentTarget;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;
    const hasSelection = selStart !== selEnd;

    // Backspace merge
    if (!hasSelection && e.key === 'Backspace' && selStart === 0) {
      e.preventDefault();
      if (index === 0) return;

      const prev = tasks[index - 1];
      const mergedRaw = prev.text + editingText;
      const parsed = parseTaskInput(mergedRaw);
      const merged = parsed.text;
      // Tags are canonical: merging rows merges tag sets (union), never derived from text.
      const mergedTags = Array.from(
        new Set([...(prev.tags ?? []), ...(task.tags ?? []), ...parsed.tags])
      );
      const mergedIntent = parsed.intent ?? prev.intent;

      setUndoStack(stack => [
        ...stack,
        {
          type: 'merge',
          direction: 'backward',
          keptOriginal: structuredClone(prev),
          removed: structuredClone(task),
          caret: 0,
        },
      ]);
      

      setAllTasks(prevTasks => {
        const next = [...prevTasks];
        next[index - 1] = {
          ...prev,
          text: merged,
          tags: mergedTags,
          ...(mergedIntent ? { intent: mergedIntent } : { intent: undefined }),
          momentum:
            prev.momentum === true || task.momentum === true || parsed.momentum === true,
          meta: { tags: mergedTags },
        };
        next.splice(index, 1);
        return next;
      });

      setEditingId(prev.id);
      setEditingText(merged);
      setCaretPos(prev.text.length);
      resetCaretInitialized();
      return;
    }

    // Arrow navigation while editing:
    // - ArrowUp at start jumps to previous item (edit at end)
    // - ArrowDown at end jumps to next item (edit at end)
    if (!hasSelection && e.key === 'ArrowUp' && selStart === 0) {
      e.preventDefault();
      if (index === 0) return;

      // Commit this row text before switching
      if (editingText !== task.text) {
        setUndoStack(stack => pushUndo(stack, { type: 'edit', task }));        commitTaskText(task.id, editingText, { preserveExistingIntent: true });
      }

      const prevTask = tasks[index - 1];
      setActiveTaskId(prevTask.id);
      setEditingId(prevTask.id);
      setEditingText(prevTask.text);
      setCaretPos(prevTask.text.length);
      resetCaretInitialized();
      return;
    }

    if (
      !hasSelection &&
      e.key === 'ArrowDown' &&
      selEnd === editingText.length
    ) {
      e.preventDefault();
      if (index >= tasks.length - 1) return;

      if (editingText !== task.text) {
        setUndoStack(stack => pushUndo(stack, { type: 'edit', task }));        commitTaskText(task.id, editingText, { preserveExistingIntent: true });
      }

      const nextTask = tasks[index + 1];
      setActiveTaskId(nextTask.id);
      setEditingId(nextTask.id);
      setEditingText(nextTask.text);
      setCaretPos(nextTask.text.length);
      resetCaretInitialized();
      return;
    }

    // Delete merge: at end of row, pull next row's text up (undoable)
    if (!hasSelection && e.key === 'Delete' && selEnd === editingText.length) {
      e.preventDefault();
      if (index >= tasks.length - 1) return;

      const nextTask = tasks[index + 1];
      const mergedRaw = editingText + nextTask.text;
      const parsed = parseTaskInput(mergedRaw);
      const merged = parsed.text;
      const mergedTags = Array.from(
        new Set([...(task.tags ?? []), ...(nextTask.tags ?? []), ...parsed.tags])
      );
      const mergedIntent = parsed.intent ?? task.intent;

      setUndoStack(stack => [
        ...stack,
        {
          type: 'merge',
          direction: 'forward',
          keptOriginal: structuredClone(task),
          removed: structuredClone(nextTask),
          caret: editingText.length,
        },
      ]);
      

      setAllTasks(prevTasks => {
        const next = [...prevTasks];
        next[index] = {
          ...task,
          text: merged,
          tags: mergedTags,
          ...(mergedIntent ? { intent: mergedIntent } : { intent: undefined }),
          momentum:
            task.momentum === true || nextTask.momentum === true || parsed.momentum === true,
          meta: { tags: mergedTags },
        };
        next.splice(index + 1, 1);
        return next;
      });

      setEditingText(merged);
      setCaretPos(editingText.length);
      return;
    }

    // Split row
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      const cursor = el.selectionStart ?? editingText.length;
      splitTaskAt(task, index, cursor);
      return;
    }

    if (e.key === 'Tab') {
      // Do not indent while actively typing a tag
      if (shouldIgnoreTab(normalizedQuery.length)) {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      // Snapshot BEFORE mutation for undo
      const snapshot: Task = structuredClone(task);

      setUndoStack(stack => [
        ...stack,
        {
          type: 'indent',
          task: snapshot,
        },
      ]);

      setAllTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                indent: nextIndentFromTab({
                  currentIndent: t.indent,
                  shiftKey: e.shiftKey,
                  maxIndent: MAX_INDENT,
                }),
              }
            : t
        )
      );

      return;
    }

    if (e.key === 'Escape') {
      saveEdit(task);
    }
  };

  const handleRowKeyDownCapture = (
    e: React.KeyboardEvent,
    index: number,
    task: Task
  ) => {
    const target = e.target as HTMLElement | null;
    const isEditingThisRow = editingId === task.id;

    // Don't interfere with text editing or caret navigation inside the editor.
    if (isEditingThisRow && target?.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();

      if (tasks.length === 0) return;

      const nextIndex = nextIndexFromRowArrow({
        key: e.key as 'ArrowUp' | 'ArrowDown',
        index,
        tasksLength: tasks.length,
      });

      const nextTask = tasks[nextIndex];
      if (!nextTask) return;

      setActiveTaskId(nextTask.id);
      startEditing(nextTask, nextTask.text.length);
      return;
    }

    // Tab / Shift+Tab indents/outdents the selected row anywhere within it.
    if (e.key === 'Tab') {
      if (shouldIgnoreTab(normalizedQuery.length)) {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      if (activeTaskId !== task.id) {
        setActiveTaskId(task.id);
      }

      // Snapshot BEFORE mutation for undo
      const snapshot: Task = structuredClone(task);

      setUndoStack(stack => [
        ...stack,
        {
          type: 'indent',
          task: snapshot,
        },
      ]);

      setAllTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                indent: nextIndentFromTab({
                  currentIndent: t.indent,
                  shiftKey: e.shiftKey,
                  maxIndent: MAX_INDENT,
                }),
              }
            : t
        )
      );

      return;
    }

    // Make the "selected" row feel actionable: Enter or typing starts editing
    // (but don't hijack controls like checkbox/delete button).
    if (target?.closest('input[type="checkbox"],button')) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      setActiveTaskId(task.id);
      startEditing(task, task.text.length);
      return;
    }

    if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      setActiveTaskId(task.id);
      setEditingId(task.id);
      setEditingText(task.text + e.key);
      setCaretPos(task.text.length + 1);
      resetCaretInitialized();
    }
  };

  /* =======================
     Render
  ======================= */

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchViewState = deriveViewState(searchQuery);
  const isMomentumView = isMomentumViewActive;
  const activeTagTokens = deriveActiveTagTokens(searchViewState);
  const isTagView = isTagViewFn(searchViewState);

  const removeTagTokenFromSearch = (tagToken: string) => {
    setSearchQuery(prev => {
      const tokens = tokenizeQuery(prev);
      const next = tokens.filter(t => t !== tagToken);
      return next.length > 0 ? next.join(' ') : '';
    });
  };

  const activeFilterTokens = (() => {
    if (!searchViewState) return [] as Array<{ display: string; key: string }>;
    const raw = canonicalizeViewQuery(searchQuery);
    if (raw.length === 0) return [];
    return raw
      .split(/\s+/)
      .filter(Boolean)
      .map(t => ({ display: t, key: t.toLowerCase() }));
  })();

  const removeFilterTokenFromSearch = (tokenKey: string) => {
    setSearchQuery(prev => {
      const raw = canonicalizeViewQuery(prev);
      if (raw.length === 0) return '';
      const tokens = raw.split(/\s+/).filter(Boolean);
      const idx = tokens.findIndex(t => t.toLowerCase() === tokenKey);
      if (idx < 0) return prev;
      const next = [...tokens.slice(0, idx), ...tokens.slice(idx + 1)];
      return next.join(' ');
    });
  };

  const renderTagTokenizedQuery = (query: string) => {
    const TAG_TOKEN_REGEX = /#[a-zA-Z0-9_-]+/g;
    const parts: React.ReactNode[] = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_TOKEN_REGEX.exec(query))) {
      const start = match.index;
      const token = match[0] ?? '';
      const end = start + token.length;

      if (start > lastIndex) {
        parts.push(query.slice(lastIndex, start));
      }

      // The search input is the source of truth.
      // Tag tokenization here is visual-only; text editing remains native.
      parts.push(
        <span
          key={`${start}-${end}`}
          className="bg-muted/40 outline outline-1 outline-border/60 rounded-sm"
        >
          {token}
        </span>
      );

      lastIndex = end;
    }

    if (lastIndex < query.length) {
      parts.push(query.slice(lastIndex));
    }

    return parts;
  };

  const visibleTaskEntries = applyView(tasks, searchViewState, isMomentumViewActive);
  const visibleTasks = visibleTaskEntries.map(e => e.task);
  const momentumCount = isMomentumView
    ? visibleTasks.length
    : tasks.filter(t => !t.completed && t.momentum === true).length;

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-3xl mx-auto">
        {/* 🔍 Search input */}
        <div className="relative mt-4">
          {isTagView && (
            <div
              aria-hidden
              className="absolute inset-0 z-0 px-5 py-3 pr-12 text-base text-foreground pointer-events-none whitespace-pre overflow-hidden"
            >
              <div
                ref={searchOverlayInnerRef}
                className="whitespace-pre"
              >
                {renderTagTokenizedQuery(searchQuery)}
              </div>
            </div>
          )}
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
            }}
            onBlur={() => commitRecentView(searchQuery)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onKeyDown={e => {
              // Backspace removes the last active tag when search is empty.
              if (
                e.key === 'Backspace' &&
                isTagView &&
                activeTagTokens.length > 0 &&
                e.currentTarget.selectionStart === e.currentTarget.selectionEnd &&
                e.currentTarget.selectionStart === e.currentTarget.value.length
              ) {
                e.preventDefault();
                setSearchQuery(prev => {
                  const tokens = tokenizeQuery(prev);
                  const isTagOnly = tokens.every(t => t.startsWith('#') && t.length > 1);
                  if (!isTagOnly || tokens.length === 0) return prev;
                  tokens.pop();
                  return tokens.length > 0 ? tokens.join(' ') : '';
                });
                return;
              }

              if (e.key === 'Enter') {
                commitRecentView(searchQuery);
              }

              if (e.key === 'Escape') {
                e.preventDefault();
                setSearchQuery('');
                searchInputRef.current?.focus();
              }
            }}
            onScroll={e => {
              const el = searchOverlayInnerRef.current;
              if (!el) return;
              el.style.transform = `translateX(-${e.currentTarget.scrollLeft}px)`;
            }}
            placeholder="Search tasks or #tags"
            className="w-full bg-card border border-border rounded-lg px-5 py-3 pr-12 text-base
                       text-foreground placeholder:text-muted-foreground
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={
              isTagView
                ? {
                    color: 'transparent',
                    caretColor: 'hsl(var(--foreground))',
                  }
                : undefined
            }
          />

          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                commitActiveEditIfAny();
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2
                         inline-flex h-9 w-9 items-center justify-center rounded-full
                         border-[3px] border-muted-foreground/70 bg-muted/40 shadow-sm
                         text-muted-foreground transition-colors
                         hover:text-foreground hover:bg-foreground/10 hover:border-muted-foreground/85
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-xl leading-none font-semibold" aria-hidden>
                ×
              </span>
            </button>
          )}
        </div>

        {/* Active filters represent current state.
            Recent views are navigational history and must remain visually distinct. */}
        {searchViewState !== null && activeFilterTokens.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {activeFilterTokens.map(t => (
              <div
                key={`${t.key}-${t.display}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full',
                  'border border-border bg-card/30',
                  'px-2 py-1 text-xs text-muted-foreground'
                )}
              >
                <span className={t.display.startsWith('#') ? 'font-mono' : undefined}>
                  {t.display}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${t.display}`}
                  className={cn(
                    'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full',
                    'text-muted-foreground/80 hover:text-foreground',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                  onClick={() => removeFilterTokenFromSearch(t.key)}
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
            ))}
          </div>
        )}

{/* First-class derived view */}
<div className="mt-4">
  <div className="text-[10px] tracking-wider text-muted-foreground/70">
    Views
  </div>

  <div className="mt-2 flex flex-wrap gap-2">
    <div
      className={cn(
        'h-8 max-w-full',
        'inline-flex items-center rounded-full',
        'border transition-colors',
        isMomentumView
          ? 'border-border bg-card/40 text-foreground'
          : 'border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/30'
      )}
    >
      <button
        type="button"
        className={cn(
          'h-full max-w-full px-3',
          'inline-flex items-center gap-2',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full'
        )}
        onMouseDown={e => {
          commitActiveEditIfAny();
          e.preventDefault();
        }}
        onClick={() => {
          setIsMomentumViewActive(prev => !prev);
        }}
      >
        {/* Momentum state dot */}
                <span
          aria-hidden
          className="block rounded-full h-2 w-2 bg-primary/70"
        />


        <span className="truncate">
          Momentum{isMomentumView ? ` (${momentumCount})` : ''}
        </span>
      </button>

      {isMomentumView && (
        <button
          type="button"
          aria-label="Exit momentum view"
          className={cn(
            'mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full',
            'text-muted-foreground/70 hover:text-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            setIsMomentumViewActive(false);
          }}
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </div>
  </div>
</div>

        {/* Recent views visibility is based on history existence, not input focus. */}
        {recentViews.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] tracking-wider text-muted-foreground/70">
              Recent
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentViews.map(q => (
                <div
                  key={q}
                  className={cn(
                    'h-8 max-w-full',
                    'inline-flex items-center rounded-full',
                    'border border-border/70 bg-muted/20',
                    'text-xs text-muted-foreground'
                  )}
                  title={q}
                >
                  <button
                    type="button"
                    className={cn(
                      'h-full max-w-full px-3',
                      'inline-flex items-center',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full'
                    )}
                    onMouseDown={e => {
                      // keep focus behavior predictable on mobile/desktop
                      commitActiveEditIfAny();
                      e.preventDefault();
                    }}
                    onClick={() => {
                      const next = canonicalizeViewQuery(q);
                      setSearchQuery(next);
                      commitRecentView(next);
                      searchInputRef.current?.focus();
                    }}
                  >
                    <span className="truncate">{q}</span>
                  </button>

                  <button
                    type="button"
                    aria-label={`Remove recent view ${q}`}
                    className={cn(
                      'mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full',
                      'text-muted-foreground/70 hover:text-foreground',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                    onMouseDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRecentViews(prev => prev.filter(v => v !== q));
                    }}
                  >
                    <span aria-hidden>×</span>
                  </button>
                </div>
              ))}

              <button
                type="button"
                className={cn(
                  'h-8 px-2',
                  'inline-flex items-center',
                  'text-xs text-muted-foreground/80 hover:text-foreground',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded'
                )}
                onMouseDown={e => e.preventDefault()}
                onClick={() => setRecentViews([])}
              >
                Clear recent
              </button>
            </div>
          </div>
        )}

        {/* Optional indicator */}
        {/* Tag views and text views share mechanics but have distinct visual identity. */}
        {(isMomentumViewActive || searchViewState !== null) && (
          <div className="mt-2 text-[10px] tracking-wider text-muted-foreground/70">
            {isMomentumView ? 'Momentum' : isTagView ? 'Viewing tag' : 'Viewing results'}
          </div>
        )}
        {isMomentumView && (
          <div className="mt-1 text-sm text-muted-foreground">
            Items you’ve chosen to keep moving forward next.
          </div>
        )}
        {normalizedQuery.length > 0 && (
          <div className="mt-1 text-sm text-muted-foreground">
            Showing {visibleTasks.length} of {tasks.length} tasks
          </div>
        )}

        {/* Task list container provides visual structure without adding noise. */}
        {/* List container: very light “sheet” (content-first, minimal chrome) */}
        <div className="mt-6 rounded-lg border border-border/10 bg-transparent px-1 py-1">
          {/* Active view indicator: real left border for reliable visibility.
              Views are ephemeral and exited by clearing search. */}
          <div
            className={cn(
              'space-y-1 relative',
              isMomentumViewActive || searchViewState !== null
                ? isTagView
                  ? 'border-l-[6px] border-primary/80 pl-5'
                  : 'border-l-[6px] border-accent pl-5'
                : ''
            )}
            role="list"
            ref={listRef}
          >
          {/* Persistent empty capture row (top-anchored) */}
          <TaskRow
            task={{
              id: NEW_TASK_ROW_ID,
              text: '',
              createdAt: 0,
              order: 0,
              completed: false,
              archived: false,
              indent: 0,
              tags: [],
              momentum: false,
              meta: { tags: [] },
            }}
            index={-1}
            isEntryRow
            containerClassName="mt-2"
            isActive={activeTaskId === NEW_TASK_ROW_ID}
            dragIndex={dragIndex}
            effectiveIndent={0}
            indentWidth={INDENT_WIDTH}
            activeTags={undefined}
            onTagClick={undefined}
            onRemoveTag={undefined}
            onToggleMomentum={undefined}
            rowRef={(el: HTMLDivElement | null) => {
              newRowRef.current = el;
            }}
            onFocusRow={() => setActiveTaskId(NEW_TASK_ROW_ID)}
            onMouseDownRow={(e: React.MouseEvent<HTMLDivElement>) => {
              const t = e.target as HTMLElement | null;
              if (t?.closest('[data-no-edit],input,textarea,button')) return;

              // Commit any in-progress edit before entering capture mode.
              commitActiveEditIfAny();
              setActiveTaskId(NEW_TASK_ROW_ID);

              if (editingId !== NEW_TASK_ROW_ID) {
                setEditingId(NEW_TASK_ROW_ID);
                setEditingText('');
                setCaretPos(0);
                resetCaretInitialized();
              }
            }}
            onKeyDownCapture={(e: React.KeyboardEvent<HTMLDivElement>) => {
              const target = e.target as HTMLElement | null;
              if (editingId === NEW_TASK_ROW_ID && target?.tagName === 'TEXTAREA') return;

              // ArrowDown from the capture row jumps into the first task (if any).
              if (e.key === 'ArrowDown' && tasks.length > 0) {
                e.preventDefault();
                const first = tasks[0];
                setActiveTaskId(first.id);
                startEditing(first, first.text.length);
                return;
              }

              // Escape on empty row does nothing.
              if (e.key === 'Escape') {
                e.preventDefault();
                return;
              }

              // Typing starts editing immediately.
              if (
                e.key.length === 1 &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey
              ) {
                e.preventDefault();
                setActiveTaskId(NEW_TASK_ROW_ID);
                setEditingId(NEW_TASK_ROW_ID);
                setEditingText(e.key);
                setCaretPos(1);
                resetCaretInitialized();
                return;
              }
            }}
            onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
              // Capture row is not draggable.
              e.preventDefault();
            }}
            onToggleCompleted={() => {
              // Capture row cannot be completed.
            }}
            onDelete={() => {
              // Capture row cannot be deleted.
            }}
            isEditing={editingId === NEW_TASK_ROW_ID}
            editingText={editingId === NEW_TASK_ROW_ID ? editingText : ''}
            editInputRef={editingId === NEW_TASK_ROW_ID ? editInputRef : undefined}
            onChangeEditingText={(value: string) => {
              setEditingText(value);
              const caret = editInputRef.current?.selectionStart ?? null;
              if (typeof caret === 'number') {
                setCaretPos(caret);
              }
            }}
            onTextareaKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitNewTaskFromRow();
              }
              // Escape does nothing on empty row.
              if (e.key === 'Escape') {
                e.preventDefault();
              }
            }}
            onTextareaBlur={() => {
              // On blur: commit if there is content (text or tags), otherwise leave it empty.
              const parsed = parseTaskInput(editingText);
              if (parsed.text.length > 0 || parsed.tags.length > 0) {
                commitNewTaskFromRow();
              } else {
                cancelNewRowEdit();
              }
            }}
            onTextClick={() => {
              commitActiveEditIfAny();
              setActiveTaskId(NEW_TASK_ROW_ID);
              setEditingId(NEW_TASK_ROW_ID);
              setEditingText('');
              setCaretPos(0);
              resetCaretInitialized();
            }}
            searchQuery={normalizedQuery}
          />

          {visibleTaskEntries.map(({ task, index }, visibleIndex) => {
            const isActive = activeTaskId === task.id;

            // When a view is active, hierarchy is flattened for clarity.
            // Views are lenses, not structure.
            const effectiveIndent =
              isMomentumViewActive || searchViewState !== null ? 0 : task.indent;

            return (
              <TaskRow
                key={task.id}
                task={task}
                index={index}
                isActive={isActive}
                dragIndex={dragIndex}
                effectiveIndent={effectiveIndent}
                indentWidth={INDENT_WIDTH}
                activeTags={isTagView ? activeTagTokens.map(t => t.slice(1)) : undefined}
                onTagClick={handleTagSearchClick}
                onRemoveTag={(tag: string) => removeTagFromTask(task, tag)}
                onToggleMomentum={() => toggleMomentum(task)}
                rowRef={(el: HTMLDivElement | null) => (rowRefs.current[index] = el)}
                onFocusRow={() => setActiveTaskId(task.id)}
                onMouseDownRow={(e: React.MouseEvent<HTMLDivElement>) => {
                  const t = e.target as HTMLElement | null;
                  if (t?.closest('[data-no-edit],input,textarea,button')) return;
                  setActiveTaskId(task.id);
                  if (editingId !== task.id) startEditing(task, task.text.length);
                }}
                onKeyDownCapture={(e: React.KeyboardEvent<HTMLDivElement>) =>
                  handleRowKeyDownCapture(e, index, task)}
                onPointerDown={(e: React.PointerEvent<HTMLDivElement>) =>
                  handlePointerDown(index, e)}
                onToggleCompleted={() => toggleCompleted(task)}
                onDelete={() => deleteTask(task)}
                isEditing={editingId === task.id}
                editingText={editingId === task.id ? editingText : task.text}
                editInputRef={editingId === task.id ? editInputRef : undefined}
                onChangeEditingText={(value: string) => {
                  // First mutation in an edit session establishes an undo snapshot.
                  if (
                    !editingOriginalRef.current ||
                    editingOriginalRef.current.taskId !== task.id
                  ) {
                    editingOriginalRef.current = { taskId: task.id, snapshot: task };
                    setUndoStack(stack => pushUndo(stack, { type: 'edit', task }));                  }

                  // Tag commit is canonical and must never delete tags.
                  // To avoid re-parsing tags on every keystroke, only scan/commit when the user
                  // inserts whitespace (space/tab/newline) or on explicit commit (blur/save).
                  const el = editInputRef.current;
                  const caret = el?.selectionStart ?? null;

                  const prevValue = editingText;
                  const delta = value.length - prevValue.length;
                  const shouldScan =
                    delta > 0 &&
                    typeof caret === 'number' &&
                    (() => {
                      const start = Math.max(0, caret - delta);
                      const inserted = value.slice(start, caret);
                      return /\s/.test(inserted);
                    })();

                  if (shouldScan && value.includes('#')) {
                    const res = commitCompletedInlineTags(task.id, value, caret);
                    setEditingText(res.nextValue);
                    if (typeof res.nextCaret === 'number') {
                      setCaretPos(res.nextCaret);
                      resetCaretInitialized();
                    }
                    return;
                  }

                  setEditingText(value);
                  if (typeof caret === 'number') setCaretPos(caret);
                }}
                onTextareaKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) =>
                  handleTextareaKeyDown(e, index, task)}
                onTextareaBlur={() => saveEdit(task)}
                onTextClick={(e: React.MouseEvent<HTMLDivElement>) => {
                  const el = e.currentTarget;
                  const caret = caretOffsetFromPoint(el, e.clientX, e.clientY);
                  setActiveTaskId(task.id);
                  startEditing(
                    task,
                    Math.min(task.text.length, caret ?? task.text.length)
                  );
                }}
                searchQuery={normalizedQuery}
              />
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}
