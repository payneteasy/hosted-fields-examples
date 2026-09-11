# Hosted Fields examples

Three merchant integrations of the same payment — `go-js/`, `nodejs-express-js/` and `nextjs/`.
They exist to be read, so clarity beats cleverness everywhere in this repository.

## The rule that breaks most often

`public/styles.css` is shared by **all three** apps and must stay byte-for-byte identical.

Four more files are shared by the two plain-JS apps, `go-js/` and `nodejs-express-js/`:

```
public/status.js  public/checkout.js  views/checkout.html  views/result.html
```

Exactly one line may differ in the views, the config injection:

```
go-js:              <script>window.CONFIG = {{ . }};</script>
nodejs-express-js:  <script>window.CONFIG = __CONFIG__;</script>
```

So a frontend change is never finished in one app. Edit one copy, copy it across, swap that one
line back, then diff to confirm nothing else moved. CI fails the push otherwise.

`nextjs/` cannot share the scripts or the views — it is React, and they are ported to TSX — but
it serves the same `public/styles.css`, which is what keeps the design from drifting. A change
to the stylesheet has to reach all three copies; a change to the markup or the behaviour has to
be made twice, once in the plain-JS pair and once in the components.

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

In `nextjs/` the bundler is the point of the example, but the dependencies are still only
Next, React and the two linters — nothing for the integration itself.

## Secrets

`.env`, `*.pem` and `*.key` are git-ignored repository wide. Never commit a key, a
`MERCHANT_CONTROL`, or a real `ENDPOINT_ID`/`MERCHANT_LOGIN`; `.env.example` carries placeholders
only.

## Checks before a commit

```bash
cd go-js             && gofmt -l . && go vet ./... && go build ./...
cd nodejs-express-js && npm ci && npm run build
cd nextjs            && yarn install && yarn lint && yarn build
```

Then confirm the shared files still match, the way CI does — see `.github/workflows/ci.yml`.

## Documentation

Link to `doc.payneteasy.com`, never to internal or staging hosts. The integration reference is
<https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>.
