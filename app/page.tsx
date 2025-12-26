'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type React from 'react';
import TaskRow from '../components/TaskRow';
import usePersistentTasks from '../hooks/usePersistentTasks';
import { parseTaskMeta } from '../lib/parseTaskMeta';
import { cn } from '../lib/utils';

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
  archivedAt?: number;
  indent: number;
  tags: string[]; // lowercase, no '#', deduped
  intent?: 'now' | 'soon' | 'later';
  meta?: TaskMeta; // optional for backward compatibility
}

export interface TaskMeta {
  tags: string[];
}

export type TaskIntent = 'now' | 'soon' | 'later' | null;

type ViewState = { type: 'search'; query: string };

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
    }
  | null;

/* =======================
   Constants
======================= */

const MAX_INDENT = 2;
const INDENT_WIDTH = 28;
const UI_STATE_KEY = 'task_ui_state';

/* =======================
   Page
======================= */

export default function Home() {
  const [allTasks, setAllTasks] = usePersistentTasks();
  const tasks = allTasks.filter(t => !t.archived);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentViews, setRecentViews] = useState<string[]>([]);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [caretPos, setCaretPos] = useState<number | null>(null);
  const caretInitializedRef = useRef(false);

  const [undoAction, setUndoAction] = useState<UndoAction>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const dragIndexRef = useRef<number | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const baseIndentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pendingFocusRef = useRef<
    | { taskId: string; mode: 'row' | 'edit'; caret?: number }
    | null
  >(null);
  const uiRestoredRef = useRef(false);
  const restoringUIRef = useRef(false);
  const initialUIStateRef = useRef<
    | {
        activeTaskId?: string;
        editingTaskId?: string;
        caret?: number;
      }
    | null
  >(null);
  const editingOriginalRef = useRef<{ taskId: string; snapshot: Task } | null>(null);

  if (typeof window !== 'undefined' && initialUIStateRef.current === null) {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          initialUIStateRef.current = parsed;
          if (
            (parsed as { activeTaskId?: unknown }).activeTaskId ||
            (parsed as { editingTaskId?: unknown }).editingTaskId
          ) {
            restoringUIRef.current = true;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const createId = () =>
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const computeTags = (text: string) => parseTaskMeta(text).tags;
  const searchOverlayInnerRef = useRef<HTMLDivElement | null>(null);

  const MAX_RECENT_VIEWS = 8;
  // Recent views are ephemeral shortcuts, not saved state.
  // Recent views are capped internally but rendered freely by layout.
  const canonicalizeViewQuery = (q: string) => q.trim().replace(/\s+/g, ' ');
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

  const deriveViewState = (raw: string): ViewState | null => {
    const query = raw.trim().toLowerCase();
    if (query.length === 0) return null;
    return { type: 'search', query };
  };

  const tokenizeQuery = (query: string): string[] =>
    query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  const parseTaskInput = (
    raw: string
  ): { text: string; tags: string[]; intent?: Task['intent'] } => {
    // Parse inline tokens on commit only (create/edit).
    // Tags are derived from text via parseTaskMeta.
    // Intent tokens (!now/!soon/!later) are stripped from visible text.
    let intent: Task['intent'] | undefined = undefined;

    const withoutIntent = raw.replace(
      /(^|\s)!(now|soon|later)(?=\s|$)/gi,
      (_m, leading, which) => {
        intent = String(which).toLowerCase() as Task['intent'];
        return leading || ' ';
      }
    );

    const text = withoutIntent.replace(/\s+/g, ' ').trim();
    const tags = parseTaskMeta(text).tags;
    return { text, tags, ...(intent ? { intent } : {}) };
  };

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

  const filterTasksBySearch = (task: Task, query: string): boolean => {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) return true;

    const text = task.text.toLowerCase();
    const tags = task.tags ?? [];

    const tagTokens = tokens.filter(t => t.startsWith('#'));
    const textTokens = tokens.filter(t => !t.startsWith('#'));

    const textMatch = textTokens.every(t => text.includes(t));
    const tagMatch = tagTokens.every(t => {
      const needle = t.slice(1);
      if (needle.length === 0) return true;
      return tags.some(tag => tag.toLowerCase().includes(needle));
    });

    if (tagTokens.length > 0) {
      console.log('SEARCH CHECK', {
        query,
        taskText: task.text,
        taskTags: task.tags,
        textMatch,
        tagMatch,
      });
    }

    return textMatch && tagMatch;
  };

  const getCaretOffsetFromPoint = (
    container: HTMLElement,
    x: number,
    y: number
  ): number | null => {
    const doc = container.ownerDocument;
    const anyDoc = doc as unknown as {
      caretPositionFromPoint?: (x: number, y: number) => {
        offsetNode: Node;
        offset: number;
      } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let node: Node | null = null;
    let offset = 0;

    if (typeof anyDoc.caretPositionFromPoint === 'function') {
      const pos = anyDoc.caretPositionFromPoint(x, y);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    } else if (typeof anyDoc.caretRangeFromPoint === 'function') {
      const range = anyDoc.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }

    if (!node || !container.contains(node)) return null;

    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    let count = 0;

    while (current) {
      const text = current.textContent ?? '';
      if (current === node) return count + offset;
      count += text.length;
      current = walker.nextNode();
    }

    return null;
  };

  /* =======================
     Lifecycle
  ======================= */

  useEffect(() => {
    if (restoringUIRef.current) return;
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!editingId) return;
    if (caretInitializedRef.current) return;

    const el = editInputRef.current;
    if (!el) return;

    el.focus();

    const pos =
      typeof caretPos === 'number'
        ? caretPos
        : el.value.length;

    el.setSelectionRange(pos, pos);

    caretInitializedRef.current = true;
  }, [editingId, caretPos]);

  useEffect(() => {
    const el = editInputRef.current;
    if (!editingId || !el) return;

    const updateCaret = () => {
      const pos = el.selectionStart ?? null;
      if (pos === null || Number.isNaN(pos)) return;
      setCaretPos(pos);
    };

    el.addEventListener('select', updateCaret);
    el.addEventListener('keyup', updateCaret);
    el.addEventListener('mouseup', updateCaret);

    return () => {
      el.removeEventListener('select', updateCaret);
      el.removeEventListener('keyup', updateCaret);
      el.removeEventListener('mouseup', updateCaret);
    };
  }, [editingId]);

  useEffect(() => {
    if (tasks.length === 0) {
      if (activeTaskId !== null) setActiveTaskId(null);
      return;
    }

    if (activeTaskId === null || !tasks.some(t => t.id === activeTaskId)) {
      setActiveTaskId(tasks[0].id);
    }
  }, [tasks, activeTaskId]);

  useEffect(() => {
    if (uiRestoredRef.current) return;
    if (tasks.length === 0) return;

    uiRestoredRef.current = true;

    try {
      const raw =
        initialUIStateRef.current ?? JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? 'null');
      if (!raw) return;
      const parsed = raw;
      if (!parsed || typeof parsed !== 'object') return;

      const storedActive = (parsed as { activeTaskId?: unknown }).activeTaskId;
      const storedEditing = (parsed as { editingTaskId?: unknown }).editingTaskId;
      const storedCaret = (parsed as { caret?: unknown }).caret;

      const hasActive =
        typeof storedActive === 'string' && tasks.some(t => t.id === storedActive);
      const hasEditing =
        typeof storedEditing === 'string' &&
        tasks.some(t => t.id === storedEditing);

      if (hasActive) setActiveTaskId(storedActive as string);

      if (hasEditing) {
        const task = tasks.find(t => t.id === storedEditing) ?? null;
        if (task) {
          setEditingId(task.id);
          setEditingText(task.text);
          caretInitializedRef.current = false;
          if (typeof storedCaret === 'number' && Number.isFinite(storedCaret)) {
            setCaretPos(Math.max(0, Math.min(task.text.length, storedCaret)));
          }
        }
      }
    } catch {
      // Fail silently
    }

    restoringUIRef.current = false;
  }, [tasks]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;

    const nextIndex = tasks.findIndex(t => t.id === pending.taskId);
    if (nextIndex < 0) return;

    setActiveTaskId(pending.taskId);

    if (pending.mode === 'edit') {
      const nextTask = tasks[nextIndex];
      setEditingId(nextTask.id);
      setEditingText(nextTask.text);
      setCaretPos(pending.caret ?? nextTask.text.length);
      caretInitializedRef.current = false;
    }

    requestAnimationFrame(() => {
      if (pending.mode === 'row') {
        rowRefs.current[nextIndex]?.focus();
      }
      pendingFocusRef.current = null;
    });
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          activeTaskId,
          editingTaskId: editingId,
          caret: caretPos,
        })
      );
    } catch {
      // Ignore persistence errors for UI state
    }
  }, [activeTaskId, editingId, caretPos]);

  useEffect(() => {
    if (!searchQuery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchQuery('');
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [searchQuery]);

  /* =======================
     Undo
  ======================= */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Global keyboard navigation (only when focus is inside the list and not editing)
      if (!editingId && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const activeEl = document.activeElement as HTMLElement | null;
        const inList = !!(activeEl && listRef.current?.contains(activeEl));

        // Don't hijack arrows when not interacting with the list.
        if (inList && tasks.length > 0) {
          e.preventDefault();

          const currentIndex =
            activeTaskId === null ? 0 : tasks.findIndex(t => t.id === activeTaskId);
          const safeIndex = currentIndex >= 0 ? currentIndex : 0;
          const nextIndex =
            e.key === 'ArrowDown'
              ? Math.min(tasks.length - 1, safeIndex + 1)
              : Math.max(0, safeIndex - 1);

          const nextId = tasks[nextIndex]?.id;
          const nextTask = tasks[nextIndex];
          if (nextId && nextTask) {
            setActiveTaskId(nextId);

            // If the user is navigating from within the row (not from a control),
            // jump straight into edit mode for the next item.
            const fromControl =
              !!activeEl?.closest('input[type="checkbox"],button');

            if (!fromControl) {
              startEditing(nextTask, nextTask.text.length);
            } else {
              requestAnimationFrame(() => rowRefs.current[nextIndex]?.focus());
            }
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoAction) {
        e.preventDefault();

        // Prepare post-undo focus/selection behavior before mutating the list.
        if (undoAction.type === 'split') {
          pendingFocusRef.current = {
            taskId: undoAction.original.id,
            mode: 'edit',
            caret: undoAction.cursor,
          };
        } else if (undoAction.type === 'merge') {
          pendingFocusRef.current =
            undoAction.direction === 'backward'
              ? { taskId: undoAction.removed.id, mode: 'edit', caret: 0 }
              : {
                  taskId: undoAction.keptOriginal.id,
                  mode: 'edit',
                  caret: undoAction.caret,
                };
        } else if (undoAction.type === 'delete') {
          pendingFocusRef.current = { taskId: undoAction.task.id, mode: 'row' };
        } else if (
          undoAction.type === 'edit' ||
          undoAction.type === 'toggle' ||
          undoAction.type === 'indent'
        ) {
          pendingFocusRef.current = { taskId: undoAction.task.id, mode: 'row' };
        }

        setAllTasks(prev => {
          switch (undoAction.type) {
            case 'delete': {
              const next = [...prev];
              next.splice(undoAction.index, 0, undoAction.task);
              return next;
            }

            case 'edit':
            case 'toggle':
            case 'indent':
              return prev.map(t =>
                t.id === undoAction.task.id ? undoAction.task : t
              );

            case 'split': {
              const next = [...prev];
              const originalIndex = next.findIndex(t => t.id === undoAction.original.id);
              if (originalIndex >= 0) {
                next[originalIndex] = undoAction.original;
              }
              const createdIndex = next.findIndex(t => t.id === undoAction.createdId);
              if (createdIndex >= 0) {
                next.splice(createdIndex, 1);
              }
              return next;
            }

            case 'merge': {
              const next = [...prev];

              // Restore kept task to its pre-merge state
              const keptIndex = next.findIndex(t => t.id === undoAction.keptOriginal.id);
              if (keptIndex >= 0) {
                next[keptIndex] = undoAction.keptOriginal;
              }

              // Reinsert removed row immediately after kept row (if possible)
              if (keptIndex >= 0) {
                next.splice(keptIndex + 1, 0, undoAction.removed);
              } else {
                next.push(undoAction.removed);
              }

              return next;
            }

            default:
              return prev;
          }
        });

        setUndoAction(null);
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [undoAction, tasks, activeTaskId, editingId, setAllTasks]);

  /* =======================
     Task Actions
  ======================= */

  const addTask = () => {
    if (!input.trim()) return;

    const parsed = parseTaskInput(input.trim());
    const text = parsed.text;

    const now = Date.now();
    setAllTasks(prev => [
      {
        id: now.toString(),
        text,
        createdAt: now,
        order: now,
        completed: false,
        archived: false,
        indent: 0,
        tags: parsed.tags,
        ...(parsed.intent ? { intent: parsed.intent } : {}),
        meta: { tags: parsed.tags },
      },
      ...prev,
    ]);

    setInput('');
    inputRef.current?.focus();
  };

  const toggleTask = (task: Task) => {
    setUndoAction({ type: 'toggle', task });
    setAllTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? {
              ...t,
              completed: !t.completed,
              ...(t.completed ? { completedAt: undefined } : { completedAt: Date.now() }),
            }
          : t
      )
    );
  };

  const archiveTask = (task: Task) => {
    setUndoAction({ type: 'edit', task });
    setAllTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? {
              ...t,
              archived: true,
              archivedAt: Date.now(),
            }
          : t
      )
    );
  };

  const startEditing = (task: Task, caret: number) => {
    setEditingId(task.id);
    setEditingText(task.text);
    setCaretPos(caret ?? task.text.length ?? 0);
    caretInitializedRef.current = false;
  };

  const saveEdit = (task: Task) => {
    const hasTextChanged = editingText !== task.text;
  
    if (hasTextChanged) {
      const parsed = parseTaskInput(editingText);
      const nextText = parsed.text;
  
      setUndoAction({ type: 'edit', task });
  
      setAllTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                text: nextText,
                tags: parsed.tags,
                ...(parsed.intent ? { intent: parsed.intent } : { intent: undefined }),
                meta: { tags: parsed.tags },
              }
            : t
        )
      );
    }
  
    setEditingId(null);
    setEditingText('');
    setCaretPos(null);
  };

  const splitTaskAt = (task: Task, index: number, cursor: number) => {
    const createdId = createId();
    const createdAt = Date.now();

    const before = editingText.slice(0, cursor);
    const after = editingText.slice(cursor);

    // IMPORTANT: tags must always be derived from text.
    // Never copy tags between tasks.
    const leftParsed = parseTaskInput(before);
    const rightParsed = parseTaskInput(after);
    const originalParsed = parseTaskInput(editingText);

    const leftText = leftParsed.text;
    const rightText = rightParsed.text;
    const originalText = originalParsed.text;

    const leftMetaTags = leftParsed.tags;
    const rightMetaTags = rightParsed.tags;
    const originalMetaTags = originalParsed.tags;

    console.group('SPLIT DEBUG');
    console.log('Left text:', leftText);
    console.log('Left tags:', leftMetaTags);
    console.log('Right text:', rightText);
    console.log('Right tags:', rightMetaTags);
    console.groupEnd();

    // Undo should restore the original row and caret position, and remove the created row.
    setUndoAction({
      type: 'split',
      original: {
        ...task,
        text: originalText,
        tags: originalMetaTags,
        ...(originalParsed.intent ? { intent: originalParsed.intent } : { intent: undefined }),
        meta: { tags: originalMetaTags },
      },
      createdId,
      cursor,
    });

    setAllTasks(prev => {
      const next = [...prev];
      const currentIndex = next.findIndex(t => t.id === task.id);
      const safeIndex = currentIndex >= 0 ? currentIndex : index;

      const current = next[safeIndex];
      if (!current) return prev;

      next[safeIndex] = {
        ...current,
        text: leftText,
        tags: leftMetaTags,
        ...(leftParsed.intent ? { intent: leftParsed.intent } : { intent: undefined }),
        meta: { tags: leftMetaTags },
      };
      const newTask: Task = {
        id: createdId,
        text: rightText,
        createdAt,
        order: createdAt,
        completed: false,
        archived: false,
        indent: current.indent,
        tags: rightMetaTags,
        ...(rightParsed.intent ? { intent: rightParsed.intent } : {}),
        meta: { tags: rightMetaTags },
      };
      next.splice(safeIndex + 1, 0, newTask);

      console.log(
        'POST-SPLIT TASKS:',
        next.map(t => ({ id: t.id, text: t.text, tags: t.tags }))
      );

      return next;
    });

    setActiveTaskId(createdId);
    setEditingId(createdId);
    setEditingText(rightText);
    setCaretPos(0);
    caretInitializedRef.current = false;
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
      const mergedTags = parsed.tags;
      const mergedIntent = parsed.intent ?? prev.intent;

      setUndoAction({
        type: 'merge',
        direction: 'backward',
        keptOriginal: prev,
        removed: task,
        caret: 0,
      });

      setAllTasks(prevTasks => {
        const next = [...prevTasks];
        next[index - 1] = {
          ...prev,
          text: merged,
          tags: mergedTags,
          ...(mergedIntent ? { intent: mergedIntent } : { intent: undefined }),
          meta: { tags: mergedTags },
        };
        next.splice(index, 1);
        return next;
      });

      setEditingId(prev.id);
      setEditingText(merged);
      setCaretPos(prev.text.length);
      caretInitializedRef.current = false;
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
        setUndoAction({ type: 'edit', task });
        const parsed = parseTaskInput(editingText);
        const nextText = parsed.text;
        const nextTags = parsed.tags;
        const nextIntent = parsed.intent;
        setAllTasks(prev =>
          prev.map(t =>
            t.id === task.id
              ? {
                  ...t,
                  text: nextText,
                  tags: nextTags,
                  ...(nextIntent ? { intent: nextIntent } : { intent: undefined }),
                  meta: { tags: nextTags },
                }
              : t
          )
        );
      }

      const prevTask = tasks[index - 1];
      setActiveTaskId(prevTask.id);
      setEditingId(prevTask.id);
      setEditingText(prevTask.text);
      setCaretPos(prevTask.text.length);
      caretInitializedRef.current = false;
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
        setUndoAction({ type: 'edit', task });
        const parsed = parseTaskInput(editingText);
        const nextText = parsed.text;
        const nextTags = parsed.tags;
        const nextIntent = parsed.intent;
        setAllTasks(prev =>
          prev.map(t =>
            t.id === task.id
              ? {
                  ...t,
                  text: nextText,
                  tags: nextTags,
                  ...(nextIntent ? { intent: nextIntent } : { intent: undefined }),
                  meta: { tags: nextTags },
                }
              : t
          )
        );
      }

      const nextTask = tasks[index + 1];
      setActiveTaskId(nextTask.id);
      setEditingId(nextTask.id);
      setEditingText(nextTask.text);
      setCaretPos(nextTask.text.length);
      caretInitializedRef.current = false;
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
      const mergedTags = parsed.tags;
      const mergedIntent = parsed.intent ?? task.intent;

      setUndoAction({
        type: 'merge',
        direction: 'forward',
        keptOriginal: task,
        removed: nextTask,
        caret: editingText.length,
      });

      setAllTasks(prevTasks => {
        const next = [...prevTasks];
        next[index] = {
          ...task,
          text: merged,
          tags: mergedTags,
          ...(mergedIntent ? { intent: mergedIntent } : { intent: undefined }),
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
      if (normalizedQuery.length > 0) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      setUndoAction({ type: 'indent', task });
      setAllTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                indent: Math.max(
                  0,
                  Math.min(MAX_INDENT, t.indent + (e.shiftKey ? -1 : 1))
                ),
              }
            : t
        )
      );
    }

    if (e.key === 'Escape') saveEdit(task);
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

      const nextIndex =
        e.key === 'ArrowDown'
          ? Math.min(tasks.length - 1, index + 1)
          : Math.max(0, index - 1);

      const nextId = tasks[nextIndex]?.id;
      const nextTask = tasks[nextIndex];
      if (!nextId || !nextTask) return;

      setActiveTaskId(nextId);
      // Arrow navigation should land you ready to edit the next item.
      startEditing(nextTask, nextTask.text.length);

      return;
    }

    // Tab / Shift+Tab indents/outdents the selected row anywhere within it.
    // (When editing, the textarea has its own Tab handler.)
    if (e.key === 'Tab') {
      if (normalizedQuery.length > 0) {
        e.preventDefault();
        return;
      }
      e.preventDefault();

      if (activeTaskId !== task.id) setActiveTaskId(task.id);

      setUndoAction({ type: 'indent', task });
      setAllTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                indent: Math.max(
                  0,
                  Math.min(MAX_INDENT, t.indent + (e.shiftKey ? -1 : 1))
                ),
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
    }
  };

  /* =======================
     Drag (Reorder + Indent)
  ======================= */

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    // Search is a view (lens) over the underlying list; while a view is active,
    // disable drag/reorder to avoid surprising mutations.
    if (deriveViewState(searchQuery)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    setDragIndex(index);
    dragIndexRef.current = index;

    dragStartXRef.current = e.clientX;
    baseIndentRef.current = tasks[index].indent;

    setUndoAction({ type: 'indent', task: tasks[index] });

    const handlePointerMove = (ev: PointerEvent) => {
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const currentIndex = dragIndexRef.current;
        if (currentIndex === null) return;

        const x = ev.clientX;
        const y = ev.clientY;

        // Horizontal indent
        const deltaX = x - (dragStartXRef.current ?? x);
        const step = Math.trunc(deltaX / INDENT_WIDTH);

        if (step !== 0 && baseIndentRef.current !== null) {
          const targetIndent = Math.max(
            0,
            Math.min(MAX_INDENT, baseIndentRef.current + step)
          );

          setAllTasks(prev => {
            const next = [...prev];
            next[currentIndex] = { ...next[currentIndex], indent: targetIndent };
            return next;
          });

          dragStartXRef.current = x;
          baseIndentRef.current = targetIndent;
        }

        // Vertical reorder
        const move = (from: number, to: number) => {
          setAllTasks(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            dragIndexRef.current = to;
            setDragIndex(to);
            return next;
          });
        };

        const down = rowRefs.current[currentIndex + 1];
        if (down) {
          const r = down.getBoundingClientRect();
          if (y > r.top + r.height / 2) {
            move(currentIndex, currentIndex + 1);
            return;
          }
        }

        const up = rowRefs.current[currentIndex - 1];
        if (up) {
          const r = up.getBoundingClientRect();
          if (y < r.top + r.height / 2) {
            move(currentIndex, currentIndex - 1);
          }
        }
      });
    };

    const handlePointerUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragIndexRef.current = null;
      setDragIndex(null);
      dragStartXRef.current = null;
      baseIndentRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  /* =======================
     Render
  ======================= */

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const viewState = deriveViewState(searchQuery);
  const activeTagTokens = (() => {
    if (!viewState) return [] as string[];
    const tokens = tokenizeQuery(viewState.query);
    // Normalize + de-dupe while preserving token order.
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const t of tokens) {
      if (!t.startsWith('#') || t.length <= 1) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      tags.push(t);
    }
    return tags;
  })();

  const isTagView = (() => {
    if (!viewState) return false;
    const tokens = tokenizeQuery(viewState.query);
    if (tokens.length === 0) return false;
    return tokens.every(t => t.startsWith('#') && t.length > 1);
  })();

  const removeTagTokenFromSearch = (tagToken: string) => {
    setSearchQuery(prev => {
      const tokens = tokenizeQuery(prev);
      const next = tokens.filter(t => t !== tagToken);
      return next.length > 0 ? next.join(' ') : '';
    });
  };

  const activeFilterTokens = (() => {
    if (!viewState) return [] as Array<{ display: string; key: string }>;
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

  useEffect(() => {
    // Commit view to recents only after a short pause (avoid every keystroke).
    const q = canonicalizeViewQuery(searchQuery);
    if (q.length === 0) return;

    const t = window.setTimeout(() => commitRecentView(q), 800);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // Search acts as a temporary view (lens) over tasks.
  // Views never mutate tasks and are exited by clearing search.
  const applyView = (all: Task[], view: ViewState | null) => {
    if (!view) return all.map((task, index) => ({ task, index }));
    return all
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => filterTasksBySearch(task, view.query));
  };

  const visibleTaskEntries = applyView(tasks, viewState);
  const visibleTasks = visibleTaskEntries.map(e => e.task);

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-3xl mx-auto">
        {/* Primary capture input */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="What needs to be done?"
          className="w-full bg-card border border-border rounded-lg px-6 py-4 text-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

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
            onChange={e => setSearchQuery(e.target.value)}
            onBlur={() => commitRecentView(searchQuery)}
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
        {viewState !== null && activeFilterTokens.length > 0 && (
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
        {viewState !== null && (
          <div className="mt-2 text-[10px] tracking-wider text-muted-foreground/70">
            {isTagView ? 'Viewing tag' : 'Viewing results'}
          </div>
        )}
        {normalizedQuery.length > 0 && (
          <div className="mt-1 text-sm text-muted-foreground">
            Showing {visibleTasks.length} of {tasks.length} tasks
          </div>
        )}

        {/* Task list container provides visual structure without adding noise. */}
        <div className="mt-8 rounded-xl border border-border/50 bg-secondary dark:bg-card p-5 sm:p-6">
          {/* Active view indicator: real left border for reliable visibility.
              Views are ephemeral and exited by clearing search. */}
          <div
            className={cn(
              'space-y-1.5 dark:space-y-2 relative',
              viewState !== null
                ? isTagView
                  ? 'border-l-[6px] border-primary/80 pl-5'
                  : 'border-l-[6px] border-accent pl-5'
                : ''
            )}
            role="list"
            ref={listRef}
          >
          {visibleTaskEntries.map(({ task, index }, visibleIndex) => {
            const isActive =
              activeTaskId === task.id ||
              (activeTaskId === null && visibleIndex === 0);

            // When a view is active, hierarchy is flattened for clarity.
            // Views are lenses, not structure.
            const effectiveIndent = viewState !== null ? 0 : task.indent;

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
                rowRef={(el: HTMLDivElement | null) => (rowRefs.current[index] = el)}
                onFocusRow={() => setActiveTaskId(task.id)}
                onMouseDownRow={(e: React.MouseEvent<HTMLDivElement>) => {
                  const t = e.target as HTMLElement | null;
                  if (t?.closest('input,textarea,button')) return;
                  setActiveTaskId(task.id);
                }}
                onKeyDownCapture={(e: React.KeyboardEvent<HTMLDivElement>) =>
                  handleRowKeyDownCapture(e, index, task)}
                onPointerDown={(e: React.PointerEvent<HTMLDivElement>) =>
                  handlePointerDown(index, e)}
                onToggle={() => toggleTask(task)}
                isEditing={editingId === task.id}
                editingText={editingId === task.id ? editingText : task.text}
                editInputRef={editingId === task.id ? editInputRef : undefined}
                onChangeEditingText={(value: string) => {
                  setEditingText(value);

                  if (
                    !editingOriginalRef.current ||
                    editingOriginalRef.current.taskId !== task.id
                  ) {
                    editingOriginalRef.current = {
                      taskId: task.id,
                      snapshot: task,
                    };
                    setUndoAction({ type: 'edit', task });
                  }

                  setAllTasks(prev =>
                    prev.map(t =>
                      t.id === task.id ? { ...t, text: value } : t
                    )
                  );
                }}
                onTextareaKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) =>
                  handleTextareaKeyDown(e, index, task)}
                onTextareaBlur={() => saveEdit(task)}
                onTextClick={(e: React.MouseEvent<HTMLDivElement>) => {
                  const el = e.currentTarget;
                  const caret = getCaretOffsetFromPoint(el, e.clientX, e.clientY);
                  setActiveTaskId(task.id);
                  startEditing(
                    task,
                    Math.min(task.text.length, caret ?? task.text.length)
                  );
                }}
                searchQuery={normalizedQuery}
                onDelete={() => archiveTask(task)}
              />
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}
