import type { TaskMeta } from '../app/page';

const TAG_REGEX = /(^|\s)#([a-zA-Z0-9_-]+)/g;

export function parseTaskMeta(text: string): TaskMeta {
  const tags = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(text))) {
    tags.add(match[2].toLowerCase());
  }

  return {
    tags: Array.from(tags),
  };
}