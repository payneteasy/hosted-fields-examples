export const THEME_KEY = 'pay-theme';

export type Theme = 'light' | 'dark';

/**
 * Applies the stored preference to <html>, and answers with what it applied.
 *
 * Called at the top of each entry module rather than from an inline <script> in <head>, which
 * is what nextjs/ does and what the plain-JS examples do in public/result.js: the page ships a
 * Content-Security-Policy with no 'unsafe-inline', nothing in the templates is generated, and
 * so there is nowhere to put a nonce. The bundle is deferred, so this runs a moment later than
 * an inline script would.
 *
 * The stylesheet has a prefers-color-scheme fallback of its own, so the only case that can
 * flash is a payer whose stored choice contradicts their system setting.
 */
export function applyStoredTheme(): Theme {
  const theme = readStoredTheme() ?? systemTheme();
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    // A private window can refuse storage.
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
