import type { Theme } from '@/shared/lib';

/**
 * Optional. Remove this button and the theme still follows the system preference — but
 * keeping it means the checkout has to push sdk.setStyle() on every change, because the
 * iframes inherit nothing from the stylesheet.
 */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
}) {
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      id="themeToggle"
      className="pay-theme"
      aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      onClick={() => onChange(dark ? 'light' : 'dark')}
    >
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}
