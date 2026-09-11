/* The seam, resolved from CSS -----------------------------------------------
   The field iframes cannot read public/styles.css, and the SDK's allowlist has
   no selectors, no media queries and no url(). So the inside has to be told
   everything. Rather than keeping a second hand-written copy of the values —
   which drifts the first time someone edits one side — we read the same custom
   properties the container uses, and pass those.

   One consequence worth knowing: this must run after styles.css is applied, and
   again after any theme change.                                              */

const SEAM_VARS = {
  font: '--pay-font',
  size: '--pay-field-text',
  weight: '--pay-field-weight',
  tracking: '--pay-field-tracking',
  height: '--pay-field-h',
  padX: '--pay-field-pad-x',
  ink: '--pay-ink',
  muted: '--pay-muted',
  fieldBg: '--pay-field-bg',
  accent: '--pay-accent',
} as const;

const SEAM_FALLBACK: Record<keyof typeof SEAM_VARS, string> = {
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size: '16px',
  weight: '500',
  tracking: '0.01em',
  height: '52px',
  padX: '14px',
  ink: '#0a0b0c',
  muted: '#69747a',
  fieldBg: '#ffffff',
  accent: '#348bff',
};

function cssVar(name: string, fallback: string): string {
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw === '' ? fallback : raw;
}

function seam(): Record<keyof typeof SEAM_VARS, string> {
  const out = {} as Record<keyof typeof SEAM_VARS, string>;
  for (const key of Object.keys(SEAM_VARS) as (keyof typeof SEAM_VARS)[]) {
    out[key] = cssVar(SEAM_VARS[key], SEAM_FALLBACK[key]);
  }
  return out;
}

/* fieldStyle() — the bag handed to HostedFields.init({ fields: { … style } }).

   Only these properties survive the allowlist; anything else is dropped with a
   console warning. No pseudo-elements, no selectors, no media queries, no
   url(). Note there is nothing here that positions or decorates: the border,
   radius, background edge, focus ring and error ring are all drawn on the
   container by styles.css, so the two surfaces never fight over the same pixel.

   - lineHeight equal to the container height is what centres the value
     vertically; the iframe has no flexbox to help.
   - fontVariantNumeric: 'tabular-nums' keeps the digits from shifting sideways
     as the payer types. Do not remove it.
   - backgroundColor has to match --pay-field-bg or the seam becomes visible as
     a rectangle inside the box, most obviously in dark mode.                 */

export function fieldStyle(): HostedFieldsStyle {
  const s = seam();

  const input: HostedFieldsCss = {
    color: s.ink,
    backgroundColor: s.fieldBg,
    caretColor: s.accent,
    fontFamily: s.font,
    fontSize: s.size,
    fontWeight: s.weight,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: s.tracking,
    lineHeight: s.height,
    textAlign: 'left',
    padding: `0 ${s.padX}`,
    border: '0',
    outline: 'none',
    transition: 'color 160ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return {
    input,

    placeholder: {
      color: s.muted,
      fontWeight: s.weight,
      letterSpacing: s.tracking,
    },

    /* The visible focus treatment is the ring on the container. Inside, focus
       only needs to keep the value legible and the caret branded — the SDK
       merges this over `input`. */
    focus: {
      color: s.ink,
      backgroundColor: s.fieldBg,
      caretColor: s.accent,
    },
  };
}
