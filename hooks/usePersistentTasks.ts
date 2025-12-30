'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { List, Task } from '../app/page';

const STORAGE_KEY = 'tasks';
const BACKUP_STORAGE_KEY = 'tasks_backup'; // NEW
const LISTS_KEY = 'task_lists';
const STORAGE_VERSION = 1;
const MAX_INDENT = 2;
const DEFAULT_LIST_NAME = 'Inbox';

const INTENTS = new Set(['now', 'soon', 'later']);

const sortTasks = (list: Task[]): Task[] => {
  const now: Task[] = [];
  const soon: Task[] = [];
  const later: Task[] = [];
  const none: Task[] = [];
  const archived: Task[] = [];

  for (const t of list) {
    if (t.archived) {
      archived.push(t);
      continue;
    }
    if (t.intent === 'now') now.push(t);
    else if (t.intent === 'soon') soon.push(t);
    else if (t.intent === 'later') later.push(t);
    else none.push(t);
  }

  const byOrder = (a: Task, b: Task) => a.order - b.order;
  now.sort(byOrder);
  soon.sort(byOrder);
  later.sort(byOrder);
  none.sort(byOrder);

  // Archived tasks kept at the end, stable by archivedAt (fallback to order).
  const archivedSortKey = (t: Task) => {
    const iso = t.archivedAt;
    const parsed =
      typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : t.order;
  };
  archived.sort((a, b) => archivedSortKey(a) - archivedSortKey(b));

  return [...now, ...soon, ...later, ...none, ...archived];
};

type StoredPayload = {
  version: number;
  tasks: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeList = (value: unknown): List | null => {
  if (!isPlainObject(value)) return null;
  const { id, name, createdAt } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof name !== 'string') return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return { id, name, createdAt: Math.trunc(createdAt) };
};

const loadLists = (): List[] => {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: List[] = [];
    for (const c of parsed) {
      const l = normalizeList(c);
      if (!l) continue;
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
    return out;
  } catch {
    return [];
  }
};

const persistLists = (lists: List[]) => {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
  } catch {
    // Ignore persistence failures
  }
};

const createId = () => `list-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeTask = (value: unknown): Task | null => {
  if (!isPlainObject(value)) return null;

  const { id, text, completed, indent, createdAt, tags, meta, intent, order, archived, completedAt, archivedAt, momentum, listId } =
    value;

  if (typeof id !== 'string' || typeof text !== 'string') return null;

  const safeCompleted = typeof completed === 'boolean' ? completed : false;
  const safeArchived = typeof archived === 'boolean' ? archived : false;

  const safeCreatedAt =
    typeof createdAt === 'number' && Number.isFinite(createdAt)
      ? Math.trunc(createdAt)
      : typeof createdAt === 'string'
        ? Date.parse(createdAt) || Date.now()
        : Date.now();

  const safeOrder =
    typeof order === 'number' && Number.isFinite(order) ? Math.trunc(order) : safeCreatedAt;

  const safeIntent =
    typeof intent === 'string' && INTENTS.has(intent) ? (intent as NonNullable<Task['intent']>) : undefined;

  const safeCompletedAt =
    safeCompleted && typeof completedAt === 'number' && Number.isFinite(completedAt)
      ? Math.trunc(completedAt)
      : safeCompleted
        ? safeCreatedAt
        : undefined;

  const safeArchivedAt = (() => {
    // `archivedAt` is an ISO string timestamp in the current model.
    // Older payloads may store a number (ms).
    if (typeof archivedAt === 'string') {
      const t = Date.parse(archivedAt);
      return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
    }
    if (typeof archivedAt === 'number' && Number.isFinite(archivedAt)) {
      return new Date(Math.trunc(archivedAt)).toISOString();
    }
    // If archived but missing timestamp, backfill from createdAt for deterministic behavior.
    if (safeArchived) return new Date(safeCreatedAt).toISOString();
    return undefined;
  })();
  const indentNumber =
    typeof indent === 'number' && Number.isFinite(indent) ? indent : 0;
  const safeIndent = Math.max(0, Math.min(MAX_INDENT, Math.trunc(indentNumber)));
  const safeTags =
    Array.isArray(tags) && tags.every(t => typeof t === 'string')
      ? tags.map(t => t.toLowerCase())
      : [];

  // Migration/canonicalization: strip inline #tags from text and merge into task.tags[].
  const extractedFromText: string[] = [];
  const strippedText = text
    .replace(/(^|\s)#([a-zA-Z0-9_-]+)(?=\s|$)/g, (_m, leading, tag) => {
      const normalized = String(tag).toLowerCase();
      if (normalized) extractedFromText.push(normalized);
      return leading || ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  const mergedTags = Array.from(new Set([...safeTags, ...extractedFromText]));

  // Momentum is a boolean state.
  // Migration: legacy "focus" was represented as intent === 'now'.
  const safeMomentum =
    typeof momentum === 'boolean'
      ? momentum
      : safeIntent === 'now';

  const safeListId =
    typeof listId === 'string' && listId.length > 0 ? listId : undefined;

  let safeMeta: Task['meta'] | undefined;
  if (isPlainObject(meta)) {
    const maybeTags = (meta as { tags?: unknown }).tags;
    if (Array.isArray(maybeTags) && maybeTags.every(t => typeof t === 'string')) {
      safeMeta = { tags: maybeTags };
    }
  }

  return {
    id,
    text: strippedText,
    createdAt: safeCreatedAt,
    order: safeOrder,
    ...(safeListId ? { listId: safeListId } : {}),
    completed: safeCompleted,
    ...(safeCompletedAt ? { completedAt: safeCompletedAt } : {}),
    archived: safeArchived,
    ...(safeArchivedAt ? { archivedAt: safeArchivedAt } : {}),
    indent: safeIndent,
    tags: mergedTags,
    ...(safeIntent ? { intent: safeIntent } : {}),
    momentum: safeMomentum,
    ...(safeMeta ? { meta: safeMeta } : {}),
  };
};

const extractTasksArray = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) {
    const maybeTasks = (value as { tasks?: unknown }).tasks;
    if (Array.isArray(maybeTasks)) return maybeTasks;
  }
  return null;
};

const parseAndValidate = (raw: string | null): Task[] | null => { // NEW
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const tasksArray = extractTasksArray(parsed);
  if (!tasksArray) return null;

  const seen = new Set<string>();
  const validated: Task[] = [];

  for (const candidate of tasksArray) {
    const task = normalizeTask(candidate);
    if (!task) continue;
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    validated.push(task);
  }

  return validated;
};

const loadTasks = (): Task[] => {
  try {
    // 1. Try primary storage
    const primary = parseAndValidate(localStorage.getItem(STORAGE_KEY));
    if (primary) return primary;

    // 2. Fallback to last-known-good backup
    const backup = parseAndValidate(localStorage.getItem(BACKUP_STORAGE_KEY)); // NEW
    if (backup) return backup;

    // 3. Give up safely
    return [];
  } catch {
    return [];
  }
};

export default function usePersistentTasks(): [
  Task[],
  React.Dispatch<React.SetStateAction<Task[]>>,
  List[],
  (name: string) => List | null,
  boolean,
  (listId: string, newName: string) => boolean,
  (listId: string) => string | null,
  () => string | null
] {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);
  const defaultListIdRef = useRef<string | null>(null);

  const getOrCreateDefaultListId = () => {
    if (defaultListIdRef.current) return defaultListIdRef.current;

    const existing = loadLists();
    if (existing.length > 0) {
      setLists(existing);
      const sorted = [...existing].sort((a, b) => a.createdAt - b.createdAt);
      defaultListIdRef.current = sorted[0]?.id ?? null;
      return defaultListIdRef.current;
    }

    const now = Date.now();
    const created: List = { id: createId(), name: DEFAULT_LIST_NAME, createdAt: now };
    const createdLists = [created];
    persistLists(createdLists);
    setLists(createdLists);
    defaultListIdRef.current = created.id;
    return defaultListIdRef.current;
  };

  useEffect(() => {
    const defaultListId = getOrCreateDefaultListId();

    const loaded = loadTasks();
    const migrated = loaded.map(t => {
      if (typeof t.listId === 'string' && t.listId.length > 0) return t;
      return { ...t, listId: defaultListId ?? undefined };
    });
    // Assign missing order values based on current sequence for older payloads.
    const withOrder = migrated.map((t: Task, idx: number) => {
      if (typeof t.order === 'number' && Number.isFinite(t.order)) return t;
      return { ...t, order: idx };
    });
    setTasks(sortTasks(withOrder));
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    try {
      const payload: StoredPayload = { version: STORAGE_VERSION, tasks };
      const serialized = JSON.stringify(payload);

      // Write backup first, then primary (important ordering)
      localStorage.setItem(BACKUP_STORAGE_KEY, serialized); // NEW
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Ignore persistence failures
    }
  }, [tasks]);

  const setTasksSorted: React.Dispatch<React.SetStateAction<Task[]>> = updater => {
    setTasks(prev => {
      const next = typeof updater === 'function' ? (updater as any)(prev) : updater;

      const defaultListId = getOrCreateDefaultListId();
      const withListId = (next as Task[]).map((t: Task) =>
        typeof t.listId === 'string' && t.listId.length > 0
          ? t
          : { ...t, listId: defaultListId ?? undefined }
      );
      // Ensure all active tasks have intent for consistent sorting
      const withIntent = withListId.map((t: Task) =>
        t.archived || t.completed || t.intent
          ? t
          : { ...t, intent: 'now' as const }
      );
      // Reindex order to preserve manual ordering across updates.
      const reindexed = withIntent.map((t: Task, idx: number) =>
        t.archived || t.completed ? t : { ...t, order: idx }
      );
      return sortTasks(reindexed);
    });
  };

  const createList = (name: string): List | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return null;

    const now = Date.now();
    const created: List = { id: createId(), name: trimmed, createdAt: now };
    setLists(prev => {
      const next = [...prev, created];
      persistLists(next);
      return next;
    });
    return created;
  };

  const renameList = (listId: string, newName: string): boolean => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) return false;

    // Find the list
    const list = lists.find(l => l.id === listId);
    if (!list) return false;

    // Inbox (first list by createdAt) cannot be renamed
    const sorted = [...lists].sort((a, b) => a.createdAt - b.createdAt);
    if (sorted[0]?.id === listId) return false;

    setLists(prev => {
      const next = prev.map(l => (l.id === listId ? { ...l, name: trimmed } : l));
      persistLists(next);
      return next;
    });
    return true;
  };

  const deleteList = (listId: string): string | null => {
    // Find the list
    const list = lists.find(l => l.id === listId);
    if (!list) return null;

    // Inbox (first list by createdAt) cannot be deleted
    const sorted = [...lists].sort((a, b) => a.createdAt - b.createdAt);
    const inboxId = sorted[0]?.id;
    if (inboxId === listId) return null;

    // Move all tasks from deleted list to Inbox
    setTasks(prev => {
      const updated = prev.map(t =>
        t.listId === listId ? { ...t, listId: inboxId } : t
      );
      return sortTasks(updated);
    });

    // Remove the list
    setLists(prev => {
      const next = prev.filter(l => l.id !== listId);
      persistLists(next);
      return next;
    });

    return inboxId ?? null;
  };

  const getInboxId = (): string | null => {
    const sorted = [...lists].sort((a, b) => a.createdAt - b.createdAt);
    return sorted[0]?.id ?? null;
  };

  return [tasks, setTasksSorted, lists, createList, hasHydrated, renameList, deleteList, getInboxId];
}
