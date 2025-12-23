'use client';

import type React from 'react';
import type { Task } from '../app/page';

interface TaskRowProps {
  task: Task;
  index: number;
  isActive: boolean;
  dragIndex: number | null;
  indentWidth: number;
  rowRef: (el: HTMLDivElement | null) => void;
  onFocusRow: () => void;
  onMouseDownRow: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDownCapture: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  isEditing: boolean;
  editInputRef: React.RefObject<HTMLTextAreaElement>;
  editingText: string;
  onChangeEditingText: (value: string) => void;
  onTextareaKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaBlur: () => void;
  onTextClick: (e: React.MouseEvent<HTMLSpanElement>) => void;
  onDelete: () => void;
}

const DragHandle = ({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) => (
  <div
    onPointerDown={onPointerDown}
    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground select-none self-center touch-none"
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
  editInputRef,
  editingText,
  onChangeEditingText,
  onTextareaKeyDown,
  onTextareaBlur,
  onTextClick,
  onDelete,
}: TaskRowProps) {
  return (
    <div
      ref={rowRef}
      role="listitem"
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocusRow}
      onMouseDown={onMouseDownRow}
      onKeyDownCapture={onKeyDownCapture}
      className={`group flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card
        ${dragIndex === index ? 'ring-2 ring-ring shadow-lg' : ''}
        ${isActive && dragIndex !== index ? 'ring-1 ring-border' : ''}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
      `}
    >
      {/* Indent rail */}
      <div style={{ width: task.indent * indentWidth }} className="flex">
        {Array.from({ length: task.indent }).map((_, i) => (
          <div key={i} className="w-1 mx-[6px] bg-border rounded" />
        ))}
      </div>

      <DragHandle onPointerDown={onPointerDown} />

      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        className="h-5 w-5 accent-muted-foreground"
      />

      {isEditing ? (
        <textarea
          ref={editInputRef}
          value={editingText}
          rows={1}
          onChange={e => {
            onChangeEditingText(e.target.value);
            e.currentTarget.style.height = 'auto';
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
          }}
          onKeyDown={onTextareaKeyDown}
          onBlur={onTextareaBlur}
          className="flex-1 min-w-0 bg-transparent text-lg resize-none overflow-hidden focus:outline-none
                     whitespace-pre-wrap break-words overflow-wrap-anywhere"
        />
      ) : (
        <span
          onClick={onTextClick}
          className="flex-1 min-w-0 text-lg cursor-text whitespace-pre-wrap
                     break-words overflow-wrap-anywhere"
        >
          {task.text}
        </span>
      )}

      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
      >
        🗑️
      </button>
    </div>
  );
}

