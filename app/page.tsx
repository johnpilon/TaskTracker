'use client';

import { useState, useRef, useEffect } from 'react';

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
  | null;

const MAX_INDENT = 2;
const BASE_LEFT_PADDING = 16;
const INDENT_WIDTH = 24;

/* ---------------- Drag Handle ---------------- */

const DragHandle = ({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) => (
  <div
    onPointerDown={onPointerDown}
    className="cursor-grab active:cursor-grabbing text-neutral-600 hover:text-neutral-400 select-none self-center touch-none"
    aria-hidden
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

/* ---------------- Page ---------------- */

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const [undoAction, setUndoAction] = useState<UndoAction>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const dragIndexRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  /* ---------------- lifecycle ---------------- */

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tasks');
      if (stored) setTasks(JSON.parse(stored));
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    }
  }, [tasks, hydrated]);

  /* ---------------- undo ---------------- */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoAction) {
        e.preventDefault();

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
            default:
              return prev;
          }
        });

        setUndoAction(null);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoAction]);

  /* ---------------- task actions ---------------- */

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

  const startEditing = (task: Task) => {
    setEditingId(task.id);
    setEditingText(task.text);
  };

  const saveEdit = (task: Task) => {
    if (editingText.trim() !== task.text) {
      setUndoAction({ type: 'edit', task });
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id ? { ...t, text: editingText.trim() } : t
        )
      );
    }
    cancelEdit();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
    inputRef.current?.focus();
  };

  const changeIndent = (task: Task, delta: number) => {
    const nextIndent = Math.max(
      0,
      Math.min(MAX_INDENT, task.indent + delta)
    );

    if (nextIndent === task.indent) return;

    setUndoAction({ type: 'indent', task });
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id ? { ...t, indent: nextIndent } : t
      )
    );
  };

  /* ---------------- pointer drag (smooth + predictable) ---------------- */

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    setDragIndex(index);
    dragIndexRef.current = index;

    const handlePointerMove = (ev: PointerEvent) => {
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const y = ev.clientY;
        const currentIndex = dragIndexRef.current;
        if (currentIndex === null) return;

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

        // Swap based on the midpoint of the adjacent row so reorder feels responsive
        const downIndex = currentIndex + 1;
        const downRow = rowRefs.current[downIndex];
        if (downRow) {
          const rect = downRow.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          if (y > midpoint) {
            move(currentIndex, downIndex);
            return;
          }
        }

        const upIndex = currentIndex - 1;
        const upRow = rowRefs.current[upIndex];
        if (upRow) {
          const rect = upRow.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          if (y < midpoint) {
            move(currentIndex, upIndex);
          }
        }
      });
    };

    const handlePointerUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      dragIndexRef.current = null;
      setDragIndex(null);

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <div className="max-w-3xl mx-auto">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="What needs to be done?"
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-6 py-4 text-xl focus:outline-none focus:border-neutral-700 placeholder:text-neutral-600 transition-colors"
        />

        <div className="mt-8 space-y-2">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              ref={el => (rowRefs.current[index] = el)}
              style={{
                paddingLeft:
                  BASE_LEFT_PADDING + task.indent * INDENT_WIDTH,
              }}
              className={`group flex items-start gap-4 bg-neutral-900 border border-neutral-800 rounded-lg px-6 py-4
                transition-transform transition-shadow duration-100 ease-out
                ${dragIndex === index ? 'opacity-90 scale-[1.02] shadow-lg z-10' : ''}
              `}
            >
              <DragHandle
                onPointerDown={e => handlePointerDown(index, e)}
              />

              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => toggleTask(task)}
                className="h-5 w-5 accent-neutral-500 cursor-pointer mt-1"
                onClick={e => e.stopPropagation()}
              />

              {editingId === task.id ? (
                <input
                  ref={editInputRef}
                  value={editingText}
                  onChange={e => setEditingText(e.target.value)}
                  onBlur={() => saveEdit(task)}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      changeIndent(task, e.shiftKey ? -1 : 1);
                    }
                    if (e.key === 'Enter') saveEdit(task);
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="flex-1 min-w-0 bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-lg focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => startEditing(task)}
                  className={`flex-1 min-w-0 text-lg cursor-text whitespace-pre-wrap break-words ${
                    task.completed ? 'line-through text-neutral-500' : ''
                  }`}
                >
                  {task.text}
                </span>
              )}

              <button
                onClick={() => deleteTask(task, index)}
                className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
