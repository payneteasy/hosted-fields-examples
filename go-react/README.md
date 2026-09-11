# Hosted Fields example — Go + React + TypeScript

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Same payment and same screens as [`go-js/`](../go-js/) — the same server, near enough to diff —
with the page written as a React single-page application instead of a static file and a script.
The stylesheet is literally the same file.

What this example is for is the seam. There are two projects in this directory and a line
between them you cannot miss: **Go above, React below `web/`**, and the only things that cross
are one generated `<script>` and two `fetch` calls. [`nextjs/`](../nextjs/) answers the other
question — what Hosted Fields look like under server rendering — and there the two halves share
a language, a `src/` tree and a framework. Here they cannot be confused.

## Run

```bash
cd web && yarn install && yarn build && cd ..
cp .env.example .env   # fill in ENDPOINT_ID and MERCHANT_LOGIN
go run .
```

Open <http://localhost:3010/hosted-fields-examples-go-react/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

The build comes first because `web/dist` is compiled into the binary with `//go:embed`. Only
`web/dist/.gitkeep` is committed, so a fresh clone compiles — and serves a 500 for the page —
before the build has run.

### While working on the page

```bash
go run .                 # terminal 1: the server, on 3010
cd web && yarn dev       # terminal 2: the page, with hot reload
```

The dev server serves the two pages itself and proxies `config.js`, `result-config.js`, `/pay`,
`/status` and `/result/callback` to the Go process — the seam again, as a proxy hop. It serves
the 3DS return page at `{prefix}/result.html`, since routing `{prefix}/result` is the server's
job. Rebuild with `yarn build` before `go run .` picks a change up.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read at
startup and never overrides a variable the environment already has.
The RSA key signs the server calls and must never be exposed to the browser — point
`PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in `PRIVATE_KEY` as a single line
with escaped `\n`.

**`BASE_PATH` is a setting of the running process, not of the build.** The bundle finds its own
assets with relative URLs and finds the server through `window.CONFIG.basePath`, so the same
`web/dist` — and the same released binary — serves under any prefix. This is the one place where
this example and `nextjs/` differ in substance rather than in shape: `next build` bakes its
`basePath` in, and changing it means rebuilding.

## Flow

| # | Where | What |
| - | ----- | ---- |
| 1 | `GET {prefix}/` | `web/dist/index.html`, served exactly as the build wrote it |
| 2 | `GET {prefix}/config.js` | `window.CONFIG`, carrying a single-use `ephemeralTicket` (`/api/v4/tokenize/create-ephemeral-ticket/`) — the one thing this server generates |
| 3 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 4 | `POST {prefix}/pay` | the server sends a Sale (`/api/v4/sale/`) with `hosted_fields_token` instead of the card parameters |
| 5 | `GET {prefix}/status` | the page polls the order status (`/api/v4/status/`) every 4 seconds until a final status |
| 6 | `POST {prefix}/result/callback` | where the gateway returns the payer after a 3DS challenge, with a POST whose `control` checksum is verified |
| 7 | `GET {prefix}/result` | the return page, `web/dist/result.html`, and `{prefix}/result-config.js` beside it |

Steps 2, 4 and 5 are the whole of what the browser half knows about the server: one script tag
and the two functions in [`web/src/shared/api/`](web/src/shared/api/). The credentials, the RSA
key and every call to the gateway are in the Go process and reach nothing else.

## What the browser is told, and how

`config.js` is a script the server writes per request, with `Cache-Control: no-store` because
the ticket in it is single-use, and the page templates load it ahead of the bundle. Nothing from
the environment is compiled into the bundle: there is no `PUBLIC_*` inlining here, so a setting
that changes needs no rebuild and no credential can end up in a file a payer downloads.

It stays valid JavaScript even when the gateway call behind it failed — the server emits `error`
in place of `ephemeralTicket`, and the page then tells the payer and leaves the button dead.

## React and a cross-origin SDK

The SDK injects an iframe into each of the three empty `<div>`s and toggles classes on them.
React owns the same elements. Four rules keep that from going wrong, and the code says so at
each site — they are the same four as in [`nextjs/`](../nextjs/README.md#react-and-a-cross-origin-sdk),
because the hazard is React's, not the framework's:

- **The containers render no children and their `className` is a constant.** React leaves DOM it
  did not create alone, so the iframes survive re-renders — but a child would make React own the
  subtree, and a computed `className` would wipe the `hf-field--focus` / `--filled` classes the
  SDK sets. The error ring is therefore added with `classList`. See
  [`hosted-field.tsx`](web/src/shared/ui/hosted-field.tsx).
- **`HostedFields.init()` runs once**, behind a ref guard, because the entry modules render
  inside `<StrictMode>` and React 19 invokes effects twice in development. Nothing is destroyed
  on cleanup for the same reason.
- **Every theme change is pushed field by field** with `sdk.setStyle()`, after the `data-theme`
  attribute is on `<html>` — the iframes inherit nothing from the stylesheet, and
  [`field-style.ts`](web/src/shared/lib/field-style.ts) reads the values back out of the same CSS
  custom properties the container uses, so the two sides cannot drift.
- **One tokenization per `ephemeralTicket`.** The whole `4xxx` error class spends it, so those
  errors leave the button dead rather than inviting a retry that cannot work.

## No inline script, anywhere

Every page ships a Content-Security-Policy with no `'unsafe-inline'`, and nothing here is
templated, so there is nowhere to put a nonce. Rsbuild is told to inline neither scripts nor
styles, and the two templates in [`web/src/app/`](web/src/app/) carry no script of their own but
`config.js`.

One consequence is visible: `nextjs/` applies a stored theme from an inline script in `<head>`,
which it can because Next mints a nonce per request. Here `applyStoredTheme()` runs at the top of
each entry module instead, a moment later — so a payer whose stored choice contradicts their
system setting may see one frame of the other theme. The stylesheet's own
`prefers-color-scheme` fallback covers everyone else.

## The 3DS return

The gateway returns the payer to `redirect_url` with a **POST**, not a GET, and signs the
parameters:

```
control = sha1(status + orderid + merchant_order + MERCHANT_CONTROL)
```

A page cannot be delivered by POST and still be reloadable, so `redirect_url` points at
`/result/callback`, which recomputes that checksum, answers `403` when it does not match, and
otherwise sends a `303` to `/result` carrying the same four signed parameters in the query.
`/result` checks them **again** before it serves anything.

That second check is the whole trick. The browser carries the identifiers, but it cannot forge
them — it does not know `MERCHANT_CONTROL` — so a hand-edited URL gets a `403` rather than a
page that polls somebody else's order, and the server keeps no state between the two requests.
Nothing is kept in `sessionStorage`. The callback also carries the outcome, but
[the documentation](https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html)
says not to treat it as the status — the page asks the status API instead.

It is also why `{prefix}/result.html` is a `404`. Both pages are build output and live in
`web/dist` beside the bundle, so the server serves that directory through an allowlist —
`styles.css` and `static/` — rather than through a file server, which would otherwise hand out
the return page without ever looking at the checksum.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [paynet.go](paynet.go):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. That body carries `error-message`, so it is decoded
  and passed on to the page instead of being treated as a failed call.

## Build

```bash
cd web && yarn build && cd ..
go build -o hosted-fields-examples-go-react .
```

`web/dist` is embedded with `//go:embed`, so the artefact is one static binary with no runtime
files beside it — a React application included.

## Checks

```bash
cd web && yarn lint && yarn build   # biome + tsc over both projects + steiger, then the bundle
cd .. && gofmt -l . && go vet ./... && go test ./... && go build ./...
```

## Deploy behind nginx

Templates live in [deploy/](deploy). The app speaks plain HTTP on loopback; nginx terminates TLS
and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the binary, with the page built into it
(cd web && yarn install --frozen-lockfile && yarn build)
GOOS=linux GOARCH=amd64 go build -o hosted-fields-examples-go-react .
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-go-react
install -m 755 hosted-fields-examples-go-react /opt/hosted-fields-examples-go-react/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-go-react.key

# 3. settings
cp deploy/hosted-fields-examples-go-react.env.example /etc/hosted-fields-examples-go-react.env
chmod 640 /etc/hosted-fields-examples-go-react.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-go-react.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-go-react

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-go-react.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app — it
  routes on `BASE_PATH` rather than having nginx strip it.
- **`X-Forwarded-For` must be set.** The app trusts the proxy and sends the payer's address to
  the platform for fraud screening; without the header every payer looks like the proxy.

`BASE_PATH` needs no rebuild here, unlike in `nextjs/`: change the service's environment and
restart it.

## Files

```
config.go                  environment variables
oauth.go                   OAuth 1.0a RSA-SHA256 signing
paynet.go                  the three gateway calls
main.go                    routes under BASE_PATH, and the generated config.js
web/rsbuild.config.ts      two entries, relative asset URLs, the dev proxy
web/src/app/               the two pages: an HTML template and an entry module each
web/src/shared/config/     window.CONFIG, typed
web/src/shared/api/        POST /pay and GET /status, and nothing else
web/src/shared/lib/        the SDK seam, the payer's details, the status poller
web/src/shared/ui/         the payment page and the status panel
web/public/styles.css      a copy of shared/, do not edit
```
