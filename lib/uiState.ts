import { useEffect, useRef } from 'react';

const UI_STATE_KEY = 'task_ui_state';

type StoredUIState = {
  activeTaskId?: unknown;
  editingTaskId?: unknown;
  caret?: unknown;
};

type RestoreContextTask = { id: string; text: string };

export function useUIStatePersistence(opts: {
  tasks: RestoreContextTask[];
  activeTaskId: string;
  editingId: string | null;
  caretPos: number | null;
  setActiveTaskId: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setEditingText: (text: string) => void;
  setCaretPos: (pos: number | null) => void;
  caretInitializedRef: { current: boolean };
}) {
  const {
    tasks,
    activeTaskId,
    editingId,
    caretPos,
    setActiveTaskId,
    setEditingId,
    setEditingText,
    setCaretPos,
    caretInitializedRef,
  } = opts;

  const uiRestoredRef = useRef(false);
  const restoringUIRef = useRef(false);
  const initialUIStateRef = useRef<
    | {
        activeTaskId?: string;
        editingTaskId?: string;
        caret?: number;
      }
    | null
  >(null);

  // Initialize restore intent synchronously (matches original timing in app/page.tsx)
  if (typeof window !== 'undefined' && initialUIStateRef.current === null) {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          initialUIStateRef.current = parsed;
          if (
            (parsed as { activeTaskId?: unknown }).activeTaskId ||
            (parsed as { editingTaskId?: unknown }).editingTaskId
          ) {
            restoringUIRef.current = true;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const isRestoringUI = restoringUIRef.current;

  useEffect(() => {
    if (uiRestoredRef.current) return;
    if (tasks.length === 0) return;

    uiRestoredRef.current = true;

    try {
      const raw =
        initialUIStateRef.current ??
        JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? 'null');
      if (!raw) return;
      const parsed = raw as StoredUIState;
      if (!parsed || typeof parsed !== 'object') return;

      const storedActive = parsed.activeTaskId;
      const storedEditing = parsed.editingTaskId;
      const storedCaret = parsed.caret;

      const hasActive =
        typeof storedActive === 'string' && tasks.some(t => t.id === storedActive);
      const hasEditing =
        typeof storedEditing === 'string' && tasks.some(t => t.id === storedEditing);

      if (hasActive) setActiveTaskId(storedActive as string);

      if (hasEditing) {
        const task = tasks.find(t => t.id === storedEditing) ?? null;
        if (task) {
          setEditingId(task.id);
          setEditingText(task.text);
          caretInitializedRef.current = false;
          if (typeof storedCaret === 'number' && Number.isFinite(storedCaret)) {
            setCaretPos(Math.max(0, Math.min(task.text.length, storedCaret)));
          }
        }
      }
    } catch {
      // Fail silently
    }

    restoringUIRef.current = false;
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          activeTaskId,
          editingTaskId: editingId,
          caret: caretPos,
        })
      );
    } catch {
      // Ignore persistence errors for UI state
    }
  }, [activeTaskId, editingId, caretPos]);

  return { isRestoringUI };
}


