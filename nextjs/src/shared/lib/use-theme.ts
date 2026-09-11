'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY } from './theme';

export type Theme = 'light' | 'dark';

/**
 * The stylesheet handles the container: an explicit data-theme on <html>, and a
 * prefers-color-scheme fallback when the payer has not chosen. The iframes get nothing from
 * either, so the caller has to push the recomputed style bag with sdk.setStyle() on change.
 *
 * The initial render must match the server's, so the stored preference is read in an effect
 * rather than during render. layout.tsx sets the attribute before paint, so nothing flashes;
 * this only catches the state up with it.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('light');

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // A private window can refuse storage. The theme still applies, it just does not stick.
    }
    setThemeState(next);
  }, []);

  useEffect(() => {
    const stored = readStoredTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setThemeState(stored ?? (media.matches ? 'dark' : 'light'));

    // Follow the system while the payer has not chosen
    if (stored) {
      return;
    }
    const follow = (event: MediaQueryListEvent) => {
      const next: Theme = event.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      setThemeState(next);
    };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  return [theme, setTheme];
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}
