'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

function labelForTheme(theme: Theme) {
  switch (theme) {
    case 'system':
      return 'System';
    case 'light':
      return 'Light';
    case 'dark':
      return 'Dark';
    case 'dark-blue':
      return 'Dark Blue';
    case 'black':
      return 'Black';
  }
}

/* =======================
   Component
======================= */

export function ThemeSwitcher() {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      if (next === 'system') {
        window.localStorage.removeItem(THEME_KEY);
      } else {
        window.localStorage.setItem(THEME_KEY, next);
      }
    } catch {
      // no-op
    }

    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-background text-foreground border-border"
          aria-label="Theme"
        >
          Theme: {labelForTheme(theme)}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground border-border"
      >
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => setTheme('system')}>
          System
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => setTheme('light')}>
          Light
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          Dark
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => setTheme('dark-blue')}>
          Dark Blue
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => setTheme('black')}>
          Black
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
