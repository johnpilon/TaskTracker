'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Task } from '../app/page';

const STORAGE_KEY = 'tasks';
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

  // Hard requirements: without these we can't safely keep the row.
  if (typeof id !== 'string' || typeof text !== 'string') return null;

  // Soft requirements: gracefully handle corrupted/legacy values.
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

const loadTasks = (): Task[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    const tasksArray = extractTasksArray(parsed);
    if (!tasksArray) return [];

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
    // StrictMode-safe init guard:
    // - Don't save on the initial render (tasks === [])
    // - Don't save on the first render *after* loading (tasks === loadedTasksRef.current)
    // This prevents overwriting valid stored tasks with [] during startup.
    if (!initializedRef.current) {
      if (loadedTasksRef.current && tasks === loadedTasksRef.current) {
        initializedRef.current = true;
      }
      return;
    }

    try {
      const payload: StoredPayload = { version: STORAGE_VERSION, tasks };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persistence failures
    }
  }, [tasks]);

  return [tasks, setTasks];
}

