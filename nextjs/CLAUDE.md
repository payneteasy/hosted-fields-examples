# nextjs

Next.js server and React page for the Hosted Fields example. Read the repository-level
`CLAUDE.md` first — the rules about the shared stylesheet and about English apply here too.

## Shape

yarn, not npm — this app alone, because Biome and Steiger came with it from
`form-iframe-examples/nextjs`. Node 20 or newer. Next 15 App Router, React 19, TypeScript
`strict`, `output: 'standalone'`.

| File | Role |
| --- | --- |
| `src/shared/config/env.ts` | environment variables, validated on first use |
| `src/shared/lib/oauth.ts` | OAuth 1.0a RSA-SHA256 signing |
| `src/shared/lib/paynet.ts` | the three gateway calls |
| `src/shared/lib/callback.ts` | the 3DS callback checksum and the payer's IP |
| `src/app/` | pages and route handlers, all under `basePath` |
| `src/shared/ui/` | the payment page and the status panel |

`src/app/**` is exempt from the FSD rules in `steiger.config.ts`: it is Next's routing layer,
not an FSD layer.

## Things that will bite

- **The card containers must stay empty and their `className` must stay constant.** The SDK
  injects a cross-origin iframe into each and toggles `hf-field--focus` / `--filled` /
  `--error` on the same element. React leaves foreign children alone, but it rewrites
  `className` whenever the rendered value changes — which would wipe the SDK's classes. That is
  why the error ring is added with `classList` in `checkout-form.tsx` and not rendered.
- **`HostedFields.init()` must run once.** React 19 runs effects twice in development
  StrictMode, so the init is behind a ref guard, and nothing is destroyed on cleanup — a
  cleanup that destroyed the SDK would leave the second run with three dead boxes.
- **`fieldStyle()` must run after the theme attribute is on `<html>`**, because it reads the
  values back with `getComputedStyle`. Never hard-code a `[SEAM]` value in TS; the stylesheet
  says the same thing at the top of itself.
- **Settings are validated lazily, not at import.** `next build` imports these modules to
  collect the routes, and a build must not need production credentials — CI has none.
- **`BASE_PATH` is build-time** (it becomes `basePath`), and **`PORT` is not read from `.env`**
  (Next picks the port first). Both are documented in `README.md` and `.env.example`; do not
  "fix" them by moving the values around.
- **`public/styles.css` is a copy of `shared/public/styles.css`.** It is referenced with a
  `<link>` rather than imported, and Biome is configured to skip it, so that nothing can
  reformat it. Never edit it here — edit `shared/`, run `scripts/sync-shared.sh`.
- **The 3DS return carries signed parameters in the query, not a cookie.** `result/callback`
  verifies the gateway's `control` and forwards the same four values; `result/page.tsx` checks
  them again. A React page cannot answer `403` without the experimental `forbidden()`, so a
  failed check renders the empty page — which is the part that matters.
- **Nothing server-side may reach a client component.** `src/shared/lib/index.ts` is the
  client-safe barrel; `oauth.ts`, `paynet.ts` and `callback.ts` are imported straight from
  `src/app/**` and must stay out of it.

## Checks

```bash
yarn lint     # biome check + tsc --noEmit + steiger
yarn build
```
