# go-react

Go server and a React SPA for the Hosted Fields example. Read the repository-level `CLAUDE.md`
first — the rules about the shared stylesheet and about English apply here too.

This example exists next to `nextjs/` to answer a different question: not "what does Hosted
Fields look like in React", which that one answers, but "which half of this runs where". Here the
two halves cannot be confused, because one of them is written in Go.

## Shape

Two projects in one directory, and the boundary between them is the directory line:

| Path | Runs where | What |
| --- | --- | --- |
| `config.go` | server | environment variables plus a small `.env` reader |
| `oauth.go` | server | OAuth 1.0a RSA-SHA256 signing |
| `paynet.go` | server | the three gateway calls: ephemeral ticket, sale, status |
| `main.go` | server | routes under `BASE_PATH`, and the generated `config.js` |
| `web/src/app/` | browser | the two entry points, one per page |
| `web/src/shared/config/` | browser | `window.CONFIG`, typed |
| `web/src/shared/api/` | browser | every request to the server, and there are two |
| `web/src/shared/lib/`, `web/src/shared/ui/` | browser | the page itself |

The four Go files are `go-js`'s, near enough to diff: standard library only, no dependencies,
`go.mod` has no `require` block. Keep it that way. `web/` has two runtime dependencies, `react`
and `react-dom`, and nothing for the integration itself.

`web/dist` is compiled into the binary with `//go:embed`, so the artefact is one static binary
again — but it has to be built first: `cd web && yarn install && yarn build`.
`web/dist/.gitkeep` is committed, and `cleanDistPath.keep` in `rsbuild.config.ts` is what stops
a build from deleting it, so a fresh clone compiles before anyone has run the build.

## Things that will bite

- **The asset handler is an allowlist, and `result.html` is not in it.** `handleAsset` in
  `main.go` serves `styles.css` and `static/` and 404s the rest. `go-js` can hand the whole of
  `public/` to `http.FileServerFS` because its pages live in `views/`; here both pages sit in
  `web/dist` beside the bundle, so a plain file server would serve `{prefix}/result.html` and
  walk past the signature check `GET {prefix}/result` performs. Registering the handler on the
  subtree is also what keeps the mux's bare-prefix → trailing-slash redirect, which the pages'
  relative asset URLs need. **The name is `path.Clean`ed before it is checked**, and
  `asset_test.go` exists because of it: the mux turns a literal `..` into a redirect but leaves
  `%2e%2e` alone, so an allowlist applied to the path as it arrived lets
  `{prefix}/static/%2e%2e/result.html` serve the return page.
- **`BASE_PATH` is a runtime setting and must stay one.** `output.assetPrefix` is `'./'` and the
  pages reach the server only through `window.CONFIG.basePath`, so one `web/dist` serves under
  any prefix — which is the property `nextjs/` does not have and the reason its Dockerfile takes
  a build argument and this one does not. Anything that writes the prefix into the bundle takes
  it away.
- **Nothing from the environment may reach the bundle.** No `PUBLIC_*` inlining, no
  `define`, no settings file imported at build time: everything the browser is told arrives at
  runtime in `config.js`, still the only generated thing in the example. `process` is not even
  nameable under `web/src`, because `tsconfig.json` sets `"types": []` and only
  `tsconfig.node.json` adds `node` — for `rsbuild.config.ts`, the one file that runs in Node.
- **No inline `<script>` and no inline `style=` may survive the build.** The Go server's
  Content-Security-Policy has no `'unsafe-inline'` and nothing here is templated, so there is
  nowhere to put a nonce. `output.inlineScripts` and `inlineStyles` stay off, and the two
  templates in `web/src/app/` carry no script of their own but `config.js`. The consequence is
  that the theme is applied by `applyStoredTheme()` at the top of each entry module rather than
  by an inline script in `<head>` the way `nextjs/` does it.
- **The card containers must stay empty and their `className` must stay constant** — the same
  rule as in `nextjs/`, for the same reason: the SDK injects a cross-origin iframe into each and
  toggles `hf-field--focus` / `--filled` / `--error` on the same element, and a `className` React
  computes would wipe them. The error ring goes on with `classList` in `checkout-form.tsx`.
- **`HostedFields.init()` must run once**, behind the ref guard in `checkout-form.tsx`, because
  the entry modules render inside `<StrictMode>` and React 19 runs effects twice in development.
  Nothing is destroyed on cleanup for the same reason.
- **`fieldStyle()` must run after the theme attribute is on `<html>`**, because it reads the
  values back with `getComputedStyle`. Never hard-code a `[SEAM]` value in TS.
- **`web/public/styles.css` is a copy of `shared/public/styles.css`.** Rsbuild copies it into
  `dist/` untouched and the templates link it; it is never imported, and Biome is told to skip
  it. Never edit it here — edit `shared/`, run `scripts/sync-shared.sh`.
- **The React code is a port of `nextjs/src/shared/`, not a copy of it.** Neither app imports
  the other and neither is synced from the other; `shared/public/checkout.js` is the original
  both were ported from. When you change wording the payer reads — `ERROR_COPY`, `STATUS_COPY` —
  change it in all three.
- **Settings are read once, in `loadConfig`, not in package-level vars**, and `encode` in
  `oauth.go` is not `url.QueryEscape` — both as in `go-js`, and for the same reasons.

## Checks

```bash
cd web && yarn lint && yarn build   # biome + tsc over both projects + steiger, then the bundle
cd .. && gofmt -l . && go vet ./... && go test ./... && go build ./...
```

Go 1.24 or newer, Node 20 or newer, yarn.
