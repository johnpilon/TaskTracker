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

const DEBUG_DRAG = false; // Set to true for debugging

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
  indentChanged: boolean; // Brief flag for snap animation
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
  });

  // Ref for indent change animation timeout
  const indentAnimationRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to track drag start state (for indent calculation)
  const dragStartXRef = useRef<number>(0);
  const baseIndentRef = useRef<number>(0);
  const undoSnapshotTakenRef = useRef<boolean>(false);

  // Configure sensors - require small movement before drag activates
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required
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

    if (DEBUG_DRAG) {
      console.log('=== DRAG START ===');
      console.log('Active ID:', activeId);
      console.log('Active Index:', activeIndex);
      console.log('Task:', (task as any).text);
    }

    // Store initial X position for indent calculation
    const pointerEvent = event.activatorEvent as PointerEvent;
    dragStartXRef.current = pointerEvent?.clientX ?? 0;
    baseIndentRef.current = task.indent;
    undoSnapshotTakenRef.current = false;

    setDragState({
      activeId,
      activeIndex,
      overIndex: activeIndex,
      deltaX: 0,
      currentIndent: task.indent,
      indentChanged: false,
    });
  }, [tasks]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { active, over, delta } = event;
    if (!active) return;

    const activeId = active.id as string;
    const activeIndex = tasks.findIndex(t => t.id === activeId);
    const overIndex = over ? tasks.findIndex(t => t.id === over.id) : activeIndex;

    // Calculate horizontal delta for indent
    const deltaX = delta.x;

    // Handle indent changes during drag
    const step = Math.trunc(deltaX / INDENT_WIDTH);
    const task = activeIndex !== -1 ? tasks[activeIndex] : null;
    const targetIndent = task 
      ? Math.max(0, Math.min(MAX_INDENT, baseIndentRef.current + step))
      : null;

    setDragState(prev => ({
      ...prev,
      overIndex: overIndex !== -1 ? overIndex : prev.overIndex,
      deltaX,
      currentIndent: targetIndent,
      indentChanged: false, // Will be set to true below if indent actually changes
    }));

    if (task && targetIndent !== null && targetIndent !== task.indent) {
      // Take undo snapshot before first mutation
      if (!undoSnapshotTakenRef.current) {
        undoSnapshotTakenRef.current = true;
        setUndoStack(stack => [
          ...stack,
          {
            type: 'indent',
            task: structuredClone(task),
          } as TUndoAction,
        ]);
      }

      if (DEBUG_DRAG) {
        console.log(`Indent change: ${task.indent} -> ${targetIndent}`);
      }

      // Update the task indent
      setAllTasks(prevAll => {
        return prevAll.map(t =>
          t.id === activeId ? { ...t, indent: targetIndent } : t
        );
      });

      // Trigger snap animation
      setDragState(prev => ({ ...prev, indentChanged: true }));
      
      // Clear the animation flag after a short delay
      if (indentAnimationRef.current) {
        clearTimeout(indentAnimationRef.current);
      }
      indentAnimationRef.current = setTimeout(() => {
        setDragState(prev => ({ ...prev, indentChanged: false }));
      }, 150);
    }
  }, [tasks, INDENT_WIDTH, MAX_INDENT, setAllTasks, setUndoStack]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (DEBUG_DRAG) {
      console.log('=== DRAG END ===');
      console.log('Active:', active?.id);
      console.log('Over:', over?.id);
    }

    if (active && over && active.id !== over.id) {
      const activeId = active.id as string;
      const overId = over.id as string;

      setAllTasks(prevAll => {
        // Find indices in the full task list
        const oldIndex = prevAll.findIndex(t => t.id === activeId);
        const newIndex = prevAll.findIndex(t => t.id === overId);

        if (oldIndex === -1 || newIndex === -1) return prevAll;

        if (DEBUG_DRAG) {
          console.log(`Reorder: ${oldIndex} -> ${newIndex}`);
        }

        // Perform the reorder
        const next = [...prevAll];
        const [moved] = next.splice(oldIndex, 1);
        next.splice(newIndex, 0, moved);

        return next;
      });
    }

    // Reset drag state
    setDragState({
      activeId: null,
      activeIndex: null,
      overIndex: null,
      deltaX: 0,
      currentIndent: null,
      indentChanged: false,
    });
    dragStartXRef.current = 0;
    baseIndentRef.current = 0;
    undoSnapshotTakenRef.current = false;
    if (indentAnimationRef.current) {
      clearTimeout(indentAnimationRef.current);
      indentAnimationRef.current = null;
    }
  }, [setAllTasks]);

  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    if (DEBUG_DRAG) {
      console.log('=== DRAG CANCEL ===');
    }

    setDragState({
      activeId: null,
      activeIndex: null,
      overIndex: null,
      deltaX: 0,
      currentIndent: null,
      indentChanged: false,
    });
    dragStartXRef.current = 0;
    baseIndentRef.current = 0;
    undoSnapshotTakenRef.current = false;
    if (indentAnimationRef.current) {
      clearTimeout(indentAnimationRef.current);
      indentAnimationRef.current = null;
    }
  }, []);

  return {
    // DndContext props
    sensors,
    collisionDetection: closestCenter,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    // State for UI feedback
    dragState,
    // Helpers
    disabled,
  };
}

// ============================================================================
// Hook: useSortableTask (wrapper around useSortable)
// ============================================================================

export function useSortableTask(
  id: string, 
  disabled: boolean = false,
  snapGridX: number = 0 // If > 0, snap horizontal movement to this grid size
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
  let justSnapped = false;
  if (transform && snapGridX > 0) {
    const snappedX = Math.round(transform.x / snapGridX) * snapGridX;
    // Check if we're near a snap point (within 3px means we just snapped)
    justSnapped = Math.abs(transform.x - snappedX) < 3 && snappedX !== 0;
    snappedTransform = {
      ...transform,
      x: snappedX,
    };
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(snappedTransform),
    // Quick, snappy transition
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
      ...listeners, // Include listeners for drag activation
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
