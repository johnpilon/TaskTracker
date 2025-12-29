'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { Task } from '../app/page';
import { highlightMatches } from '../lib/highlightMatches';

interface TaskRowProps {
  task: Task;
  index: number;
  isActive: boolean;
  dragIndex: number | null;
  dragTargetIndex?: number | null;
  effectiveIndent: number;
  indentWidth: number;
  isEntryRow?: boolean;
  containerClassName?: string;
  activeTags?: string[];
  onTagClick?: unknown;
  onRemoveTag?: unknown;
  onToggleMomentum?: unknown;
  rowRef: unknown;
  onFocusRow: unknown;
  onMouseDownRow: unknown;
  onKeyDownCapture: unknown;
  onPointerDown: unknown;
  onToggleCompleted: unknown;
  isEditing: boolean;
  editingText: string;
  editInputRef?: unknown;
  onChangeEditingText: unknown;
  onTextareaKeyDown: unknown;
  onTextareaBlur: unknown;
  onTextClick: unknown;
  searchQuery: string;
  onDelete: unknown;
  movingTaskId?: string | null;
  availableLists?: Array<{ id: string; name: string }>;
  onShowMoveList?: () => void;
  onMoveToList?: (targetListId: string) => void;
  onCancelMove?: () => void;
}

/* ---------- Layout invariants ---------- */
const ROW_LINE_HEIGHT = 22;     // integer px avoids subpixel jitter
const ROW_MIN_HEIGHT = 44;
const TAG_ROW_HEIGHT = 14;

export default function TaskRow({
  task,
  index,
  isActive,
  dragIndex,
  dragTargetIndex,
  effectiveIndent,
  indentWidth,
  isEntryRow,
  containerClassName,
  activeTags,
  onTagClick,
  onRemoveTag,
  onToggleMomentum,
  rowRef,
  onFocusRow,
  onMouseDownRow,
  onKeyDownCapture,
  onPointerDown,
  onToggleCompleted,
  isEditing,
  editingText,
  editInputRef,
  onChangeEditingText,
  onTextareaKeyDown,
  onTextareaBlur,
  onTextClick,
  searchQuery,
  onDelete,
  movingTaskId,
  availableLists,
  onShowMoveList,
  onMoveToList,
  onCancelMove,
}: TaskRowProps) {
  const internalRowRef = useRef<HTMLDivElement | null>(null);

  const completedClass = task.completed ? 'text-muted-foreground line-through' : '';
  const completedOpacityClass = task.completed ? 'opacity-70' : '';

  const isEntryRowEmpty = isEntryRow && task.text.trim().length === 0;

  /* ---------- Autosize textarea (grow only) ---------- */
  const autosizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = `${ROW_LINE_HEIGHT}px`;
    if (el.scrollHeight > ROW_LINE_HEIGHT + 2) {
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    (onChangeEditingText as any)(e.target.value);
    autosizeTextarea(e.currentTarget);
  };

  useLayoutEffect(() => {
    const el = (editInputRef as any)?.current as HTMLTextAreaElement | null;
    if (isEditing && el) autosizeTextarea(el);
  }, [isEditing, editingText, editInputRef]);

  return (
    <div
      ref={el => {
        internalRowRef.current = el;
        if (typeof rowRef === 'function') (rowRef as any)(el);
      }}
      role="listitem"
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocusRow as any}
      onMouseDown={onMouseDownRow as any}
      onKeyDownCapture={onKeyDownCapture as any}
      className={cn(
        'group relative flex items-start gap-1 px-2 pr-8',
        isEntryRow ? 'py-2' : 'py-1.5',          // entry row keeps taller feel
        'box-border bg-transparent',
        'contain-layout contain-paint',          // stops reflow jitter
        `min-h-[${ROW_MIN_HEIGHT}px]`,
        !isEntryRow && 'hover:bg-muted/8',
        completedOpacityClass,
        containerClassName
      )}
    >
      {/* Selection / focus ring - hidden during drag */}
      {(isActive || isEditing) && !isEntryRow && dragIndex === null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-primary/60"
        />
      )}

      {/* Drag source indicator - dim the original position */}
      {dragIndex !== null && dragIndex === index && dragTargetIndex !== index && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-muted/30 rounded-sm"
        />
      )}

      {/* Drag target indicator - highlight where item currently is */}
      {dragTargetIndex !== null && dragTargetIndex === index && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 shadow-[0_0_0_2px_hsl(var(--primary))] rounded-sm bg-primary/5"
        />
      )}

      {/* Drop indicator line - shows above the target row */}
      {dragTargetIndex !== null && dragTargetIndex === index && dragIndex !== null && dragIndex !== index && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[2px] left-2 right-2 h-1 bg-primary rounded-full"
        />
      )}

      {/* Indent spacing */}
      <div style={{ width: effectiveIndent * indentWidth }} className="flex self-start mt-[2px]" />

      {!isEntryRow && (
        <>
          <div className="w-5 self-start mt-[2px] mr-1 flex items-start justify-center">
            <div
              onPointerDown={onPointerDown as any}
              className={cn(
                'cursor-grab active:cursor-grabbing select-none touch-none',
                'opacity-0 pointer-events-none',
                'group-hover:opacity-60 group-hover:pointer-events-auto',
                'group-focus-within:opacity-60 group-focus-within:pointer-events-auto',
                '[@media(hover:none)]:opacity-60 [@media(hover:none)]:pointer-events-auto',
                'text-muted-foreground hover:text-foreground'
              )}
              data-no-edit
            >
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                <circle cx="3" cy="3" r="1.5" />
                <circle cx="9" cy="3" r="1.5" />
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="9" cy="8" r="1.5" />
                <circle cx="3" cy="13" r="1.5" />
                <circle cx="9" cy="13" r="1.5" />
              </svg>
            </div>
          </div>

          <input
            type="checkbox"
            checked={task.completed}
            onChange={onToggleCompleted as any}
            className="h-4 w-4 accent-muted-foreground self-start mt-[2px]"
            data-no-edit
          />
        </>
      )}

      <div className="flex-1 min-w-0">
        {/* Baseline line */}
        <div
          className={cn(
            'text-base font-normal flex items-center gap-1',
            isEditing ? 'overflow-visible' : 'whitespace-nowrap overflow-hidden',
            !isEditing && task.text.trim().length === 0 && 'text-muted-foreground/55',
            completedClass
          )}
          style={{
            height: ROW_LINE_HEIGHT,
            lineHeight: `${ROW_LINE_HEIGHT}px`,
          }}
        >
          {!isEntryRow && (
            <button
              type="button"
              onClick={onToggleMomentum as any}
              data-no-edit
              className={cn(
                'inline-flex w-4 h-4 items-center justify-center shrink-0',
                task.momentum
                  ? 'opacity-100'
                  : cn(
                      'opacity-0 pointer-events-none',
                      'group-hover:opacity-100 group-hover:pointer-events-auto',
                      (isActive || isEditing) && 'opacity-100 pointer-events-auto'
                    )
              )}
            >
              <span
                className={cn(
                  'block rounded-full h-2 w-2',
                  task.momentum ? 'bg-primary/70' : 'border border-primary/30'
                )}
              />
            </button>
          )}

          {isEditing ? (
            <textarea
              ref={editInputRef as any}
              value={editingText}
              rows={1}
              onChange={handleChange}
              onKeyDown={onTextareaKeyDown as any}
              onBlur={onTextareaBlur as any}
              className="flex-1 min-w-0 p-0 m-0 border-0 outline-none resize-none bg-transparent"
              style={{
                height: ROW_LINE_HEIGHT,
                lineHeight: `${ROW_LINE_HEIGHT}px`,
              }}
            />
          ) : (
            <div
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                (onTextClick as any)(e);
              }}
              className="flex-1 min-w-0 truncate cursor-text"
            >
              {task.text.trim().length > 0 ? (
                activeTags?.length
                  ? task.text
                  : searchQuery
                    ? highlightMatches(task.text, searchQuery)
                    : task.text
              ) : isEntryRowEmpty ? (
                <span className="text-muted-foreground/45">Add item…</span>
              ) : task.tags && task.tags.length > 0 ? (
                <span
                  className="text-muted-foreground/50 italic text-[0.95em]"
                  aria-hidden
                >
                  {task.tags.map(t => `#${t}`).join(' ')}
                </span>
              ) : (
                '\u00A0'
              )}

            </div>
          )}
        </div>

{/* Tag row (space always reserved) */}
<div style={{ height: TAG_ROW_HEIGHT }} className="mt-0.5">
  {!isEntryRow && task.tags?.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-primary/45">
      {task.tags.map(tag => (
        <span
          key={tag}
          className="group inline-flex items-center gap-1"
        >
          <button
            type="button"
            className="hover:underline underline-offset-2"
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              (onTagClick as any)?.(tag);
            }}
          >
            #{tag}
          </button>

          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              (onRemoveTag as any)?.(tag);
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )}
</div>

      </div>

      {!isEntryRow && (
        <div className="absolute right-2 top-[6px] flex items-center gap-2">
          <button
            type="button"
            onClick={onShowMoveList as any}
            data-no-edit
            className="px-2 py-1 text-[11px] rounded bg-muted/40 text-muted-foreground/80 hover:text-foreground hover:bg-muted/70 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Move
          </button>
          <button
            onClick={onDelete as any}
            data-no-edit
            className="opacity-0 group-hover:opacity-100 text-muted-foreground/70 hover:text-destructive"
          >
            ×
          </button>
        </div>
      )}

      {!isEntryRow &&
        movingTaskId === task.id &&
        availableLists &&
        availableLists.length > 0 && (
          <div className="absolute right-2 top-10 z-20 rounded border border-border bg-popover shadow-lg p-1 text-xs min-w-[140px] space-y-1">
            {availableLists.map(list => (
              <button
                key={list.id}
                type="button"
                className="w-full text-left px-2 py-1 rounded hover:bg-muted"
                onClick={() => (onMoveToList as any)?.(list.id)}
              >
                {list.name}
              </button>
            ))}
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded text-muted-foreground hover:bg-muted"
              onClick={onCancelMove as any}
            >
              Cancel
            </button>
          </div>
        )}
    </div>
  );
}
