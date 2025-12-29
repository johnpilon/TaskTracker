import { useRef } from 'react';
import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';

const DEBUG_DRAG = false; // Set to true for debugging

export function useDragController<
  TTask extends { id: string; indent: number; listId?: string; archived?: boolean },
  TUndoAction = unknown,
>(opts: {
  tasks: TTask[];
  setAllTasks: Dispatch<SetStateAction<TTask[]>>;
  setUndoStack: Dispatch<SetStateAction<TUndoAction[]>>;
  setDragIndex: (index: number | null) => void;
  rowRefsByIdRef: { current: Map<string, HTMLDivElement> };
  activeListId: string;
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
    rowRefsByIdRef,
    activeListId,
    INDENT_WIDTH,
    MAX_INDENT,
    searchQuery,
    deriveViewState,
  } = opts;

  const dragIndexRef = useRef<number | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const baseIndentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Track current task order during drag to handle closure issues
  const taskOrderRef = useRef<TTask[]>([]);
  // Prevent concurrent moves during state updates
  const moveInProgressRef = useRef(false);

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
    taskOrderRef.current = [...tasks]; // Snapshot task order at drag start

    if (DEBUG_DRAG) {
      console.log('=== DRAG START ===');
      console.log('Drag index:', index);
      console.log('Task being dragged:', (tasks[index] as any).text, 'id:', tasks[index].id);
      console.log('taskOrderRef.current:', taskOrderRef.current.map((t: any, i: number) => `${i}: ${t.text} (${t.id.slice(0, 8)})`));
    }

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
      if (moveInProgressRef.current) return; // Don't queue new moves while one is in progress

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const currentIndex = dragIndexRef.current;
        if (currentIndex === null) return;
        if (moveInProgressRef.current) return; // Double-check

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

          // Get the task ID for the indent operation (stable across different array orders)
          const draggedTask = taskOrderRef.current[currentIndex];
          if (draggedTask) {
            const draggedId = draggedTask.id;

            // Update taskOrderRef with new indent
            taskOrderRef.current = taskOrderRef.current.map(t =>
              t.id === draggedId ? { ...t, indent: targetIndent } : t
            );

            setAllTasks(prevAll => {
              return prevAll.map(t =>
                t.id === draggedId ? { ...t, indent: targetIndent } : t
              );
            });

            dragStartXRef.current = x;
            baseIndentRef.current = targetIndent;
          }
        }

        // Vertical reorder
        // Use task IDs to look up DOM elements since indices change during drag
        const getRowElement = (index: number): HTMLDivElement | null => {
          const task = taskOrderRef.current[index];
          if (!task) {
            if (DEBUG_DRAG && index >= 0 && index < taskOrderRef.current.length + 1) {
              console.log(`getRowElement(${index}): no task at this index (length: ${taskOrderRef.current.length})`);
            }
            return null;
          }
          const el = rowRefsByIdRef.current.get(task.id) ?? null;
          if (DEBUG_DRAG && !el) {
            console.log(`getRowElement(${index}): task ${(task as any).text} (${task.id.slice(0, 8)}) has no DOM ref`);
          }
          return el;
        };

        const move = (from: number, to: number) => {
          if (moveInProgressRef.current) return; // Prevent concurrent moves
          moveInProgressRef.current = true;

          if (DEBUG_DRAG) {
            const fromTask = taskOrderRef.current[from] as any;
            const toTask = taskOrderRef.current[to] as any;
            console.log(`=== MOVE ${from} -> ${to} ===`);
            console.log(`Moving: ${fromTask?.text} (${fromTask?.id?.slice(0, 8)})`);
            console.log(`Target position occupied by: ${toTask?.text} (${toTask?.id?.slice(0, 8)})`);
          }

          // Update our local task order ref immediately
          const orderCopy = [...taskOrderRef.current];
          const [moved] = orderCopy.splice(from, 1);
          orderCopy.splice(to, 0, moved);
          taskOrderRef.current = orderCopy;

          // Update drag index ref immediately (NO setState call during move to avoid render loops)
          dragIndexRef.current = to;

          // Sync state: merge reordered drag slice back into allTasks
          setAllTasks(prevAll => {
            // Build the new drag slice order using taskOrderRef
            const dragSliceIds = new Set(taskOrderRef.current.map(t => t.id));
            const byId = new Map(prevAll.map(t => [t.id, t]));
            
            // Get updated tasks in new order
            const reorderedDragSlice = taskOrderRef.current
              .map(t => byId.get(t.id))
              .filter((t): t is TTask => t !== undefined);
            
            // Keep non-drag tasks (other lists, archived)
            const nonDragTasks = prevAll.filter(t => !dragSliceIds.has(t.id));
            
            if (DEBUG_DRAG) {
              console.log('setAllTasks - reorderedDragSlice:', reorderedDragSlice.map((t: any) => `${t.text} (intent: ${t.intent ?? 'none'})`));
            }
            
            // Return: drag slice in new order, then other tasks
            return [...reorderedDragSlice, ...nonDragTasks];
          });

          // Allow next move after a small delay to let state settle
          setTimeout(() => {
            moveInProgressRef.current = false;
          }, 16); // ~1 frame
        };

        const down = getRowElement(currentIndex + 1);
        if (down) {
          const r = down.getBoundingClientRect();
          if (y > r.top + r.height / 2) {
            if (DEBUG_DRAG) {
              const downTask = taskOrderRef.current[currentIndex + 1] as any;
              console.log(`Crossing DOWN: y=${y.toFixed(0)}, rowMid=${(r.top + r.height / 2).toFixed(0)}, task: ${downTask?.text}`);
            }
            move(currentIndex, currentIndex + 1);
            return;
          }
        }

        const up = getRowElement(currentIndex - 1);
        if (up) {
          const r = up.getBoundingClientRect();
          if (y < r.top + r.height / 2) {
            if (DEBUG_DRAG) {
              const upTask = taskOrderRef.current[currentIndex - 1] as any;
              console.log(`Crossing UP: y=${y.toFixed(0)}, rowMid=${(r.top + r.height / 2).toFixed(0)}, task: ${upTask?.text}`);
            }
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
      moveInProgressRef.current = false; // Reset move lock
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return { handlePointerDown };
}


