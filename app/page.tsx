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
  createdAt: string;
  completed: boolean;
  indent: number;
  tags: string[];
  meta?: TaskMeta; // optional for backward compatibility
}

export interface TaskMeta {
  tags: string[];
}

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
  const [tasks, setTasks] = usePersistentTasks();
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

        setTasks(prev => {
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
  }, [undoAction, tasks, activeTaskId, editingId, setTasks]);

  /* =======================
     Task Actions
  ======================= */

  const addTask = () => {
    if (!input.trim()) return;

    const text = input.trim();
    const tags = computeTags(text);

    setTasks(prev => [
      {
        id: Date.now().toString(),
        text,
        createdAt: new Date().toISOString(),
        completed: false,
        indent: 0,
        tags,
        meta: { tags },
      },
      ...prev,
    ]);

    setInput('');
    inputRef.current?.focus();
  };

  const toggleTask = (task: Task) => {
    setUndoAction({ type: 'toggle', task });
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id ? { ...t, completed: !t.completed } : t
      )
    );
  };

  const deleteTask = (task: Task, index: number) => {
    setUndoAction({ type: 'delete', task, index });
    setTasks(prev => prev.filter(t => t.id !== task.id));
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
      const nextText = editingText;
      const nextTags = computeTags(nextText);
  
      setUndoAction({ type: 'edit', task });
  
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? {
                ...t,
                text: nextText,
                tags: nextTags,
                meta: { tags: nextTags },
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
    const createdAt = new Date().toISOString();

    const before = editingText.slice(0, cursor);
    const after = editingText.slice(cursor);

    // IMPORTANT: tags must always be derived from text.
    // Never copy tags between tasks.
    const leftMeta = parseTaskMeta(before);
    const rightMeta = parseTaskMeta(after);
    const originalMeta = parseTaskMeta(editingText);

    console.group('SPLIT DEBUG');
    console.log('Left text:', before);
    console.log('Left tags:', leftMeta.tags);
    console.log('Right text:', after);
    console.log('Right tags:', rightMeta.tags);
    console.groupEnd();

    // Undo should restore the original row and caret position, and remove the created row.
    setUndoAction({
      type: 'split',
      original: {
        ...task,
        text: editingText,
        tags: originalMeta.tags,
        meta: { tags: originalMeta.tags },
      },
      createdId,
      cursor,
    });

    setTasks(prev => {
      const next = [...prev];
      const currentIndex = next.findIndex(t => t.id === task.id);
      const safeIndex = currentIndex >= 0 ? currentIndex : index;

      const current = next[safeIndex];
      if (!current) return prev;

      next[safeIndex] = {
        ...current,
        text: before,
        tags: leftMeta.tags,
        meta: { tags: leftMeta.tags },
      };
      const newTask: Task = {
        id: createdId,
        text: after,
        createdAt,
        completed: false,
        indent: current.indent,
        tags: rightMeta.tags,
        meta: { tags: rightMeta.tags },
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
    setEditingText(after);
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
      const merged = prev.text + editingText;
      const mergedTags = computeTags(merged);

      setUndoAction({
        type: 'merge',
        direction: 'backward',
        keptOriginal: prev,
        removed: task,
        caret: 0,
      });

      setTasks(prevTasks => {
        const next = [...prevTasks];
        next[index - 1] = {
          ...prev,
          text: merged,
          tags: mergedTags,
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
        const nextText = editingText;
        const nextTags = computeTags(nextText);
        setTasks(prev =>
          prev.map(t =>
            t.id === task.id
              ? { ...t, text: nextText, tags: nextTags, meta: { tags: nextTags } }
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
        const nextText = editingText;
        const nextTags = computeTags(nextText);
        setTasks(prev =>
          prev.map(t =>
            t.id === task.id
              ? { ...t, text: nextText, tags: nextTags, meta: { tags: nextTags } }
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
      const merged = editingText + nextTask.text;
      const mergedTags = computeTags(merged);

      setUndoAction({
        type: 'merge',
        direction: 'forward',
        keptOriginal: task,
        removed: nextTask,
        caret: editingText.length,
      });

      setTasks(prevTasks => {
        const next = [...prevTasks];
        next[index] = {
          ...task,
          text: merged,
          tags: mergedTags,
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
      setTasks(prev =>
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
      setTasks(prev =>
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

          setTasks(prev => {
            const next = [...prev];
            next[currentIndex] = { ...next[currentIndex], indent: targetIndent };
            return next;
          });

          dragStartXRef.current = x;
          baseIndentRef.current = targetIndent;
        }

        // Vertical reorder
        const move = (from: number, to: number) => {
          setTasks(prev => {
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
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setSearchQuery('');
                searchInputRef.current?.focus();
              }
            }}
            placeholder="Search tasks or #tags"
            className="w-full bg-card border border-border rounded-lg px-5 py-3 pr-12 text-base
                       text-foreground placeholder:text-muted-foreground
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        {/* Optional indicator */}
        {viewState !== null && (
          <div className="mt-2 text-[10px] tracking-wider text-muted-foreground/70">
            Viewing results
          </div>
        )}
        {normalizedQuery.length > 0 && (
          <div className="mt-1 text-sm text-muted-foreground">
            Showing {visibleTasks.length} of {tasks.length} tasks
          </div>
        )}

        {/* Active view indicator: real left border for reliable visibility.
            Views are ephemeral and exited by clearing search. */}
        <div
          className={cn(
            'mt-8 space-y-2 relative',
            viewState !== null ? 'border-l-[6px] border-accent pl-5' : ''
          )}
          role="list"
          ref={listRef}
        >
          {visibleTaskEntries.map(({ task, index }, visibleIndex) => {
            const isActive =
              activeTaskId === task.id ||
              (activeTaskId === null && visibleIndex === 0);

            return (
              <TaskRow
                key={task.id}
                task={task}
                index={index}
                isActive={isActive}
                dragIndex={dragIndex}
                indentWidth={INDENT_WIDTH}
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

                  setTasks(prev =>
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
                onDelete={() => deleteTask(task, index)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
