import { useRef } from 'react';
import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';

export function useDragController<
  TTask extends { indent: number },
  TUndoAction = unknown,
>(opts: {
  tasks: TTask[];
  setAllTasks: Dispatch<SetStateAction<TTask[]>>;
  setUndoStack: Dispatch<SetStateAction<TUndoAction[]>>;
  setDragIndex: (index: number | null) => void;
  rowRefs: { current: (HTMLDivElement | null)[] };
  INDENT_WIDTH: number;
  MAX_INDENT: number;
  searchQuery: string;
  deriveViewState: (raw: string) => unknown | null;
}) {
  const {
    tasks,
    setAllTasks,
    setUndoStack,
    setDragIndex,
    rowRefs,
    INDENT_WIDTH,
    MAX_INDENT,
    searchQuery,
    deriveViewState,
  } = opts;

  const dragIndexRef = useRef<number | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const baseIndentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

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

// Snapshot before indent for undo
setUndoStack(stack => [
  ...stack,
  {
    type: 'indent',
    task: structuredClone(tasks[index]),
  } as TUndoAction,
]);


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

  return { handlePointerDown };
}


