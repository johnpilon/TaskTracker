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

type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const THEME_CHANGE_EVENT = 'themechange';

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function labelFor(choice: ThemeChoice) {
  if (choice === 'system') return 'System';
  return choice[0].toUpperCase() + choice.slice(1);
}

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setChoice(readChoice());
  }, []);

  const setTheme = (next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
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
          Theme: {labelFor(choice)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover text-popover-foreground border-border">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


