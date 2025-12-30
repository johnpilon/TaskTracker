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
function removeRange<T>(array: T[], start: number, endExclusive: number): T[] {
  return [...array.slice(0, start), ...array.slice(endExclusive)];
}

/**
 * Insert items into an array at a given index.
 */
function insertRange<T>(array: T[], insertIndex: number, items: T[]): T[] {
  return [
    ...array.slice(0, insertIndex),
    ...items,
    ...array.slice(insertIndex),
  ];
}

/**
 * Compute the maximum allowed base indent based on the neighbor above the insertion point.
 * Rule: A task at indent d>0 must have a parent candidate above it with indent == d-1.
 * Simplified: base indent cannot exceed (indent of previous item + 1).
 */
function getMaxAllowedIndent<T extends { indent: number }>(
  collapsedTasks: T[],
  insertIndex: number,
  maxIndent: number
): number {
  if (insertIndex <= 0 || collapsedTasks.length === 0) {
    return 0; // First item must have indent 0
  }
  const prevIndent = collapsedTasks[insertIndex - 1]?.indent ?? -1;
  return prevIndent < 0 ? 0 : Math.min(maxIndent, prevIndent + 1);
}

/**
 * Apply an indent shift to all items in a block, clamping to valid range.
 * Returns the shifted items and whether any clamping occurred.
 */
function applyIndentShift<T extends { indent: number }>(
  blockItems: T[],
  indentShift: number,
  maxIndent: number
): { shiftedItems: T[]; wasClampedHigh: boolean; wasClampedLow: boolean } {
  let wasClampedHigh = false;
  let wasClampedLow = false;

  const shiftedItems = blockItems.map(item => {
    let newIndent = item.indent + indentShift;
    if (newIndent > maxIndent) {
      wasClampedHigh = true;
      newIndent = maxIndent;
    }
    if (newIndent < 0) {
      wasClampedLow = true;
      newIndent = 0;
    }
    return { ...item, indent: newIndent };
  });

  return { shiftedItems, wasClampedHigh, wasClampedLow };
}

/**
 * Check if moving the block would preserve relative child depths.
 * Returns the maximum safe indent shift that preserves structure.
 */
function getSafeIndentShift<T extends { indent: number }>(
  blockItems: T[],
  proposedShift: number,
  maxIndent: number
): number {
  if (blockItems.length === 0) return 0;

  const baseIndent = blockItems[0].indent;
  let maxChildOffset = 0;

  for (const item of blockItems) {
    const offset = item.indent - baseIndent;
    if (offset > maxChildOffset) maxChildOffset = offset;
  }

  // For right shift: limit so deepest child doesn't exceed MAX_INDENT
  if (proposedShift > 0) {
    const maxAllowedShift = maxIndent - (baseIndent + maxChildOffset);
    return Math.min(proposedShift, Math.max(0, maxAllowedShift));
  }

  // For left shift: limit so base doesn't go below 0
  if (proposedShift < 0) {
    return Math.max(proposedShift, -baseIndent);
  }

  return 0;
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

  // Refs to track drag start state
  const dragStartXRef = useRef<number>(0);
  const baseIndentRef = useRef<number>(0);
  const blockRangeRef = useRef<{ start: number; endExclusive: number; baseIndent: number; size: number }>({
    start: 0,
    endExclusive: 0,
    baseIndent: 0,
    size: 0,
  });
  const blockIdsRef = useRef<string[]>([]);
  const undoSnapshotRef = useRef<TTask[] | null>(null);

  // Configure sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
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

    if (DEBUG_DRAG) {
      console.log('=== DRAG START ===');
      console.log('Active ID:', activeId);
      console.log('Active Index:', activeIndex);
      console.log('Block:', blockRange);
      console.log('Block IDs:', blockIds);
    }

    // Store initial state
    const pointerEvent = event.activatorEvent as PointerEvent;
    dragStartXRef.current = pointerEvent?.clientX ?? 0;
    baseIndentRef.current = task.indent;
    blockRangeRef.current = blockRange;
    blockIdsRef.current = blockIds;

    // Capture undo snapshot of the entire task list (for this drag operation)
    undoSnapshotRef.current = structuredClone(tasks);

    setDragState({
      activeId,
      activeIndex,
      overIndex: activeIndex,
      deltaX: 0,
      currentIndent: task.indent,
      indentChanged: false,
      blockSize: blockRange.size,
      blockIds,
      blockedIndent: false,
    });
  }, [tasks]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { active, over, delta } = event;
    if (!active) return;

    const activeId = active.id as string;
    const overIndex = over ? tasks.findIndex(t => t.id === over.id) : null;

    // Calculate horizontal delta for indent
    const deltaX = delta.x;
    const step = Math.trunc(deltaX / INDENT_WIDTH);
    const proposedIndentShift = step;

    // Get the current block (may have shifted due to previous indent changes)
    const currentActiveIndex = tasks.findIndex(t => t.id === activeId);
    if (currentActiveIndex === -1) return;

    const block = tasks.slice(
      currentActiveIndex,
      currentActiveIndex + blockRangeRef.current.size
    );

    // Calculate safe indent shift that preserves relative depths
    const safeShift = getSafeIndentShift(block, proposedIndentShift, MAX_INDENT);
    const targetBaseIndent = Math.max(0, Math.min(MAX_INDENT, baseIndentRef.current + safeShift));
    const actualShift = targetBaseIndent - baseIndentRef.current;

    // Check if we're blocked (trying to indent right but can't)
    const blockedIndent = proposedIndentShift > 0 && safeShift < proposedIndentShift;

    // Check if overIndex is inside the dragged block (would be a no-op)
    let validOverIndex = overIndex;
    if (overIndex !== null) {
      const blockEnd = currentActiveIndex + blockRangeRef.current.size - 1;
      if (overIndex >= currentActiveIndex && overIndex <= blockEnd) {
        validOverIndex = currentActiveIndex; // Keep at current position
      }
    }

    setDragState(prev => ({
      ...prev,
      overIndex: validOverIndex !== null ? validOverIndex : prev.overIndex,
      deltaX,
      currentIndent: targetBaseIndent,
      blockedIndent,
      indentChanged: false,
    }));

    // Apply indent change to entire block if needed
    if (actualShift !== 0) {
      const currentBaseIndent = block[0]?.indent ?? 0;
      const newTargetIndent = currentBaseIndent + actualShift;
      
      // Only update if the indent actually changes
      if (newTargetIndent !== currentBaseIndent) {
        const { shiftedItems } = applyIndentShift(block, actualShift, MAX_INDENT);

        if (DEBUG_DRAG) {
          console.log(`Block indent change: shift=${actualShift}, base ${currentBaseIndent} -> ${newTargetIndent}`);
        }

        // Update all tasks in the block
        setAllTasks(prevAll => {
          const blockIdSet = new Set(blockIdsRef.current);
          let blockIdx = 0;
          return prevAll.map(t => {
            if (blockIdSet.has(t.id)) {
              return { ...t, indent: shiftedItems[blockIdx++].indent };
            }
            return t;
          });
        });

        // Update base indent ref to track cumulative changes
        baseIndentRef.current = newTargetIndent;

        // Trigger snap animation
        setDragState(prev => ({ ...prev, indentChanged: true }));
        
        if (indentAnimationRef.current) {
          clearTimeout(indentAnimationRef.current);
        }
        indentAnimationRef.current = setTimeout(() => {
          setDragState(prev => ({ ...prev, indentChanged: false }));
        }, 150);
      }
    }
  }, [tasks, INDENT_WIDTH, MAX_INDENT, setAllTasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const blockIds = blockIdsRef.current;
    const originalBlockStart = blockRangeRef.current.start;

    if (DEBUG_DRAG) {
      console.log('=== DRAG END ===');
      console.log('Active:', active?.id);
      console.log('Over:', over?.id);
      console.log('Block IDs:', blockIds);
      console.log('Original block start:', originalBlockStart);
    }

    // Determine if we should attempt reorder
    const shouldReorder = active && over && !blockIds.includes(over.id as string);

    if (shouldReorder) {
      const activeId = active.id as string;
      const overId = over.id as string;

      setAllTasks(prevAll => {
        // Extract the block items by ID (preserving order)
        const blockIdSet = new Set(blockIds);
        const blockItems: TTask[] = [];
        const withoutBlock: TTask[] = [];
        
        for (const t of prevAll) {
          if (blockIdSet.has(t.id)) {
            blockItems.push(t);
          } else {
            withoutBlock.push(t);
          }
        }

        if (blockItems.length === 0) return prevAll;

        // Find insertion point in the collapsed list
        const overIndexInCollapsed = withoutBlock.findIndex(t => t.id === overId);
        
        if (overIndexInCollapsed === -1) {
          // Over item not found in collapsed list, no-op
          if (DEBUG_DRAG) {
            console.log('Over item not found in collapsed list');
          }
          return prevAll;
        }

        // Determine drop position: before or after the over item based on original positions
        const activeOriginalIndex = prevAll.findIndex(t => t.id === activeId);
        const overOriginalIndex = prevAll.findIndex(t => t.id === overId);
        
        // Insert before if dragging up, after if dragging down
        const insertIndex = activeOriginalIndex < overOriginalIndex 
          ? overIndexInCollapsed + 1  // Dragging down: insert after over item
          : overIndexInCollapsed;     // Dragging up: insert before over item
        
        // Clamp insert index
        const safeInsertIndex = Math.max(0, Math.min(withoutBlock.length, insertIndex));

        if (DEBUG_DRAG) {
          console.log(`Block reorder: ${blockItems.length} items, overIdx=${overIndexInCollapsed}, insertIdx=${safeInsertIndex}`);
          console.log(`Active orig: ${activeOriginalIndex}, Over orig: ${overOriginalIndex}`);
        }

        // Check neighbor constraint for indent
        const maxAllowed = getMaxAllowedIndent(withoutBlock, safeInsertIndex, MAX_INDENT);
        const currentBaseIndent = blockItems[0]?.indent ?? 0;

        let finalBlock = blockItems;
        if (currentBaseIndent > maxAllowed) {
          // Need to adjust indent to satisfy neighbor constraint
          const adjustment = maxAllowed - currentBaseIndent;
          const { shiftedItems } = applyIndentShift(blockItems, adjustment, MAX_INDENT);
          finalBlock = shiftedItems;
        }

        // Insert the block at the new position
        const result = insertRange(withoutBlock, safeInsertIndex, finalBlock);
        
        // Check if anything actually changed
        const changed = result.some((t, i) => prevAll[i]?.id !== t.id);
        if (!changed) {
          if (DEBUG_DRAG) console.log('No actual change in order');
          return prevAll;
        }
        
        return result;
      });
    }

    // Push undo snapshot only if changes were made (indent changes during drag)
    // We already capture the snapshot at drag start, so push it now
    if (undoSnapshotRef.current) {
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
    dragStartXRef.current = 0;
    baseIndentRef.current = 0;
    blockRangeRef.current = { start: 0, endExclusive: 0, baseIndent: 0, size: 0 };
    blockIdsRef.current = [];
    undoSnapshotRef.current = null;
    if (indentAnimationRef.current) {
      clearTimeout(indentAnimationRef.current);
      indentAnimationRef.current = null;
    }
  }, [setAllTasks, setUndoStack, MAX_INDENT]);

  const handleDragCancel = useCallback(() => {
    if (DEBUG_DRAG) {
      console.log('=== DRAG CANCEL ===');
    }

    // Restore from undo snapshot on cancel
    if (undoSnapshotRef.current) {
      setAllTasks(undoSnapshotRef.current);
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
    dragStartXRef.current = 0;
    baseIndentRef.current = 0;
    blockRangeRef.current = { start: 0, endExclusive: 0, baseIndent: 0, size: 0 };
    blockIdsRef.current = [];
    undoSnapshotRef.current = null;
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
