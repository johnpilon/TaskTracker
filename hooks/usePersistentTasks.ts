'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Task } from '../app/page';

const STORAGE_KEY = 'tasks';
const BACKUP_STORAGE_KEY = 'tasks_backup'; // NEW
const STORAGE_VERSION = 1;
const MAX_INDENT = 2;

type StoredPayload = {
  version: number;
  tasks: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeTask = (value: unknown): Task | null => {
  if (!isPlainObject(value)) return null;

  const { id, text, completed, indent, createdAt } = value;

  if (typeof id !== 'string' || typeof text !== 'string') return null;

  const safeCompleted = typeof completed === 'boolean' ? completed : false;
  const indentNumber =
    typeof indent === 'number' && Number.isFinite(indent) ? indent : 0;
  const safeIndent = Math.max(0, Math.min(MAX_INDENT, Math.trunc(indentNumber)));
  const safeCreatedAt =
    typeof createdAt === 'string' ? createdAt : new Date().toISOString();

  return {
    id,
    text,
    completed: safeCompleted,
    indent: safeIndent,
    createdAt: safeCreatedAt,
  };
};

const extractTasksArray = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray((value as StoredPayload).tasks)) {
    return (value as StoredPayload).tasks;
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
    setTasks(loaded);
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

  return [tasks, setTasks];
}
