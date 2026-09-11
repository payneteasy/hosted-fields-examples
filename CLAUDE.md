# Hosted Fields examples

Two merchant integrations of the same payment — `go-js/` and `nodejs-express-js/`. They exist to
be read, so clarity beats cleverness everywhere in this repository.

## The rule that breaks most often

Five files are shared and **must stay byte-for-byte identical** between the two apps:

```
public/styles.css  public/status.js  public/checkout.js
views/checkout.html  views/result.html
```

Exactly one line may differ, the config injection:

```
go-js:              <script>window.CONFIG = {{ . }};</script>
nodejs-express-js:  <script>window.CONFIG = __CONFIG__;</script>
```

So a frontend change is never finished in one app. Edit one copy, copy all five across, swap that
one line back, then diff to confirm nothing else moved. CI fails the push otherwise.

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

## Frontend constraints

- No dependencies, no bundler, no CDN, no webfonts, no images. Plain CSS in one file.
- `public/` is ES5: `var`, `function`, no arrow functions, no template literals.
- Never do anything to `.hf-field` that could hide or fake a card input — no `transform`,
  `opacity`, `clip-path`, `filter`, positioned overlays. The SDK rejects it.

## Secrets

`.env`, `*.pem` and `*.key` are git-ignored repository wide. Never commit a key, a
`MERCHANT_CONTROL`, or a real `ENDPOINT_ID`/`MERCHANT_LOGIN`; `.env.example` carries placeholders
only.

## Checks before a commit

```bash
cd go-js            && gofmt -l . && go vet ./... && go build ./...
cd nodejs-express-js && npm ci && npm run build
```

Then confirm the five shared files still match, the way CI does — see `.github/workflows/ci.yml`.

## Documentation

Link to `doc.payneteasy.com`, never to internal or staging hosts. The integration reference is
<https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>.
