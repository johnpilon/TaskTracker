import type { Task, UndoAction } from '../app/page';

type Ref<T> = { current: T };
type SetState<T> = (value: T | ((prev: T) => T)) => void;
type SetTasks = (value: Task[] | ((prev: Task[]) => Task[])) => void;

export type EditingControllerDeps = {
  tasks: Task[];
  editingId: string | null;
  editingText: string;
  NEW_TASK_ROW_ID: string;

  setAllTasks: SetTasks;
  setUndoStack: SetState<UndoAction[]>;
  setActiveTaskId: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setEditingText: (text: string) => void;
  setCaretPos: (pos: number | null) => void;

  caretInitializedRef: Ref<boolean>;
  editingOriginalRef: Ref<{ taskId: string; snapshot: Task } | null>;

  createId: () => string;

  parseTaskInput: (
    raw: string
  ) => { text: string; tags: string[]; intent?: Task['intent']; momentum?: boolean };

  commitTaskText: (
    taskId: string,
    rawText: string,
    opts?: { defaultIntent?: Task['intent']; preserveExistingIntent?: boolean }
  ) => void;
};

export function createEditingController(deps: EditingControllerDeps) {
  const clampCaret = (caret: number, textLength: number): number =>
    Math.max(0, Math.min(textLength, caret));

  const getOriginalSnapshot = (
    editingOriginal: { taskId: string; snapshot: Task } | null,
    task: Task
  ): Task => (editingOriginal && editingOriginal.taskId === task.id ? editingOriginal.snapshot : task);

  const getAddedTags = (originalTags: string[], nextTags: string[]): string[] => {
    const existing = new Set(originalTags.map(t => t.toLowerCase()));
    return nextTags.filter(t => !existing.has(t.toLowerCase()));
  };

  const shouldCommitEdit = (args: {
    textChanged: boolean;
    addedTagsCount: number;
    hasIntent: boolean;
    hasMomentum: boolean;
  }): boolean =>
    args.textChanged || args.addedTagsCount > 0 || args.hasIntent || args.hasMomentum;

  const commitCompletedInlineTags = (
    taskId: string,
    value: string,
    caret: number | null
  ): { nextValue: string; nextCaret: number | null; committed: string[] } => {
    // Commit ONLY completed tag tokens (terminated by whitespace) into task.tags[],
    // and strip them from the editable text.
    //
    // NOTE: We purposely do NOT scan/commit on every keystroke; callers should invoke
    // this only when the user inserts whitespace or on explicit commit (blur/save).
    const TAG_TOKEN_TERMINATED_BY_SPACE = /(^|\s)#([a-zA-Z0-9_-]+)(?=\s)/g;

    const committed: string[] = [];
    let nextCaret = caret;

    let out = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_TOKEN_TERMINATED_BY_SPACE.exec(value))) {
      const leading = match[1] ?? '';
      const tag = match[2] ?? '';
      const fullStart = match.index;
      const tokenStart = fullStart + leading.length;
      const tokenEnd = tokenStart + 1 + tag.length;

      out += value.slice(lastIndex, fullStart);
      out += leading;
      lastIndex = tokenEnd;

      const normalized = String(tag).toLowerCase();
      if (normalized) committed.push(normalized);

      if (typeof nextCaret === 'number' && tokenEnd <= nextCaret) {
        const removedLen = tokenEnd - fullStart;
        const addedLen = leading.length;
        nextCaret = Math.max(0, nextCaret - (removedLen - addedLen));
      }
    }

    if (lastIndex === 0) {
      return { nextValue: value, nextCaret, committed: [] };
    }

    out += value.slice(lastIndex);
    const nextValue = out.replace(/[ \t]{2,}/g, ' ');
    if (typeof nextCaret === 'number') {
      nextCaret = Math.min(nextValue.length, nextCaret);
    }

    if (committed.length > 0) {
      deps.setAllTasks(prev =>
        prev.map(t => {
          if (t.id !== taskId) return t;
          const merged = Array.from(
            new Set([...(t.tags ?? []), ...committed.map(x => x.toLowerCase())])
          );
          return { ...t, tags: merged, meta: { tags: merged } };
        })
      );
    }

    return { nextValue, nextCaret, committed: Array.from(new Set(committed)) };
  };

  const commitNewTaskFromRow = () => {
    const raw = deps.editingText;
    const parsed = deps.parseTaskInput(raw);

    // Require at least text or tags.
    if (parsed.text.length === 0 && parsed.tags.length === 0) return;

    const now = Date.now();
    const id = deps.createId();

    deps.setAllTasks(prev => [
      {
        id,
        text: parsed.text,
        createdAt: now,
        order: now,
        completed: false,
        archived: false,
        indent: 0,
        tags: parsed.tags,
        ...(parsed.intent ? { intent: parsed.intent } : { intent: 'now' }),
        momentum: parsed.momentum === true,
        meta: { tags: parsed.tags },
      },
      ...prev,
    ]);

    // Keep capture row active + ready for the next thought.
    deps.setActiveTaskId(deps.NEW_TASK_ROW_ID);
    deps.setEditingId(deps.NEW_TASK_ROW_ID);
    deps.setEditingText('');
    deps.setCaretPos(0);
    deps.caretInitializedRef.current = false;
  };

  const cancelNewRowEdit = () => {
    if (deps.editingId !== deps.NEW_TASK_ROW_ID) return;
    deps.setEditingId(null);
    deps.setEditingText('');
    deps.setCaretPos(null);
    deps.caretInitializedRef.current = false;
  };

  const saveEdit = (task: Task) => {
    const originalSnapshot = getOriginalSnapshot(deps.editingOriginalRef.current, task);

    // Tags are canonical state and are NOT derived from text.
    // However, if the user typed new `#tags` in the editor, commit them now (and strip from text).
    const parsed = deps.parseTaskInput(deps.editingText);
    const addedTags = getAddedTags(originalSnapshot.tags ?? [], parsed.tags);
    const textChanged = parsed.text !== originalSnapshot.text;
    const shouldCommit = shouldCommitEdit({
      textChanged,
      addedTagsCount: addedTags.length,
      hasIntent: parsed.intent !== undefined,
      hasMomentum: parsed.momentum === true,
    });

    if (shouldCommit && deps.editingText !== task.text) {
      deps.setUndoStack(stack => [...stack, { type: 'edit', task: originalSnapshot }]);

      deps.commitTaskText(task.id, deps.editingText, {
        preserveExistingIntent: true,
      });
    }

    deps.setEditingId(null);
    deps.setEditingText('');
    deps.setCaretPos(null);
    deps.editingOriginalRef.current = null;
  };

  const commitActiveEditIfAny = () => {
    if (!deps.editingId) return;
    const current = deps.tasks.find(t => t.id === deps.editingId) ?? null;
    if (!current) return;
    saveEdit(current);
  };

  function startEditing(task: Task, caret: number) {
    // Leaving the field === commit intent.
    // When switching edits, commit the current edit first.
    if (deps.editingId && deps.editingId !== task.id) {
      const current = deps.tasks.find(t => t.id === deps.editingId) ?? null;
      if (current) saveEdit(current);
    }
    deps.setEditingId(task.id);
    deps.setEditingText(task.text);
    deps.setCaretPos(clampCaret(caret ?? task.text.length ?? 0, task.text.length));
    deps.caretInitializedRef.current = false;
    deps.editingOriginalRef.current = { taskId: task.id, snapshot: task };
  }

  const splitTaskAt = (task: Task, index: number, cursor: number) => {
    const createdId = deps.createId();
    const createdAt = Date.now();

    const before = deps.editingText.slice(0, cursor);
    const after = deps.editingText.slice(cursor);

    // Tags are canonical state and are NOT derived from text.
    // Split affects text only; tags stay on the original (left) task unless explicitly removed.
    const leftParsed = deps.parseTaskInput(before);
    const rightParsed = deps.parseTaskInput(after);
    const originalParsed = deps.parseTaskInput(deps.editingText);

    const leftText = leftParsed.text;
    const rightText = rightParsed.text;
    const originalText = originalParsed.text;

    // If the user typed new tags in this edit session and presses Enter (split),
    // those tags must be committed to the canonical tag state (left/original row).
    const originalTags = Array.from(new Set([...(task.tags ?? []), ...originalParsed.tags]));

    // Undo should restore the original row and caret position, and remove the created row.
    deps.setUndoStack(stack => [
      ...stack,
      {
        type: 'split',
        original: {
          ...task,
          text: originalText,
          tags: originalTags,
          intent: originalParsed.intent,
          meta: { ...(task.meta ?? {}), tags: originalTags },
        },
        createdId,
        cursor,
      },
    ]);

    deps.setAllTasks(prev => {
      const next = [...prev];
      const currentIndex = next.findIndex(t => t.id === task.id);
      const safeIndex = currentIndex >= 0 ? currentIndex : index;

      const current = next[safeIndex];
      if (!current) return prev;

      next[safeIndex] = {
        ...current,
        text: leftText,
        tags: originalTags,
        ...(leftParsed.intent ? { intent: leftParsed.intent } : { intent: undefined }),
        ...(leftParsed.momentum ? { momentum: true } : {}),
        meta: { tags: originalTags },
      };
      const newTask: Task = {
        id: createdId,
        text: rightText,
        createdAt,
        order: createdAt,
        completed: false,
        archived: false,
        indent: current.indent,
        tags: [],
        ...(rightParsed.intent ? { intent: rightParsed.intent } : {}),
        momentum: rightParsed.momentum === true,
        meta: { tags: [] },
      };
      next.splice(safeIndex + 1, 0, newTask);

      console.log(
        'POST-SPLIT TASKS:',
        next.map(t => ({ id: t.id, text: t.text, tags: t.tags }))
      );

      return next;
    });

    deps.setActiveTaskId(createdId);
    deps.setEditingId(createdId);
    deps.setEditingText(rightText);
    deps.setCaretPos(0);
    deps.caretInitializedRef.current = false;
  };

  return {
    commitCompletedInlineTags,
    commitNewTaskFromRow,
    cancelNewRowEdit,
    startEditing,
    commitActiveEditIfAny,
    saveEdit,
    splitTaskAt,
  };
}


