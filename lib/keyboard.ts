export type ArrowKey = 'ArrowUp' | 'ArrowDown';

export function shouldIgnoreTab(normalizedQueryLength: number): boolean {
  return normalizedQueryLength > 0;
}

export function nextIndentFromTab(args: {
  currentIndent: number;
  shiftKey: boolean;
  maxIndent: number;
}): number {
  const delta = args.shiftKey ? -1 : 1;
  return Math.max(0, Math.min(args.maxIndent, args.currentIndent + delta));
}

export function nextIndexFromListArrow(args: {
  key: ArrowKey;
  currentIndex: number; // -1 means "capture row"
  tasksLength: number;
}): number | null {
  if (args.tasksLength <= 0) return null;

  // When the capture row is active, ArrowUp should keep you there.
  if (args.currentIndex === -1 && args.key === 'ArrowUp') return null;

  const safeIndex = args.currentIndex >= 0 ? args.currentIndex : -1;
  return args.key === 'ArrowDown'
    ? Math.min(args.tasksLength - 1, safeIndex + 1)
    : Math.max(0, safeIndex - 1);
}

export function nextIndexFromRowArrow(args: {
  key: ArrowKey;
  index: number;
  tasksLength: number;
}): number {
  return args.key === 'ArrowDown'
    ? Math.min(args.tasksLength - 1, args.index + 1)
    : Math.max(0, args.index - 1);
}


