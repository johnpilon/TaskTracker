import type { Task, UndoAction } from '../app/page';

export type PendingFocus =
  | { taskId: string; mode: 'row' }
  | { taskId: string; mode: 'edit'; caret: number };

export function applyUndo(prev: Task[], action: UndoAction): Task[] {
  if (!action) return prev;

  switch (action.type) {
    case 'delete': {
      const next = [...prev];
      next.splice(action.index, 0, action.task);
      return next;
    }

    case 'edit':
    case 'toggle':
    case 'indent':
      return prev.map(t => (t.id === action.task.id ? action.task : t));

    case 'split': {
      const next = [...prev];

      const originalIndex = next.findIndex(t => t.id === action.original.id);
      if (originalIndex >= 0) next[originalIndex] = action.original;

      const createdIndex = next.findIndex(t => t.id === action.createdId);
      if (createdIndex >= 0) next.splice(createdIndex, 1);

      return next;
    }

    case 'merge': {
      const next = [...prev];
      const keptIndex = next.findIndex(t => t.id === action.keptOriginal.id);

      if (keptIndex >= 0) {
        next[keptIndex] = action.keptOriginal;
        next.splice(keptIndex + 1, 0, action.removed);
      } else {
        next.push(action.removed);
      }

      return next;
    }
  }
}

export function getUndoPendingFocus(action: UndoAction): PendingFocus | null {
  if (!action) return null;

  switch (action.type) {
    case 'split':
      return { taskId: action.original.id, mode: 'edit', caret: action.cursor };

    case 'merge':
      return action.direction === 'backward'
        ? { taskId: action.removed.id, mode: 'edit', caret: 0 }
        : { taskId: action.keptOriginal.id, mode: 'edit', caret: action.caret };

    case 'delete':
    case 'edit':
    case 'toggle':
    case 'indent':
      return { taskId: action.task.id, mode: 'row' };
  }
}

export function pushUndo(prev: UndoAction[], action: UndoAction): UndoAction[] {
  return [...prev, action];
}

