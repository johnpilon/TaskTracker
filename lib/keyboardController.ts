import { useEffect } from 'react';

export function useKeyboardController<
  TTask extends { id: string; text: string },
  TUndoAction,
  TPendingFocus = unknown,
>(opts: {
  tasks: TTask[];
  activeTaskId: string;
  editingId: string | null;
  undoStack: TUndoAction[];

  NEW_TASK_ROW_ID: string;

  setAllTasks: (value: TTask[] | ((prev: TTask[]) => TTask[])) => void;
  setUndoStack: (value: TUndoAction[] | ((prev: TUndoAction[]) => TUndoAction[])) => void;
  setActiveTaskId: (id: string) => void;

  // Navigation + selection
  startEditing: (task: TTask, caret: number) => void;
  listRef: { current: HTMLDivElement | null };
  rowRefs: { current: (HTMLDivElement | null)[] };
  nextIndexFromListArrow: (args: {
    key: 'ArrowUp' | 'ArrowDown';
    currentIndex: number;
    tasksLength: number;
  }) => number | null;

  // Undo + focus restoration
  getUndoPendingFocus: (action: TUndoAction) => TPendingFocus;
  setPendingFocus: (pending: TPendingFocus) => void;
  applyUndo: (prev: TTask[], action: TUndoAction) => TTask[];

  // Search escape behavior
  searchQuery: string;
  setSearchQuery: (value: string | ((prev: string) => string)) => void;
  searchInputRef: { current: HTMLInputElement | null };
}) {
  const {
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
  } = opts;

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
      /* ------------------------------------------------------------
       * Arrow-key navigation (unchanged)
       * ---------------------------------------------------------- */
      if (!editingId && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const activeEl = document.activeElement as HTMLElement | null;
        const inList = !!(activeEl && listRef.current?.contains(activeEl));

        if (inList && tasks.length > 0) {
          e.preventDefault();

          const currentIndex =
            activeTaskId === NEW_TASK_ROW_ID
              ? -1
              : tasks.findIndex(t => t.id === activeTaskId);

          const nextIndex = nextIndexFromListArrow({
            key: e.key as 'ArrowUp' | 'ArrowDown',
            currentIndex,
            tasksLength: tasks.length,
          });
          if (nextIndex === null) return;

          const nextTask = tasks[nextIndex];
          if (nextTask) {
            setActiveTaskId(nextTask.id);

            const fromControl = !!activeEl?.closest('input[type="checkbox"],button');

            if (!fromControl) {
              startEditing(nextTask, nextTask.text.length);
            } else {
              requestAnimationFrame(() => rowRefs.current[nextIndex]?.focus());
            }
          }
          return;
        }
      }

      /* ------------------------------------------------------------
       * UNDO (Ctrl/Cmd + Z)
       * ---------------------------------------------------------- */
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();

        const action = undoStack[undoStack.length - 1];
        if (!action) return; // ⬅️ this line silences ALL “possibly null” errors

        /* ------------------------------------------------------------
         * Focus restoration (type-safe narrowing)
         * ---------------------------------------------------------- */
        setPendingFocus(getUndoPendingFocus(action));

        /* ------------------------------------------------------------
         * Apply undo
         * ---------------------------------------------------------- */
        setAllTasks(prev => applyUndo(prev, action));

        setUndoStack(stack => stack.slice(0, -1));
      }

      // End handler
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [undoStack, tasks, activeTaskId, editingId, setAllTasks]);
}


