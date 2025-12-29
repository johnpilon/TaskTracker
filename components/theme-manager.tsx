'use client';

import { useEffect } from 'react';

/* =======================
   Types
======================= */

type Theme =
  | 'system'
  | 'light'
  | 'dark'
  | 'dark-blue'
  | 'black';

/* =======================
   Constants
======================= */

const THEME_KEY = 'theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';
const THEME_CHANGE_EVENT = 'themechange';

/* =======================
   Helpers
======================= */

function isTheme(value: unknown): value is Theme {
  return (
    value === 'system' ||
    value === 'light' ||
    value === 'dark' ||
    value === 'dark-blue' ||
    value === 'black'
  );
}

function readTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemResolvesTo(): Exclude<Theme, 'system'> {
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(theme: Exclude<Theme, 'system'>) {
  document.documentElement.dataset.theme = theme;
}

/* =======================
   Component
======================= */

export function ThemeManager() {
  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);
    const legacyMql = mql as MediaQueryList & {
      addListener?: (listener: (ev: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (listener: MediaQueryListEvent) => void) => void;
    };

    const applyPreferred = () => {
      const stored = readTheme();
      const resolved =
        stored === 'system' ? systemResolvesTo() : stored;

      applyTheme(resolved);
    };

    /* ---------- Initial sync after hydration ---------- */
    applyPreferred();

    const onSystemChange = () => {
      // Only re-resolve if user chose "system"
      if (readTheme() === 'system') {
        applyTheme(systemResolvesTo());
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      applyPreferred();
    };

    const onThemeChange = () => {
      applyPreferred();
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onSystemChange);
    } else if (typeof legacyMql.addListener === 'function') {
      legacyMql.addListener(onSystemChange);
    }

    window.addEventListener('storage', onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onSystemChange);
      } else if (typeof legacyMql.removeListener === 'function') {
        legacyMql.removeListener(onSystemChange);
      }

      window.removeEventListener('storage', onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
    };
  }, []);

  return null;
}
