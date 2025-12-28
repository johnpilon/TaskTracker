import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type PendingFocus = { taskId: string; mode: 'row' | 'edit'; caret?: number } | null;

type FocusTask = { id: string; text: string };

export function useFocusController(opts: {
  tasks: FocusTask[];
  editingId: string | null;
  setActiveTaskId: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setEditingText: (text: string) => void;
  rowRefs: { current: (HTMLDivElement | null)[] };
  editInputRef: { current: HTMLTextAreaElement | null };
}) {
  const { tasks, editingId, setActiveTaskId, setEditingId, setEditingText, rowRefs, editInputRef } =
    opts;

  const [caretPos, setCaretPos] = useState<number | null>(null);
  const caretInitializedRef = useRef(false);

  const pendingFocusRef = useRef<PendingFocus>(null);

  const setPendingFocus = (pending: PendingFocus) => {
    pendingFocusRef.current = pending;
  };

  const resetCaretInitialized = () => {
    caretInitializedRef.current = false;
  };

  const getCaretOffsetFromPoint = (
    container: HTMLElement,
    x: number,
    y: number
  ): number | null => {
    const doc = container.ownerDocument;
    const anyDoc = doc as unknown as {
      caretPositionFromPoint?: (x: number, y: number) => {
        offsetNode: Node;
        offset: number;
      } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let node: Node | null = null;
    let offset = 0;

    if (typeof anyDoc.caretPositionFromPoint === 'function') {
      const pos = anyDoc.caretPositionFromPoint(x, y);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    } else if (typeof anyDoc.caretRangeFromPoint === 'function') {
      const range = anyDoc.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }

    if (!node || !container.contains(node)) return null;

    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    let count = 0;

    while (current) {
      const text = current.textContent ?? '';
      if (current === node) return count + offset;
      count += text.length;
      current = walker.nextNode();
    }

    return null;
  };

  useLayoutEffect(() => {
    if (!editingId) return;
    if (caretInitializedRef.current) return;

    const el = editInputRef.current;
    if (!el) return;

    el.focus();

    const pos = typeof caretPos === 'number' ? caretPos : el.value.length;

    el.setSelectionRange(pos, pos);

    caretInitializedRef.current = true;
  }, [editingId, caretPos]);

  useEffect(() => {
    const el = editInputRef.current;
    if (!editingId || !el) return;

    const updateCaret = () => {
      const pos = el.selectionStart ?? null;
      if (pos === null || Number.isNaN(pos)) return;
      setCaretPos(pos);
    };

    el.addEventListener('select', updateCaret);
    el.addEventListener('keyup', updateCaret);
    el.addEventListener('mouseup', updateCaret);

    return () => {
      el.removeEventListener('select', updateCaret);
      el.removeEventListener('keyup', updateCaret);
      el.removeEventListener('mouseup', updateCaret);
    };
  }, [editingId]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;

    const nextIndex = tasks.findIndex(t => t.id === pending.taskId);
    if (nextIndex < 0) return;

    setActiveTaskId(pending.taskId);

    if (pending.mode === 'edit') {
      const nextTask = tasks[nextIndex];
      setEditingId(nextTask.id);
      setEditingText(nextTask.text);
      setCaretPos(pending.caret ?? nextTask.text.length);
      caretInitializedRef.current = false;
    }

    requestAnimationFrame(() => {
      if (pending.mode === 'row') {
        rowRefs.current[nextIndex]?.focus();
      }
      pendingFocusRef.current = null;
    });
  }, [tasks]);

  return {
    caretPos,
    setCaretPos,
    resetCaretInitialized,
    setPendingFocus,
    caretOffsetFromPoint: getCaretOffsetFromPoint,
  };
}


