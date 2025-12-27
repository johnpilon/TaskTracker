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
  effectiveIndent: number;
  indentWidth: number;
  isEntryRow?: boolean;
  containerClassName?: string;
  activeTags?: string[];
  onTagClick?: unknown;
  onRemoveTag?: unknown;
  onToggleMomentum?: unknown;
  // NOTE: These are runtime-only callbacks/refs coming from the parent client component.
  // We intentionally type-erase them to satisfy Next.js "client boundary" serializable-props checks.
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
}

export default function TaskRow({
  task,
  index,
  isActive,
  dragIndex,
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
}: TaskRowProps) {
  const internalRowRef = useRef<HTMLDivElement | null>(null);
  const lastLoggedRef = useRef<{ isEditing: boolean; height: number } | null>(null);

  const completedClass = task.completed
    ? 'text-muted-foreground line-through'
    : '';

  const completedOpacityClass = task.completed ? 'opacity-70' : '';
  // Avoid making the empty capture row look "selected" when idle.
  // It should feel like an invitation, not a selection target.
  const activeRowClass = (isActive || isEditing) && !(isEntryRow && !isEditing) ? 'bg-muted/12' : '';
  const isEntryRowEmpty = isEntryRow === true && task.text.trim().length === 0;
  const entryRowAffordanceClass =
    isEntryRowEmpty && !isEditing
      ? // Neutral subtle border (NOT blue), no fill.
        'ring-1 ring-muted-foreground/20 hover:ring-muted-foreground/30 cursor-text'
      : '';

  const isTagsOnlyRow =
    !isEntryRow &&
    task.text.trim().length === 0 &&
    (task.tags?.length ?? 0) > 0;

  // Active tag emphasis is semantic (token-based), not substring search-based.
  const renderTextWithActiveTags = (text: string) => {
    const active = new Set((activeTags ?? []).map(t => t.toLowerCase()));
    if (active.size === 0) return text;

    const parts: Array<string | React.ReactElement> = [];
    const TAG_TOKEN_REGEX = /(^|\s)(#[a-zA-Z0-9_-]+)/g;

    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_TOKEN_REGEX.exec(text))) {
      const leading = m[1] ?? '';
      const token = m[2] ?? '';
      const tokenStart = m.index + leading.length;
      const tokenEnd = tokenStart + token.length;

      if (tokenStart > lastIndex) {
        parts.push(text.slice(lastIndex, tokenStart));
      }

      const normalized = token.slice(1).toLowerCase();
      if (active.has(normalized)) {
        // Active tags are emphasized to reflect the current composed view.
        parts.push(
          <mark
            key={`${tokenStart}-${tokenEnd}`}
            // Highlight intensity reflects semantic strength:
            // search match < active tag
            className="bg-primary/[0.28] ring-2 ring-primary/[0.45] rounded px-0.5 text-primary dark:text-primary-foreground"
          >
            {token}
          </mark>
        );
      } else {
        parts.push(token);
      }

      lastIndex = tokenEnd;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  // Tags are entry points into tag views via search-as-lens.
  // Clicking a tag simply populates the search query.
  const handleToggleMomentum = () => {
    if (!onToggleMomentum) return;
    (onToggleMomentum as any)();
  };

  const handleTagClick = (tag: string) => {
    if (!onTagClick) return;
    (onTagClick as any)(tag);
  };

  const handleRemoveTag = (tag: string) => {
    if (!onRemoveTag) return;
    (onRemoveTag as any)(tag);
  };

  const visibleTitle = task.text.trim();

  const autosizeTextarea = (el: HTMLTextAreaElement) => {
    // STRICT layout stability:
    // For single-line content, do NOT set an inline height at all (let CSS baseline control it),
    // because some browsers report scrollHeight slightly larger than one line and cause a jump.
    // Only apply an explicit height when content truly needs multiple lines.
    el.style.height = 'auto';

    const cs = window.getComputedStyle(el);
    const lineHeightPx = Number.parseFloat(cs.lineHeight);
    const baseline = Number.isFinite(lineHeightPx) ? lineHeightPx : 0;
    const scroll = el.scrollHeight;

    if (baseline > 0 && scroll <= baseline + 2) {
      // Keep baseline sizing from CSS (h/min-h) and avoid pixel drift.
      el.style.height = '';
      return;
    }

    el.style.height = `${scroll}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    (onChangeEditingText as any)(e.target.value);
    autosizeTextarea(e.currentTarget);
  };

  useLayoutEffect(() => {
    const el = (editInputRef as any)?.current as HTMLTextAreaElement | null | undefined;
    if (!isEditing || !el) return;
    autosizeTextarea(el);
  }, [isEditing, editingText, editInputRef]);

  useLayoutEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const el = internalRowRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    const prev = lastLoggedRef.current;
    if (!prev || prev.isEditing !== isEditing) {
      // Verification: inactive vs active row height should be identical.
      // Compare logs for the same task id across state transitions.
      // eslint-disable-next-line no-console
      console.log('[RowHeight]', { id: task.id, isEditing, height: h });
      lastLoggedRef.current = { isEditing, height: h };
    }
  }, [isEditing, task.id]);

  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        internalRowRef.current = el;
        if (typeof rowRef === 'function') {
          (rowRef as any)(el);
        }
      }}
      role="listitem"
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocusRow as any}
      onMouseDown={onMouseDownRow as any}
      onKeyDownCapture={onKeyDownCapture as any}
      className={cn(
        // Flat, text-line feel (no card chrome)
        'group relative flex items-start gap-1 px-2 py-1.5 pr-8 focus:outline-none',
        'bg-transparent',
        // Subtle hover highlight only (not for the persistent entry row, which should read as an input field)
        !isEntryRow ? 'hover:bg-muted/8' : '',
        activeRowClass,
        entryRowAffordanceClass,
        // Editing affordance: visible, non-shifting ring (row-level, not input-level)
        isEditing ? 'ring-1 ring-ring/55' : '',
        completedOpacityClass,
        containerClassName
      )}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0',
          dragIndex === index ? 'shadow-[0_0_0_2px_hsl(var(--ring))]' : '',
          'group-focus-visible:shadow-[0_0_0_2px_hsl(var(--ring))]'
        )}
      />

      {/* Indent spacing */}
      <div
        style={{ width: effectiveIndent * indentWidth }}
        className="flex self-start mt-[2px]"
      >
        {/* Keep indentation spacing without extra visual noise */}
      </div>

      {/* Controls: NEVER render for the persistent entry row */}
      {!isEntryRow && (
        <>
          {/* Drag handle slot: reserves space so content never shifts. */}
          <div className="w-5 self-start mt-[2px] mr-1 flex items-start justify-center">
            <div
              onPointerDown={onPointerDown as any}
              className={cn(
                'cursor-grab active:cursor-grabbing select-none touch-none',
                // Hidden by default; visible on hover/focus. Always available on touch.
                'opacity-0 pointer-events-none',
                'group-hover:opacity-60 group-hover:pointer-events-auto',
                'group-focus-within:opacity-60 group-focus-within:pointer-events-auto',
                '[@media(hover:none)]:opacity-60 [@media(hover:none)]:pointer-events-auto',
                'text-muted-foreground hover:text-foreground'
              )}
              data-no-edit
            >
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
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

      <div
        className={cn(
          'flex-1 min-w-0',
          // Entry row is an input surface (no controls), so text should start naturally at the left.
          // We intentionally do NOT reserve space for handle/checkbox/momentum here.
          ''
        )}
      >
        <div
          className={cn(
            'text-base font-normal w-full min-w-0',
            'flex items-center gap-1',
            isEditing ? 'overflow-visible' : 'whitespace-nowrap overflow-hidden',
            'leading-[1.32] min-h-[1.32em]',
            // Tag-only rows should read as subdued metadata (display mode only).
            !isEditing && visibleTitle.length === 0 ? 'text-muted-foreground/55' : '',
            completedClass
          )}
        >
          {/* Momentum indicator: NEVER render for the persistent entry row */}
          {!isEntryRow && (
            <button
              type="button"
              aria-label={task.momentum === true ? 'Remove Momentum' : 'Add Momentum'}
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                handleToggleMomentum();
              }}
              className={cn(
                // Reserve a tiny inline slot so text never shifts when the indicator appears.
                // Slightly larger hit area than the visible circle (no row height change).
                'inline-flex w-4 h-4 items-center justify-center shrink-0',
                task.momentum === true
                  ? 'opacity-100 pointer-events-auto'
                  : cn(
                      'opacity-0 pointer-events-none',
                      // Visible on hover OR when row is active/editing
                      'group-hover:opacity-100 group-hover:pointer-events-auto',
                      (isActive || isEditing) ? 'opacity-100 pointer-events-auto' : ''
                    )
              )}
              data-no-edit
            >
              <span
                aria-hidden
                className={cn(
                  'block rounded-full',
                  'h-2 w-2', // 8px circle
                  task.momentum === true
                    ? cn('bg-primary/70', 'group-hover:bg-primary/80')
                    : cn(
                        'bg-transparent',
                        'border',
                        (isActive || isEditing) ? 'border-primary/55' : 'border-primary/30',
                        'group-hover:border-primary/50'
                      )
                )}
              />
            </button>
          )}

          {isEditing ? (
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={editInputRef as any}
                value={editingText}
                rows={1}
                onChange={handleChange}
                onKeyDown={onTextareaKeyDown as any}
                onBlur={onTextareaBlur as any}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className={cn(
                  'flex-1 min-w-0 w-full',
                  // Remove default textarea chrome so edit mode doesn't change row height.
                  'p-0 m-0 border-0 outline-none appearance-none',
                  'resize-none overflow-hidden bg-transparent',
                  'whitespace-pre-wrap break-words overflow-wrap-anywhere',
                  'leading-[1.32]',
                  // Match the display-line baseline so the tag row doesn't shift on focus.
                  'h-[1.32em] min-h-[1.32em]',
                  'focus:outline-none',
                  completedClass
                )}
                style={{ caretColor: 'hsl(var(--foreground))' }}
              />
            </div>
          ) : (
            <div
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                (onTextClick as any)(e);
              }}
              // Fill remaining line width so "blank row" clicks still show an I-beam
              // and reliably enter edit mode via the text click handler.
              className="flex-1 min-w-0 truncate cursor-text"
            >
              {task.text.length > 0
                ? activeTags && activeTags.length > 0
                  ? renderTextWithActiveTags(visibleTitle)
                  : searchQuery
                    ? highlightMatches(visibleTitle, searchQuery)
                    : visibleTitle
                : // If the row only has tags, render them as a subdued "title" so it isn't an empty line.
                task.tags && task.tags.length > 0
                  ? (
                      <span className="text-muted-foreground/25 text-[0.92em]">
                        {task.tags.map(t => `#${t}`).join(' ')}
                      </span>
                    )
                  : // Persistent capture row hint (visual only; not a placeholder attribute).
                    isEntryRowEmpty
                    ? (
                        <span className="text-muted-foreground/45">
                          Add item…
                        </span>
                      )
                  : '\u00A0'}
            </div>
          )}
        </div>

        {/* Secondary metadata line (tags). Keep visible during editing to avoid row-height jump. */}
        {!isEntryRow && task.tags && task.tags.length > 0 && (
          <div
            className={cn(
              visibleTitle.length === 0 ? 'mt-0' : 'mt-0.5',
              'text-[10px] leading-[1.0]',
              // Muted blue, lower priority than task text but clearly clickable.
              'text-primary/45',
              'whitespace-nowrap overflow-hidden text-ellipsis',
              ''
            )}
          >
            {task.tags.map((tag, i) => (
              <span key={tag}>
                {i > 0 ? ' ' : ''}
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className={cn(
                      'p-0 m-0 bg-transparent border-0',
                      'cursor-pointer text-inherit',
                      'hover:text-primary/60 hover:underline underline-offset-2',
                      'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm'
                    )}
                    data-no-edit
                    onMouseDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleTagClick(tag);
                    }}
                  >
                    #{tag}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    className={cn(
                      'p-0 m-0 bg-transparent border-0',
                      'cursor-pointer text-inherit',
                      'opacity-35 hover:opacity-70',
                      'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm'
                    )}
                    data-no-edit
                    onMouseDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveTag(tag);
                    }}
                  >
                    ×
                  </button>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      {!isEntryRow && (
        <button
          onClick={onDelete as any}
          aria-label="Delete task"
          type="button"
          className={cn(
            'absolute right-2 top-[6px]',
            'inline-flex h-6 w-6 items-center justify-center',
            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // Hover-only, minimal chrome
            'text-muted-foreground/70 hover:text-destructive',
            'hover:bg-destructive/10 hover:rounded-full',
            // When hidden, disable pointer events so the invisible button doesn't block click-to-edit.
            'opacity-0 pointer-events-none',
            'group-hover:opacity-100 group-hover:pointer-events-auto',
            'group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
            '[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'
          )}
          data-no-edit
          onMouseDown={e => {
            // prevent row selection shift
            e.stopPropagation();
          }}
        >
          <span className="text-lg leading-none font-semibold" aria-hidden>
            ×
          </span>
        </button>
      )}
    </div>
  );
}


