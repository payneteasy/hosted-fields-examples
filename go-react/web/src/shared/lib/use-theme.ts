import { useCallback, useEffect, useState } from 'react';
import { readStoredTheme, systemTheme, THEME_KEY, type Theme } from './theme';

/**
 * The stylesheet handles the container: an explicit data-theme on <html>, and a
 * prefers-color-scheme fallback when the payer has not chosen. The iframes get nothing from
 * either, so the caller has to push the recomputed style bag with sdk.setStyle() on change —
 * see the theme effect in checkout-form.tsx.
 *
 * The attribute is already on <html> by the time this runs: applyStoredTheme() is the first
 * thing each entry module does. This only catches React's state up with it, and then follows
 * the system while the payer has not chosen for themselves.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

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
    if (readStoredTheme()) {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
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
