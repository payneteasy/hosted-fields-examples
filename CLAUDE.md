# Hosted Fields examples

Three merchant integrations of the same payment — `go-js/`, `nodejs-express-js/` and `nextjs/`.
They exist to be read, so clarity beats cleverness everywhere in this repository.

## The rule that breaks most often

`shared/` is the source of truth for the browser half, and `scripts/sync-shared.sh` copies it
into every app:

```
shared/public/styles.css  status.js  checkout.js  result.js
shared/views/checkout.html  result.html
```

The copies stay committed, so every app directory still runs on its own with no pre-step. A
frontend change is therefore: **edit `shared/`, run `scripts/sync-shared.sh`, commit both.**
Never edit a copy — the script overwrites it, and CI runs the script and then
`git diff --exit-code`, so forgetting cannot reach main.

`nextjs/` takes only `styles.css`: its scripts and views are React components. That one file is
what keeps the three looking identical.

There are no exceptions and no per-app lines. Nothing in `views/` is templated — see below.

## The server contract

Every app serves the same routes under `BASE_PATH`, and adding a language means implementing
exactly these and nothing else:

| Route | What |
| --- | --- |
| `GET /` | `views/checkout.html`, byte for byte as it is on disk |
| `GET /config.js` | `window.CONFIG = {basePath, sdkUrl, endpointId, amount, currency, ephemeralTicket}` |
| `GET /result-config.js` | the same, without `sdkUrl` and without a ticket |
| `POST /pay` | Sale; JSON in, the gateway's JSON plus `clientOrderId` out, `502 {error}` on failure |
| `GET /status` | order status as JSON, `Cache-Control: no-store` |
| `POST /result/callback` | verify `control`, `403` on a mismatch, else `303` to `/result` with the signed query |
| `GET /result` | verify the query when `orderid` is present, then `views/result.html` |

Three things about it are load-bearing:

- **`config.js` is the only generated thing anywhere.** That is what lets the views be
  identical across languages, so never reintroduce templating into an HTML file.
- **`config.js` is `no-store`** — the ticket in it is single-use — and it must stay valid
  JavaScript even when the gateway call behind it failed: emit `error` in place of
  `ephemeralTicket`, and `checkout.js` tells the payer and kills the button.
- **The 3DS return is signed twice over the same checksum.** The gateway POSTs
  `status`/`orderid`/`merchant_order`/`control` to `/result/callback`; the redirect forwards
  those four verbatim, and `GET /result` checks them again with the same function. The browser
  carries them but cannot forge them, so a hand-edited URL gets a `403` instead of a page that
  polls somebody else's order. In `nextjs/` the `403` comes from `src/middleware.ts`, because a
  React page cannot set a status code without an experimental flag.

`nextjs/` is the one exception, and only to the first two rows: a React page gets its config as
props from the server component, so it has no `config.js` and no `result-config.js`. Everything
below those rows it implements exactly as written.

## English only

Code, comments, documentation, commit messages, anything on screen. No Cyrillic anywhere in the
repository.

The payer can still be shown another language, but not from here: `error.payerMessage` comes from
the SDK bundle the gateway serves.

## The DOM contract

These ids are wired to the SDK and to the page scripts. Renaming one means renaming it in
`HostedFields.init()` too, so do not rename them casually:

`cardNumber`, `expiryDate`, `cvv` (also the keys of the `fields` map), `pay`, `formError`,
`orderStatus`.

The three card containers **stay empty in the markup** — the SDK injects an iframe into each. They
are cross-origin, so the page cannot read a value, style the inside with CSS, or attach a
listener. The inside is styled only through the `style` bag passed to `init()`, over an allowlist
of properties; the outside is the container div and is yours.

State arrives as classes the SDK toggles on the container — `hf-field--focus`, `hf-field--filled`,
`hf-field--error` — because `:focus-within` does not cross an origin boundary.

## React, in `nextjs/` only

The SDK injects an iframe into each container and toggles classes on it; React owns the same
elements. Four rules, each explained where it is enforced:

- the containers render **no children** and their `className` is a **constant** — React leaves
  foreign DOM alone, but it rewrites an attribute whose rendered value changed, which would
  wipe `hf-field--focus` / `--filled`. Class changes of our own go through `classList`;
- `HostedFields.init()` runs **once**, behind a ref guard, because React 19 invokes effects
  twice in development StrictMode — and nothing is destroyed on cleanup for the same reason;
- `sdk.setStyle()` is pushed for all three fields on **every** theme change, after the
  `data-theme` attribute is on `<html>`;
- settings are validated **lazily**, not at module import: `next build` imports the route
  modules, and CI builds without credentials.

## Frontend constraints

Everywhere:

- No CDN, no webfonts, no images. Plain CSS in one file, shipped as written.
- Never do anything to `.hf-field` that could hide or fake a card input — no `transform`,
  `opacity`, `clip-path`, `filter`, positioned overlays. The SDK rejects it.

In `go-js/` and `nodejs-express-js/`:

- No dependencies and no bundler for the browser half.
- `public/` is ES5: `var`, `function`, no arrow functions, no template literals.

- **No inline `<script>` and no inline `style=` in a view.** Every page ships a
  Content-Security-Policy with no `'unsafe-inline'`, and a nonce cannot go in the markup because
  nothing in `views/` is templated. That is why the result page's script is
  `public/result.js`. The policy names the `SDK_URL` origin in `script-src` **and** in
  `frame-src` — the card fields are iframes from that host — and is built at runtime, so it is a
  header and not a violation of the no-templating rule. `nextjs/` is the exception again: Next
  emits its own inline scripts, so its middleware mints a nonce per request instead.
In `nextjs/` the bundler is the point of the example, but the dependencies are still only
Next, React and the two linters — nothing for the integration itself.

## Secrets

`.env`, `*.pem` and `*.key` are git-ignored repository wide. Never commit a key, a
`MERCHANT_CONTROL`, or a real `ENDPOINT_ID`/`MERCHANT_LOGIN`; `.env.example` carries placeholders
only.

## Checks before a commit

```bash
./scripts/sync-shared.sh && git diff --exit-code   # every copy matches shared/
cd go-js             && gofmt -l . && go vet ./... && go build ./...
cd nodejs-express-js && npm ci && npm run build
cd nextjs            && yarn install && yarn lint && yarn build
```

The first line is what CI runs — see `.github/workflows/ci.yml`.

## Documentation

Link to `doc.payneteasy.com`, never to internal or staging hosts. The integration reference is
<https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>.
