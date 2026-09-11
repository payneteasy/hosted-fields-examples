# Hosted Fields example — Next.js + React + TypeScript

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Same payment and same screens as [`go-js/`](../go-js/) and [`nodejs-express-js/`](../nodejs-express-js/),
written as React components instead of a static page and a script. The stylesheet is literally
the same file. What this example is for is the part the other two cannot show: how an
imperative, cross-origin SDK and React's render loop are kept out of each other's way.

## Run

```bash
yarn install
cp .env.example .env   # fill in the gateway URLs and your credentials
yarn dev
```

Open <http://localhost:3002/hosted-fields-examples-nextjs/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read by
Next at startup and in the build. The RSA key signs the server calls and must never be exposed
to the browser — point `PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in
`PRIVATE_KEY` as a single line with escaped `\n`.

Two of them do not behave the way they do in the other examples, and both are Next's doing:

- **`BASE_PATH` is resolved at build time.** It becomes `basePath` in
  [next.config.ts](next.config.ts), which `next build` bakes into the output. Keeping it in
  `.env` means the build and the runtime agree, but changing it means rebuilding.
- **`PORT` only works as a real environment variable.** Next chooses the port before it loads
  `.env`, so `yarn dev` and `yarn start` take it from the shell (defaulting to 3002) and the
  systemd unit supplies it through `EnvironmentFile`. Everything else is read from `.env`.

Nothing is exposed to the browser through `NEXT_PUBLIC_*`. What the page needs — the SDK URL,
the endpoint id, the ephemeral ticket, the amount — is handed to the client component as props
by the server component, which is the React shape of the `window.CONFIG` the other two inject.

## Flow

| # | Where | What |
| - | ----- | ---- |
| 1 | `GET {prefix}/` | the server obtains a single-use `ephemeralTicket` (`/api/v4/tokenize/create-ephemeral-ticket/`) and passes it to the page |
| 2 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 3 | `POST {prefix}/pay` | the server sends a Sale (`/api/v4/sale/`) with `hosted_fields_token` instead of the card parameters |
| 4 | `GET {prefix}/status` | the page polls the order status (`/api/v4/status/`) every 4 seconds until a final status |
| 5 | `POST {prefix}/result/callback` | where the gateway returns the payer after a 3DS challenge; the `control` checksum is verified, then a 303 to `{prefix}/result` with the same signed parameters |
| 6 | `GET {prefix}/result` | the return page, which polls the order the callback carried |

## The 3DS return

The gateway returns the payer to `redirect_url` with a **POST**, not a GET, and signs the
parameters:

```
control = sha1(status + orderid + merchant_order + MERCHANT_CONTROL)
```

An App Router page cannot serve a POST, and a `page.tsx` and a `route.ts` cannot share a path.
So `redirect_url` points one level deeper, at
[`result/callback/route.ts`](src/app/result/callback/route.ts), which recomputes that checksum,
answers `403` when it does not match, and otherwise answers `303` to `{prefix}/result` carrying
the same four signed parameters in the query.
[`result/page.tsx`](src/app/result/page.tsx) checks them **again** before it shows an order.

That second check is what makes carrying them in the URL safe: the browser cannot forge them,
because it does not know `MERCHANT_CONTROL`. A hand-edited URL gets a `403`, exactly as in the
other two examples — but it comes from [`src/middleware.ts`](src/middleware.ts) rather than from
the page, because a React page cannot set a status code without the experimental `forbidden()`.
A middleware runs before the page and can. It runs on the edge runtime, which is why
[`callback.ts`](src/shared/lib/callback.ts) verifies the checksum with Web Crypto and takes
`MERCHANT_CONTROL` as an argument: `node:crypto` and `node:fs` are not available there, and all
three checks have to be the same function.
Nothing is kept in `sessionStorage`. The callback carries the outcome too, but
[the documentation](https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html)
says not to treat it as the status — the page asks the status API instead.

## React and a cross-origin SDK

The SDK injects an iframe into each of the three empty `<div>`s and toggles classes on them.
React owns the same elements. Four rules keep that from going wrong, and the code says so at
each site:

- **The containers render no children and their `className` is a constant.** React leaves DOM
  it did not create alone, so the iframes survive re-renders — but a child would make React own
  the subtree, and a computed `className` would wipe the `hf-field--focus` / `--filled` classes
  the SDK sets. The error ring is therefore added with `classList`, not by rendering it. See
  [`hosted-field.tsx`](src/shared/ui/hosted-field.tsx).
- **`HostedFields.init()` runs once**, behind a ref guard, because React 19 invokes effects
  twice in development StrictMode. Nothing is destroyed on cleanup for the same reason.
- **Every theme change is pushed field by field** with `sdk.setStyle()`, after the `data-theme`
  attribute is on `<html>` — the iframes inherit nothing from the stylesheet, and
  [`field-style.ts`](src/shared/lib/field-style.ts) reads the values back out of the same CSS
  custom properties the container uses, so the two sides cannot drift.
- **One tokenization per `ephemeralTicket`.** The whole `4xxx` error class spends it, so those
  errors leave the button dead rather than inviting a retry that cannot work.

## The stylesheet

[`public/styles.css`](public/styles.css) is a copy of [`shared/public/styles.css`](../shared/public/styles.css),
written by [`scripts/sync-shared.sh`](../scripts/sync-shared.sh) — edit it there, not here, and
CI fails a copy that has drifted. It is the one file this example shares with the other two;
the scripts and the views are components instead.
It is referenced with a plain `<link>` from [`layout.tsx`](src/app/layout.tsx) rather than
imported, so no build step can touch it. Biome is told to leave it alone for the same reason.

## Build

```bash
yarn build
```

`output: 'standalone'` produces `.next/standalone/server.js`, which needs `.next/static` and
`public/` copied next to it and then runs on plain Node with no `node_modules`.

## Deploy behind nginx

Templates live in [deploy/](deploy). The app speaks plain HTTP on loopback; nginx terminates TLS
and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the artefact
yarn install && yarn build
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-nextjs
cp -r .next/standalone/. /opt/hosted-fields-examples-nextjs/
mkdir -p /opt/hosted-fields-examples-nextjs/.next
cp -r .next/static /opt/hosted-fields-examples-nextjs/.next/static
cp -r public /opt/hosted-fields-examples-nextjs/public

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-nextjs.key

# 3. settings
cp deploy/hosted-fields-examples-nextjs.env.example /etc/hosted-fields-examples-nextjs.env
chmod 640 /etc/hosted-fields-examples-nextjs.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-nextjs.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-nextjs

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-nextjs.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`BASE_PATH` must have been set for the build**, not only for the service — see Settings.
- **`X-Forwarded-For` must be set.** The app trusts the proxy and sends the payer's address to
  the platform for fraud screening; without the header every payer looks like the proxy.

## Checks

```bash
yarn lint     # biome check + tsc --noEmit + steiger
yarn build
```

## Files

```
src/shared/config/env.ts        environment variables, validated on first use
src/shared/lib/oauth.ts         OAuth 1.0a RSA-SHA256 signing
src/shared/lib/paynet.ts        the three gateway calls
src/shared/lib/callback.ts      the 3DS callback checksum, and the payer's IP
src/app/                        pages and route handlers, all under basePath
src/shared/ui/                  the payment page and the status panel
public/styles.css               shared with the other two examples, byte for byte
```
