'use client';

import React, { useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Task } from '../app/page';
import { highlightMatches } from '../lib/highlightMatches';

interface TaskRowProps {
  task: Task;
  index: number;
  isActive: boolean;
  dragIndex: number | null;
  indentWidth: number;
  // NOTE: These are runtime-only callbacks/refs coming from the parent client component.
  // We intentionally type-erase them to satisfy Next.js "client boundary" serializable-props checks.
  rowRef: unknown;
  onFocusRow: unknown;
  onMouseDownRow: unknown;
  onKeyDownCapture: unknown;
  onPointerDown: unknown;
  onToggle: unknown;
  isEditing: boolean;
  editingText: string;
  editInputRef?: unknown;
  onChangeEditingText: unknown;
  onTextareaKeyDown: unknown;
  onTextareaBlur: unknown;
  onTextClick: unknown;
  searchQuery: string;
  onDelete: unknown;
}

const DragHandle = ({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) => (
  <div
    onPointerDown={onPointerDown}
    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground select-none self-start mt-[2px] touch-none"
    title="Drag to reorder. Drag left/right to indent."
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
);

export default function TaskRow({
  task,
  index,
  isActive,
  dragIndex,
  indentWidth,
  rowRef,
  onFocusRow,
  onMouseDownRow,
  onKeyDownCapture,
  onPointerDown,
  onToggle,
  isEditing,
  editingText,
  editInputRef,
  onChangeEditingText,
  onTextareaKeyDown,
  onTextareaBlur,
  onTextClick,
  searchQuery,
  onDelete,
}: TaskRowProps) {
  const completedClass = task.completed
    ? 'text-muted-foreground line-through'
    : '';

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    (onChangeEditingText as any)(e.target.value);
    e.currentTarget.style.height = 'auto';
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const el = (editInputRef as any)?.current as HTMLTextAreaElement | null | undefined;
    if (!isEditing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [isEditing, editingText, editInputRef]);

  return (
    <div
      ref={rowRef as any}
      role="listitem"
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocusRow as any}
      onMouseDown={onMouseDownRow as any}
      onKeyDownCapture={onKeyDownCapture as any}
      className={`group relative flex items-start gap-3 rounded-lg px-4 py-3 bg-card focus:outline-none
        outline outline-1 outline-border
      `}
    >
      <div
        aria-hidden
        className={`
          pointer-events-none absolute inset-0 rounded-lg
          transition-shadow
          ${dragIndex === index ? 'shadow-[0_0_0_2px_var(--ring)] shadow-lg' : ''}
          ${isActive && dragIndex !== index ? 'shadow-[0_0_0_1px_var(--border)]' : ''}
          group-focus-visible:shadow-[0_0_0_2px_var(--ring)]
        `}
      />

      {/* Indent rail */}
      <div
        style={{ width: task.indent * indentWidth }}
        className="flex self-start mt-[6px]"
      >
        {Array.from({ length: task.indent }).map((_, i) => (
          <div key={i} className="w-1 mx-[6px] bg-border rounded" />
        ))}
      </div>

      <DragHandle onPointerDown={onPointerDown as any} />

      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle as any}
        className="h-5 w-5 accent-muted-foreground self-start mt-[2px]"
      />

      <div className="flex-1 min-w-0 grid">
        <textarea
          ref={editInputRef as any}
          value={isEditing ? editingText : ''}
          readOnly={!isEditing}
          tabIndex={isEditing ? 0 : -1}
          rows={1}
          onChange={isEditing ? handleChange : undefined}
          onKeyDown={isEditing ? (onTextareaKeyDown as any) : undefined}
          onBlur={isEditing ? (onTextareaBlur as any) : undefined}
          className={cn(
            'col-start-1 row-start-1',
            'w-full resize-none overflow-hidden bg-transparent text-lg p-0 m-0',
            'whitespace-pre-wrap break-words overflow-wrap-anywhere',
            'leading-[1.4]',
            'focus:outline-none',
            isEditing
              ? 'pointer-events-auto opacity-100 min-h-[1.4em]'
              : 'pointer-events-none opacity-0 min-h-0 h-0',
            completedClass
          )}
          style={{
            caretColor: 'currentColor',
            height: isEditing ? undefined : 0,
          }}
        />

        {!isEditing && (
          <div
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              (onTextClick as any)(e);
            }}
            className={cn(
              'col-start-1 row-start-1 text-lg cursor-text block w-full',
              'whitespace-pre-wrap break-words overflow-wrap-anywhere',
              'leading-[1.4] min-h-[1.4em]',
              completedClass
            )}
          >
            {task.text.length > 0
              ? searchQuery
                ? highlightMatches(task.text, searchQuery)
                : task.text
              : '\u00A0'}
          </div>
        )}
      </div>

      <button
        onClick={onDelete as any}
        aria-label="Delete task"
        type="button"
        className="opacity-0 group-hover:opacity-100 text-destructive
                   inline-flex h-9 w-9 items-center justify-center rounded-full
                   border-[3px] border-destructive/80 bg-destructive/12 shadow-sm
                   transition-colors hover:bg-destructive/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-xl leading-none font-semibold" aria-hidden>
          ×
        </span>
      </button>
    </div>
  );
}

