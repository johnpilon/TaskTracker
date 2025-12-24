import React from 'react';

export const highlightMatches = (text: string, query: string) => {
  if (!query) return text;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  return text.split(regex).map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        className="bg-primary/10 rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
};


