import type { Task } from '../app/page';

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase();
}

export function removeTagFromTasks(prev: Task[], taskId: string, tag: string): Task[] {
  const needle = normalizeTag(tag);

  return prev.map(t => {
    if (t.id !== taskId) return t;

    const nextTags = (t.tags ?? []).filter(x => x.toLowerCase() !== needle);
    return {
      ...t,
      tags: nextTags,
      meta: { ...(t.meta ?? {}), tags: nextTags },
    };
  });
}


