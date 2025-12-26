'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Task } from '../app/page';

const STORAGE_KEY = 'tasks';
const BACKUP_STORAGE_KEY = 'tasks_backup'; // NEW
const STORAGE_VERSION = 1;
const MAX_INDENT = 2;

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
  archived.sort((a, b) => (a.archivedAt ?? a.order) - (b.archivedAt ?? b.order));

  return [...now, ...soon, ...later, ...none, ...archived];
};

type StoredPayload = {
  version: number;
  tasks: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeTask = (value: unknown): Task | null => {
  if (!isPlainObject(value)) return null;

  const { id, text, completed, indent, createdAt, tags, meta, intent, order, archived, completedAt, archivedAt } =
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

  const safeArchivedAt =
    safeArchived && typeof archivedAt === 'number' && Number.isFinite(archivedAt)
      ? Math.trunc(archivedAt)
      : safeArchived
        ? safeCreatedAt
        : undefined;
  const indentNumber =
    typeof indent === 'number' && Number.isFinite(indent) ? indent : 0;
  const safeIndent = Math.max(0, Math.min(MAX_INDENT, Math.trunc(indentNumber)));
  const safeTags =
    Array.isArray(tags) && tags.every(t => typeof t === 'string') ? tags : [];

  let safeMeta: Task['meta'] | undefined;
  if (isPlainObject(meta)) {
    const maybeTags = (meta as { tags?: unknown }).tags;
    if (Array.isArray(maybeTags) && maybeTags.every(t => typeof t === 'string')) {
      safeMeta = { tags: maybeTags };
    }
  }

  return {
    id,
    text,
    createdAt: safeCreatedAt,
    order: safeOrder,
    completed: safeCompleted,
    ...(safeCompletedAt ? { completedAt: safeCompletedAt } : {}),
    archived: safeArchived,
    ...(safeArchivedAt ? { archivedAt: safeArchivedAt } : {}),
    indent: safeIndent,
    tags: safeTags,
    ...(safeIntent ? { intent: safeIntent } : {}),
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
  React.Dispatch<React.SetStateAction<Task[]>>
] {
  const [tasks, setTasks] = useState<Task[]>([]);
  const loadedTasksRef = useRef<Task[] | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const loaded = loadTasks();
    loadedTasksRef.current = loaded;
    // Assign missing order values based on current sequence for older payloads.
    const withOrder = loaded.map((t: Task, idx: number) =>
      typeof t.order === 'number' ? t : { ...t, order: idx }
    );
    setTasks(sortTasks(withOrder));
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      if (loadedTasksRef.current && tasks === loadedTasksRef.current) {
        initializedRef.current = true;
      }
      return;
    }

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
      // Reindex order to preserve manual ordering across updates.
      const reindexed = (next as Task[]).map((t: Task, idx: number) =>
        t.archived ? t : { ...t, order: idx }
      );
      return sortTasks(reindexed);
    });
  };

  return [tasks, setTasksSorted];
}
