import { useState, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragMoveEvent,
  DragEndEvent,
  DragCancelEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DEBUG_DRAG = true; // Set to true for debugging

// ============================================================================
// Pure Helper Functions for Block Operations
// ============================================================================

/**
 * Get the block range starting at a given index.
 * A block consists of a parent task and all contiguous children (tasks with greater indent).
 */
export function getBlockRange<T extends { indent: number }>(
  tasks: T[],
  startIndex: number
): { start: number; endExclusive: number; baseIndent: number; size: number } {
  if (startIndex < 0 || startIndex >= tasks.length) {
    return { start: startIndex, endExclusive: startIndex, baseIndent: 0, size: 0 };
  }

  const baseIndent = tasks[startIndex].indent;
  let endExclusive = startIndex + 1;

  // Scan forward while indent > baseIndent (children)
  while (endExclusive < tasks.length && tasks[endExclusive].indent > baseIndent) {
    endExclusive++;
  }

  return {
    start: startIndex,
    endExclusive,
    baseIndent,
    size: endExclusive - startIndex,
  };
}

/**
 * Remove a range from an array, returning the remaining items.
 */
export function removeRange<T>(array: T[], start: number, endExclusive: number): T[] {
  return [...array.slice(0, start), ...array.slice(endExclusive)];
}

/**
 * Insert items into an array at a given index.
 */
export function insertRange<T>(array: T[], insertIndex: number, items: T[]): T[] {
  return [
    ...array.slice(0, insertIndex),
    ...items,
    ...array.slice(insertIndex),
  ];
}

/**
 * Move a contiguous block within the same array (pure).
 * targetIndex is expressed in original coordinates; internally we convert to the
 * coordinates of the remaining array after removal.
 */
export function moveBlockWithinArray<T>(
  items: T[],
  start: number,
  endExclusive: number,
  targetIndex: number
): T[] {
  if (start < 0 || endExclusive > items.length || start >= endExclusive) return items;

  const block = items.slice(start, endExclusive);
  const remaining = [...items.slice(0, start), ...items.slice(endExclusive)];

  let adjustedTarget = targetIndex;
  if (adjustedTarget > start) {
    adjustedTarget -= endExclusive - start;
  }
  adjustedTarget = Math.max(0, Math.min(adjustedTarget, remaining.length));

  return [
    ...remaining.slice(0, adjustedTarget),
    ...block,
    ...remaining.slice(adjustedTarget),
  ];
}

/**
 * Clamp base indent using neighbor rules (prev indent + 1, or 0 at start).
 */
export function clampIndentByNeighbors<T extends { indent: number }>(
  collapsedTasks: T[],
  insertIndex: number,
  proposedBaseIndent: number,
  maxIndent: number
): number {
  const prevIndent = collapsedTasks[insertIndex - 1]?.indent ?? -1;
  const neighborMax = prevIndent < 0 ? 0 : Math.min(maxIndent, prevIndent + 1);
  const clamped = Math.max(0, Math.min(proposedBaseIndent, neighborMax));
  return clamped;
}

/**
 * Set the indent for a parent block, shifting children by the same delta.
 */
export function setBlockIndent<T extends { indent: number }>(
  items: T[],
  start: number,
  endExclusive: number,
  newParentIndent: number,
  maxIndent: number
): T[] {
  if (start < 0 || endExclusive > items.length || start >= endExclusive) return items;
  const oldParentIndent = items[start].indent;
  const delta = newParentIndent - oldParentIndent;
  const next: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i < start || i >= endExclusive) {
      next.push(items[i]);
      continue;
    }
    const candidate = items[i];
    const shifted = Math.max(0, Math.min(maxIndent, candidate.indent + delta));
    next.push({ ...candidate, indent: shifted });
  }
  return next;
}

/**
 * Apply a uniform indent shift to a block while preserving relative depth.
 * The shift is clamped so that no item exceeds [0, maxIndent].
 */
export function applyIndentShift<T extends { indent: number }>(
  blockItems: T[],
  indentShift: number,
  maxIndent: number
): { shiftedItems: T[]; appliedShift: number; blocked: boolean } {
  if (blockItems.length === 0) {
    return { shiftedItems: [], appliedShift: 0, blocked: false };
  }

  const minIndent = Math.min(...blockItems.map(b => b.indent));
  const maxIndentInBlock = Math.max(...blockItems.map(b => b.indent));

  const allowedMinShift = -minIndent;
  const allowedMaxShift = maxIndent - maxIndentInBlock;

  const appliedShift = Math.min(Math.max(indentShift, allowedMinShift), allowedMaxShift);
  const blocked = indentShift !== appliedShift && indentShift > 0;

  const shiftedItems = blockItems.map(item => ({
    ...item,
    indent: item.indent + appliedShift,
  }));

  return { shiftedItems, appliedShift, blocked };
}

function isSameOrderAndIndent<T extends { id: string; indent: number }>(
  a: T[],
  b: T[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].indent !== b[i].indent) return false;
  }
  return true;
}

// ============================================================================
// Types
// ============================================================================

export interface DragControllerOptions<
  TTask extends { id: string; indent: number; listId?: string; archived?: boolean },
  TUndoAction = unknown,
> {
  tasks: TTask[];
  setAllTasks: Dispatch<SetStateAction<TTask[]>>;
  setUndoStack: Dispatch<SetStateAction<TUndoAction[]>>;
  activeListId: string;
  INDENT_WIDTH: number;
  MAX_INDENT: number;
  disabled?: boolean;
}

export interface DragState {
  activeId: string | null;
  activeIndex: number | null;
  overIndex: number | null;
  deltaX: number;
  currentIndent: number | null;
  indentChanged: boolean;
  // Block drag state
  blockSize: number;
  blockIds: string[];
  // Blocked indicator
  blockedIndent: boolean;
}

// ============================================================================
// Hook: useDragController
// ============================================================================

export function useDragController<
  TTask extends { id: string; indent: number; listId?: string; archived?: boolean },
  TUndoAction = unknown,
>(opts: DragControllerOptions<TTask, TUndoAction>) {
  const {
    tasks,
    setAllTasks,
    setUndoStack,
    activeListId,
    INDENT_WIDTH,
    MAX_INDENT,
    disabled = false,
  } = opts;

  // Drag state
  const [dragState, setDragState] = useState<DragState>({
    activeId: null,
    activeIndex: null,
    overIndex: null,
    deltaX: 0,
    currentIndent: null,
    indentChanged: false,
    blockSize: 1,
    blockIds: [],
    blockedIndent: false,
  });

  // Ref for indent change animation timeout
  const indentAnimationRef = useRef<NodeJS.Timeout | null>(null);
  const blockRangeRef = useRef<{ start: number; endExclusive: number; baseIndent: number; size: number }>({
    start: 0,
    endExclusive: 0,
    baseIndent: 0,
    size: 0,
  });
  const baseIndentStartRef = useRef<number>(0);
  const blockIdsRef = useRef<string[]>([]);
  const undoSnapshotRef = useRef<TTask[] | null>(null);
  const hasMutatedRef = useRef<boolean>(false);

  // Configure sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const applyPreviewToAllTasks = useCallback(
    (preview: TTask[]) => {
      setAllTasks(prevAll => {
        const activeIndices: number[] = [];
        for (let i = 0; i < prevAll.length; i++) {
          const t = prevAll[i];
          if (!t.archived && t.listId === activeListId) {
            activeIndices.push(i);
          }
        }

        if (activeIndices.length !== preview.length) {
          return prevAll;
        }

        const next = [...prevAll];
        for (let i = 0; i < activeIndices.length; i++) {
          next[activeIndices[i]] = preview[i];
        }
        return next;
      });
    },
    [activeListId, setAllTasks]
  );

  const projectDrag = useCallback(
    (
      sourceTasks: TTask[],
      activeId: string,
      overId: string | null,
      deltaX: number,
      overIndexOverride?: number | null,
      placeAfter?: boolean
    ):
      | {
          preview: TTask[];
          targetIndex: number;
          finalBaseIndent: number;
          blockedIndent: boolean;
          indentChanged: boolean;
          blockRange: { start: number; endExclusive: number; baseIndent: number; size: number };
          blockIds: string[];
        }
      | null => {
      const activeIndex = sourceTasks.findIndex(t => t.id === activeId);
      if (activeIndex === -1) return null;

      const blockRange = getBlockRange(sourceTasks, activeIndex);
      const block = sourceTasks.slice(blockRange.start, blockRange.endExclusive);
      const blockIds = block.map(t => t.id);

      const collapsed = removeRange(sourceTasks, blockRange.start, blockRange.endExclusive);

      const overIndexCollapsed =
        typeof overIndexOverride === 'number'
          ? overIndexOverride
          : overId
          ? collapsed.findIndex(t => t.id === overId)
          : null;

      let insertIndex = blockRange.start;
      if (overIndexCollapsed !== null && overIndexCollapsed >= 0) {
        insertIndex = overIndexCollapsed + (placeAfter ? 1 : 0);
      }

      insertIndex = Math.max(0, Math.min(insertIndex, collapsed.length));

      const proposedBaseIndent =
        baseIndentStartRef.current + Math.round(deltaX / INDENT_WIDTH);

      // Free indent clamped only by bounds; parentage not required.
      const targetBaseIndent = Math.max(0, Math.min(proposedBaseIndent, MAX_INDENT));
      const indentShiftCandidate = targetBaseIndent - blockRange.baseIndent;

      // Keep structure: avoid collapsing children or exceeding bounds.
      let lowerBound = -blockRange.baseIndent; // keep root >= 0
      let upperBound = MAX_INDENT - blockRange.baseIndent; // keep root <= MAX
      for (let i = 1; i < block.length; i++) {
        const child = block[i];
        lowerBound = Math.max(lowerBound, -child.indent);
        upperBound = Math.min(upperBound, MAX_INDENT - child.indent);
      }

      const appliedShift = Math.max(lowerBound, Math.min(indentShiftCandidate, upperBound));

      const shiftedItems = block.map(item => ({
        ...item,
        indent: Math.max(0, Math.min(MAX_INDENT, item.indent + appliedShift)),
      }));

      const finalBaseIndent = blockRange.baseIndent + appliedShift;

      const blockedByBounds =
        (proposedBaseIndent > MAX_INDENT && deltaX > 0) ||
        (proposedBaseIndent < 0 && deltaX < 0);
      const blockedByStructure = appliedShift !== indentShiftCandidate;
      const blockedIndent = blockedByBounds || blockedByStructure;

      const preview = insertRange(collapsed, insertIndex, shiftedItems);

      return {
        preview,
        targetIndex: insertIndex,
        finalBaseIndent,
        blockedIndent,
        indentChanged: appliedShift !== 0,
        blockRange,
        blockIds,
      };
    },
    [INDENT_WIDTH, MAX_INDENT]
  );

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const activeId = active.id as string;
    const activeIndex = tasks.findIndex(t => t.id === activeId);

    if (activeIndex === -1) return;

    const task = tasks[activeIndex];

    // Compute the block range (parent + children)
    const blockRange = getBlockRange(tasks, activeIndex);
    const blockIds = tasks
      .slice(blockRange.start, blockRange.endExclusive)
      .map(t => t.id);
    baseIndentStartRef.current = task.indent;

    if (DEBUG_DRAG) {
      console.log('=== DRAG START ===');
      console.log('Active ID:', activeId);
      console.log('Active Index:', activeIndex);
      console.log('Block:', blockRange);
      console.log('Block IDs:', blockIds);
    }

    // Store initial state
    blockRangeRef.current = blockRange;
    blockIdsRef.current = blockIds;

    // Capture undo snapshot of the full task list (one entry per drag)
    hasMutatedRef.current = false;
    undoSnapshotRef.current = null;
    setAllTasks(prev => {
      undoSnapshotRef.current = structuredClone(prev);
      return prev;
    });

    setDragState({
      activeId,
      activeIndex: blockRange.start,
      overIndex: activeIndex,
      deltaX: 0,
      currentIndent: task.indent,
      indentChanged: false,
      blockSize: blockRange.size,
      blockIds,
      blockedIndent: false,
    });
  }, [tasks, setAllTasks]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { active, over, delta } = event;
    if (!active) return;

    const activeId = active.id as string;
    const overId = over ? (over.id as string) : null;

    let overIndexOverride: number | null = null;
    let placeAfter = false;
    if (over) {
      const idx = tasks.findIndex(t => t.id === over.id);
      const overRect = (over as any).rect as { top: number; height: number } | undefined;
      const activeRect =
        (active.rect as any)?.current?.translated ?? (active.rect as any)?.current;
      if (overRect && activeRect) {
        const pointerY = (activeRect.top ?? 0) + (activeRect.height ?? 0) / 2;
        const overMid = (overRect.top ?? 0) + (overRect.height ?? 0) / 2;
        placeAfter = pointerY > overMid;
      }
      if (idx === tasks.length - 1 && placeAfter) {
        overIndexOverride = tasks.length; // after last item
      }
    }

    const projection = projectDrag(
      tasks,
      activeId,
      overId,
      delta.x,
      overIndexOverride,
      placeAfter
    );
    if (!projection) return;

    const {
      preview,
      targetIndex,
      finalBaseIndent,
      blockedIndent,
      indentChanged,
      blockRange,
      blockIds,
    } = projection;

    blockRangeRef.current = blockRange;
    blockIdsRef.current = blockIds;

    const didChange = !isSameOrderAndIndent(tasks, preview);
    if (didChange) {
      hasMutatedRef.current = true;
      applyPreviewToAllTasks(preview);
    }

    setDragState(prev => ({
      ...prev,
      activeIndex: blockRange.start,
      overIndex: targetIndex,
      deltaX: delta.x,
      currentIndent: finalBaseIndent,
      blockedIndent,
      indentChanged,
      blockSize: blockRange.size,
      blockIds,
    }));

    if (indentChanged) {
      if (indentAnimationRef.current) {
        clearTimeout(indentAnimationRef.current);
      }
      indentAnimationRef.current = setTimeout(() => {
        setDragState(prev => ({ ...prev, indentChanged: false }));
      }, 150);
    }
  }, [tasks, projectDrag, applyPreviewToAllTasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event;

    if (active) {
      const activeId = active.id as string;
      const overId = over ? (over.id as string) : null;

      let overIndexOverride: number | null = null;
      let placeAfter = false;
      if (over) {
        const idx = tasks.findIndex(t => t.id === over.id);
        const overRect = (over as any).rect as { top: number; height: number } | undefined;
        const activeRect =
          (active.rect as any)?.current?.translated ?? (active.rect as any)?.current;
        if (overRect && activeRect) {
          const pointerY = (activeRect.top ?? 0) + (activeRect.height ?? 0) / 2;
          const overMid = (overRect.top ?? 0) + (overRect.height ?? 0) / 2;
          placeAfter = pointerY > overMid;
        }
        if (idx === tasks.length - 1 && placeAfter) {
          overIndexOverride = tasks.length; // after last item
        }
      }

      const projection = projectDrag(
        tasks,
        activeId,
        overId,
        delta.x,
        overIndexOverride,
        placeAfter
      );

      if (projection) {
        const { preview, blockRange, blockIds } = projection;
        blockRangeRef.current = blockRange;
        blockIdsRef.current = blockIds;

        const didChange = !isSameOrderAndIndent(tasks, preview);
        if (didChange) {
          hasMutatedRef.current = true;
          applyPreviewToAllTasks(preview);
        }
      }
    }

    if (undoSnapshotRef.current && hasMutatedRef.current) {
      const snapshot = undoSnapshotRef.current;
      setUndoStack(stack => [
        ...stack,
        {
          type: 'drag',
          tasks: snapshot,
        } as TUndoAction,
      ]);
    }

    // Reset drag state
    setDragState({
      activeId: null,
      activeIndex: null,
      overIndex: null,
      deltaX: 0,
      currentIndent: null,
      indentChanged: false,
      blockSize: 1,
      blockIds: [],
      blockedIndent: false,
    });
    blockRangeRef.current = { start: 0, endExclusive: 0, baseIndent: 0, size: 0 };
    baseIndentStartRef.current = 0;
    blockIdsRef.current = [];
    undoSnapshotRef.current = null;
    hasMutatedRef.current = false;
    if (indentAnimationRef.current) {
      clearTimeout(indentAnimationRef.current);
      indentAnimationRef.current = null;
    }
  }, [tasks, projectDrag, applyPreviewToAllTasks, setUndoStack]);

  const handleDragCancel = useCallback(() => {
    if (DEBUG_DRAG) {
      console.log('=== DRAG CANCEL ===');
    }

    // Restore from undo snapshot on cancel
    if (undoSnapshotRef.current) {
      setAllTasks(() => undoSnapshotRef.current as TTask[]);
    }

    // Reset drag state
    setDragState({
      activeId: null,
      activeIndex: null,
      overIndex: null,
      deltaX: 0,
      currentIndent: null,
      indentChanged: false,
      blockSize: 1,
      blockIds: [],
      blockedIndent: false,
    });
    blockRangeRef.current = { start: 0, endExclusive: 0, baseIndent: 0, size: 0 };
    baseIndentStartRef.current = 0;
    blockIdsRef.current = [];
    undoSnapshotRef.current = null;
    hasMutatedRef.current = false;
    if (indentAnimationRef.current) {
      clearTimeout(indentAnimationRef.current);
      indentAnimationRef.current = null;
    }
  }, [setAllTasks]);

  return {
    sensors,
    collisionDetection: closestCenter,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    dragState,
    disabled,
  };
}

// ============================================================================
// Hook: useSortableTask (wrapper around useSortable)
// ============================================================================

export function useSortableTask(
  id: string, 
  disabled: boolean = false,
  snapGridX: number = 0
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, disabled });

  // Snap horizontal movement to grid if specified
  let snappedTransform = transform;
  if (transform && snapGridX > 0) {
    const snappedX = Math.round(transform.x / snapGridX) * snapGridX;
    snappedTransform = {
      ...transform,
      x: snappedX,
    };
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(snappedTransform),
    transition: isDragging 
      ? 'transform 30ms cubic-bezier(0.25, 0.1, 0.25, 1)' 
      : transition,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return {
    sortableProps: {
      ref: setNodeRef,
      style,
      ...attributes,
      ...listeners,
    },
    dragHandleProps: listeners,
    isDragging,
    isOver,
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { DndContext, SortableContext, verticalListSortingStrategy };
