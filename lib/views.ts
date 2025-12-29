/* =======================
   View logic (search + derived visibility)
   Extracted from app/page.tsx
   Pure functions only: no React, no DOM, no side effects
======================= */

export type SearchViewState = { type: 'search'; query: string };

export const tokenizeQuery = (query: string): string[] =>
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

export const canonicalizeViewQuery = (q: string) => q.trim().replace(/\s+/g, ' ');

export const deriveViewState = (raw: string): SearchViewState | null => {
  const query = raw.trim().toLowerCase();
  if (query.length === 0) return null;
  return { type: 'search', query };
};

type TaskLikeForView = { text: string; tags?: string[] };

const normalizeTag = (tag: string) => tag.toLowerCase().replace(/^#/, '');

export const filterTasksBySearch = (task: TaskLikeForView, query: string): boolean => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;

  const text = task.text.toLowerCase();
  const tags = task.tags ?? [];

  const tagTokens = tokens.filter(t => t.startsWith('#'));
  const textTokens = tokens.filter(t => !t.startsWith('#'));

  const textMatch = textTokens.every(
    t => text.includes(t) || tags.some(tag => normalizeTag(tag) === t)
  );
  const tagMatch = tagTokens.every(t => {
    const needle = t.slice(1);
    if (needle.length === 0) return true;
    return tags.some(tag => tag.toLowerCase().includes(needle));
  });

  return textMatch && tagMatch;
};

export const applyView = <
  TTask extends { momentum?: boolean } & TaskLikeForView,
>(
  all: TTask[],
  search: SearchViewState | null,
  momentumActive: boolean
) => {
  let entries = all.map((task, index) => ({ task, index }));
  if (momentumActive) {
    entries = entries.filter(({ task }) => task.momentum === true);
  }
  if (search) {
    entries = entries.filter(({ task }) => filterTasksBySearch(task, search.query));
  }
  return entries;
};

export const isTagView = (searchViewState: SearchViewState | null) => {
  if (!searchViewState) return false;
  const tokens = tokenizeQuery(searchViewState.query);
  if (tokens.length === 0) return false;
  return tokens.every(t => t.startsWith('#') && t.length > 1);
};

export const deriveActiveTagTokens = (searchViewState: SearchViewState | null) => {
  if (!searchViewState) return [] as string[];
  const tokens = tokenizeQuery(searchViewState.query);
  // Normalize + de-dupe while preserving token order.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of tokens) {
    if (!t.startsWith('#') || t.length <= 1) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  return tags;
};


