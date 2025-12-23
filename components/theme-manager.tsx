'use client';

import { useEffect } from 'react';

type ThemeOverride = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';
const THEME_CHANGE_EVENT = 'themechange';

function isThemeOverride(value: unknown): value is ThemeOverride {
  return value === 'light' || value === 'dark';
}

function readOverride(): ThemeOverride | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemeOverride(value) ? value : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): ThemeOverride {
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(theme: ThemeOverride) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeManager() {
  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);
    const legacyMql = mql as MediaQueryList & {
      addListener?: (listener: (ev: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (ev: MediaQueryListEvent) => void) => void;
    };

    const applyPreferred = () => {
      const override = readOverride();
      applyTheme(override ?? getSystemTheme());
    };

    // Initial sync after hydration
    applyPreferred();

    const onSystemChange = () => {
      // Only respond to system changes if there is no explicit override.
      if (!readOverride()) applyTheme(getSystemTheme());
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
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


