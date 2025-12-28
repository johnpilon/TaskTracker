import type { Task } from '../app/page';

export type EditingOriginal = { taskId: string; snapshot: Task } | null;

export function getOriginalSnapshot(editingOriginal: EditingOriginal, task: Task): Task {
  return editingOriginal && editingOriginal.taskId === task.id
    ? editingOriginal.snapshot
    : task;
}

export function clampCaret(caret: number, textLength: number): number {
  return Math.max(0, Math.min(textLength, caret));
}

export function getAddedTags(originalTags: string[], nextTags: string[]): string[] {
  const existing = new Set(originalTags.map(t => t.toLowerCase()));
  return nextTags.filter(t => !existing.has(t.toLowerCase()));
}

export function shouldCommitEdit(args: {
  textChanged: boolean;
  addedTagsCount: number;
  hasIntent: boolean;
  hasMomentum: boolean;
}): boolean {
  return args.textChanged || args.addedTagsCount > 0 || args.hasIntent || args.hasMomentum;
}


