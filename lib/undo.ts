import type { Task } from '../app/page';

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


