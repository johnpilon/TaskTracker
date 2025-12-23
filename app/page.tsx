'use client';

import { useState, useRef, useEffect } from 'react';

/* =======================
   Types
======================= */

interface Task {
  id: string;
  text: string;
  createdAt: string;
  completed: boolean;
  indent: number;
}

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

/* =======================
   Drag Handle
======================= */

const DragHandle = ({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) => (
  <div
    onPointerDown={onPointerDown}
    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground select-none self-center touch-none"
    title="Drag to reorder. Drag left/right to indent."
  >
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="9" cy="3" r="1.5" />
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="9" cy="8" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="9" cy="13" r="1.5" />
    </svg>
  </div>
);

/* =======================
   Page
======================= */

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [caretPos, setCaretPos] = useState<number | null>(null);

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

  const pendingFocusRef = useRef<
    | { taskId: string; mode: 'row' | 'edit'; caret?: number }
    | null
  >(null);

  const createId = () =>
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();

      const pos = caretPos ?? el.value.length;
      el.setSelectionRange(pos, pos);

      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editingId, caretPos]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tasks');
      if (stored) setTasks(JSON.parse(stored));
    } finally {
      setHydrated(true);
    }
  }, []);

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
    }

    requestAnimationFrame(() => {
      if (pending.mode === 'row') {
        rowRefs.current[nextIndex]?.focus();
      }
      pendingFocusRef.current = null;
    });
  }, [tasks]);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    }
  }, [tasks, hydrated]);

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
  }, [undoAction, tasks, activeTaskId, editingId]);

  /* =======================
     Task Actions
  ======================= */

  const addTask = () => {
    if (!input.trim()) return;

    setTasks(prev => [
      {
        id: Date.now().toString(),
        text: input.trim(),
        createdAt: new Date().toISOString(),
        completed: false,
        indent: 0,
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
    setCaretPos(caret);
  };

  const saveEdit = (task: Task) => {
    if (editingText !== task.text) {
      setUndoAction({ type: 'edit', task });
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id ? { ...t, text: editingText } : t
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

    // Undo should restore the original row and caret position, and remove the created row.
    setUndoAction({
      type: 'split',
      original: task,
      createdId,
      cursor,
    });

    setTasks(prev => {
      const next = [...prev];
      const currentIndex = next.findIndex(t => t.id === task.id);
      const safeIndex = currentIndex >= 0 ? currentIndex : index;

      const current = next[safeIndex];
      if (!current) return prev;

      next[safeIndex] = { ...current, text: before };
      const newTask: Task = {
        id: createdId,
        text: after,
        createdAt,
        completed: false,
        indent: current.indent,
      };
      next.splice(safeIndex + 1, 0, newTask);
      return next;
    });

    setActiveTaskId(createdId);
    setEditingId(createdId);
    setEditingText(after);
    setCaretPos(0);
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

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-3xl mx-auto">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="What needs to be done?"
          className="w-full bg-card border border-border rounded-lg px-6 py-4 text-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="mt-8 space-y-2" role="list" ref={listRef}>
          {tasks.map((task, index) => (
            (() => {
              const isActive =
                activeTaskId === task.id || (activeTaskId === null && index === 0);

              return (
            <div
              key={task.id}
              ref={el => (rowRefs.current[index] = el)}
              role="listitem"
              tabIndex={isActive ? 0 : -1}
              onFocus={() => setActiveTaskId(task.id)}
              onMouseDown={e => {
                const t = e.target as HTMLElement | null;
                if (t?.closest('input,textarea,button')) return;
                setActiveTaskId(task.id);
                requestAnimationFrame(() => rowRefs.current[index]?.focus());
              }}
              onKeyDownCapture={e => handleRowKeyDownCapture(e, index, task)}
              className={`group flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card
                ${dragIndex === index ? 'ring-2 ring-ring shadow-lg' : ''}
                ${isActive && dragIndex !== index ? 'ring-1 ring-border' : ''}
                focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
              `}
            >
              {/* Indent rail */}
              <div style={{ width: task.indent * INDENT_WIDTH }} className="flex">
                {Array.from({ length: task.indent }).map((_, i) => (
                  <div key={i} className="w-1 mx-[6px] bg-border rounded" />
                ))}
              </div>

              <DragHandle onPointerDown={e => handlePointerDown(index, e)} />

              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => toggleTask(task)}
                className="h-5 w-5 accent-muted-foreground"
              />

              {editingId === task.id ? (
                <textarea
                  ref={editInputRef}
                  value={editingText}
                  rows={1}
                  onChange={e => {
                    setEditingText(e.target.value);
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                  }}
                  onKeyDown={e => {
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

                      setUndoAction({
                        type: 'merge',
                        direction: 'backward',
                        keptOriginal: prev,
                        removed: task,
                        caret: 0,
                      });

                      setTasks(prevTasks => {
                        const next = [...prevTasks];
                        next[index - 1] = { ...prev, text: merged };
                        next.splice(index, 1);
                        return next;
                      });

                      setEditingId(prev.id);
                      setEditingText(merged);
                      setCaretPos(prev.text.length);
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
                        setTasks(prev =>
                          prev.map(t =>
                            t.id === task.id ? { ...t, text: editingText } : t
                          )
                        );
                      }

                      const prevTask = tasks[index - 1];
                      setActiveTaskId(prevTask.id);
                      setEditingId(prevTask.id);
                      setEditingText(prevTask.text);
                      setCaretPos(prevTask.text.length);
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
                        setTasks(prev =>
                          prev.map(t =>
                            t.id === task.id ? { ...t, text: editingText } : t
                          )
                        );
                      }

                      const nextTask = tasks[index + 1];
                      setActiveTaskId(nextTask.id);
                      setEditingId(nextTask.id);
                      setEditingText(nextTask.text);
                      setCaretPos(nextTask.text.length);
                      return;
                    }

                    // Delete merge: at end of row, pull next row's text up (undoable)
                    if (!hasSelection && e.key === 'Delete' && selEnd === editingText.length) {
                      e.preventDefault();
                      if (index >= tasks.length - 1) return;

                      const nextTask = tasks[index + 1];
                      const merged = editingText + nextTask.text;

                      setUndoAction({
                        type: 'merge',
                        direction: 'forward',
                        keptOriginal: task,
                        removed: nextTask,
                        caret: editingText.length,
                      });

                      setTasks(prevTasks => {
                        const next = [...prevTasks];
                        next[index] = { ...task, text: merged };
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
                      e.preventDefault();
                      setUndoAction({ type: 'indent', task });
                      setTasks(prev =>
                        prev.map(t =>
                          t.id === task.id
                            ? {
                                ...t,
                                indent: Math.max(
                                  0,
                                  Math.min(
                                    MAX_INDENT,
                                    t.indent + (e.shiftKey ? -1 : 1)
                                  )
                                ),
                              }
                            : t
                        )
                      );
                    }

                    if (e.key === 'Escape') saveEdit(task);
                  }}
                  onBlur={() => saveEdit(task)}
                  className="flex-1 min-w-0 bg-transparent text-lg resize-none overflow-hidden focus:outline-none
                             whitespace-pre-wrap break-words overflow-wrap-anywhere"
                />
              ) : (
                <span
                  onClick={e => {
                    const el = e.currentTarget;
                    const caret =
                      getCaretOffsetFromPoint(el, e.clientX, e.clientY) ??
                      task.text.length;
                    setActiveTaskId(task.id);
                    startEditing(task, Math.min(task.text.length, caret));
                  }}
                  className="flex-1 min-w-0 text-lg cursor-text whitespace-pre-wrap
                             break-words overflow-wrap-anywhere"
                >
                  {task.text}
                </span>
              )}

              <button
                onClick={() => deleteTask(task, index)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              >
                🗑️
              </button>
            </div>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}
