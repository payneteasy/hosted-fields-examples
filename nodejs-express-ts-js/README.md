# Hosted Fields example — Node.js + Express + TypeScript + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.

This is [`nodejs-express-js/`](../nodejs-express-js) with one variable changed: the server is
TypeScript. The two are close enough to read side by side — same routes, same comments, same
order of the Sale parameters — and what the types buy is set out in
[TypeScript, and what it is for here](#typescript-and-what-it-is-for-here) below. The browser
half is not TypeScript and is not built: `public/` is the same ES5 every example but the two
React ones ships, copied from `shared/`.

## Run

```bash
npm install
cp .env.example .env   # fill in ENDPOINT_ID, MERCHANT_LOGIN, PRIVATE_KEY
npm start
```

Needs **Node 22.18+**: `npm start` runs `src/server.ts` directly, and Node strips the types
itself. There is no `tsx`, no `ts-node` and no watch-mode compiler in the dependency list.

Open <http://localhost:3011/hosted-fields-examples-nodejs-express-ts-js/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

## TypeScript, and what it is for here

The type check is part of the build, not a step beside it:

```json
"build": "tsc --noEmit && node build.mjs"
```

esbuild — like swc, like every other bundler in this repository — *strips* types rather than
checking them. A project whose `build` script is the bundler alone can ship code that has never
been type-checked, which is what happens when `tsc` lives only in a `lint` script somebody has to
remember to run. Here it cannot: `npm run build` exits before esbuild starts if anything fails to
type-check.

Three places where that actually earns its keep, and they are the diff against the JavaScript
example worth reading:

- **[src/config.ts](src/config.ts)** — a required setting is narrowed from `string | undefined`
  to `string` in the one function that validates it, so the rest of the app never asserts and
  never re-checks. `PORT` is a `number`, which is why `PORT=8O80` is now a refusal to start
  rather than a listener on a port nobody expected;
- **[src/json.ts](src/json.ts)** — the only module with no counterpart next door. `JSON.parse` is
  typed `any` and so is `req.body`, and `as SaleResponse` over either would type-check and would
  be a lie: the gateway's reply and the payer's request are the two values here that this code
  does not get to promise anything about. Both arrive as `unknown` and are checked at runtime;
- **[src/server.ts](src/server.ts)** — `req.query` is a bag of strings, arrays and nested
  objects, so `?orderId=a&orderId=b` is a case the compiler makes you answer. The JavaScript
  example passes the array on.

What the types do **not** do is worth stating too. They vanish at runtime, so every boundary
above is still a runtime check; `tsconfig.json` sets `erasableSyntaxOnly` precisely because Node
erases rather than compiles, and an `enum` would type-check and then fail to run.

Linting and formatting are [Biome](https://biomejs.dev): `npm run lint` is `biome check` plus the
same `tsc --noEmit`, and `npm run format` writes.

## Settings

All settings are environment variables, see [.env.example](.env.example).
`PRIVATE_KEY` is the RSA key that signs the server calls — it must never be exposed to the browser.

## Flow

| # | Where | What |
| - | ----- | ---- |
| 1 | `GET {prefix}/` | `views/checkout.html`, served exactly as it is on disk |
| 2 | `GET {prefix}/config.js` | `window.CONFIG`, carrying a single-use `ephemeralTicket` (`/api/v4/tokenize/create-ephemeral-ticket/`) — the one thing this server generates |
| 3 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 4 | `POST {prefix}/pay` | the server sends a Sale (`/api/v4/sale/`) with `hosted_fields_token` instead of the card parameters |
| 5 | `GET {prefix}/status` | the page polls the order status (`/api/v4/status/`) every 4 seconds until a final status |
| 6 | `POST {prefix}/result/callback` | where the gateway returns the payer after a 3DS challenge, with a POST whose `control` checksum is verified |
| 7 | `GET {prefix}/result` | the return page, and `{prefix}/result-config.js` beside it |

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

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [src/paynet.ts](src/paynet.ts):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. That body carries `error-message`, so it is decoded
  and passed on to the page instead of being treated as a failed call.

## Build

```bash
npm run build
```

`tsc --noEmit` first, then esbuild bundles the server and its only dependency into a single
file. The artefact is plain JavaScript: it needs no `node_modules`, no `package.json` and no
TypeScript on the target host — just Node 22+:

```
dist/
├── server.js     the server and express in one file
├── public/       stylesheet and client scripts, served as plain files
└── views/        the two HTML pages
```

Templates and client assets deliberately stay outside the bundle: nginx can serve `public/`
straight from disk, and the pages remain readable and editable on the server.

## Deploy behind nginx

Templates live in [deploy/](deploy). The app speaks plain HTTP on loopback; nginx terminates TLS
and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the build artefact
npm run build
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-nodejs-express-ts-js
rsync -a --delete dist/ /opt/hosted-fields-examples-nodejs-express-ts-js/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-nodejs-express-ts-js.key

# 3. settings
cp deploy/hosted-fields-examples-nodejs-express-ts-js.env.example /etc/hosted-fields-examples-nodejs-express-ts-js.env
chmod 640 /etc/hosted-fields-examples-nodejs-express-ts-js.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-nodejs-express-ts-js.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-nodejs-express-ts-js

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-nodejs-express-ts-js.conf
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

To run a second example on the same host, give it its own port and its own `BASE_PATH`, and add
one more pair of `location` blocks.

## Files

```
build.mjs        tsc --noEmit, then the esbuild bundle + asset copy
tsconfig.json    strict, noEmit, erasableSyntaxOnly
biome.json       formatter and linter
src/config.ts    environment variables, validated into non-optional types
src/json.ts      the unknown-to-checked boundary: gateway replies and request bodies
src/oauth.ts     OAuth 1.0a RSA-SHA256 signing
src/callback.ts  the 3DS return checksum
src/paynet.ts    the three gateway calls
src/server.ts    express routes under BASE_PATH
views/           payment page, 3DS return page
public/          stylesheet and client scripts, ES5, copied from shared/
```
