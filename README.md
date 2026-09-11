# Hosted Fields examples

Five working merchant integrations of [Hosted Fields][docs]: on Go, on Node.js, on PHP, on Python
and on Next.js. Same payment, same screens, same flow — what differs is the server language and,
in the last, whether the page is a static file or a React tree.

## The examples

| | Server | Read the code | Start here |
| --- | --- | --- | --- |
| **Go** | Go 1.24+, standard library only | [`go-js/`](go-js/) | [`main.go`](go-js/main.go) routes · [`paynet.go`](go-js/paynet.go) the three gateway calls · [`oauth.go`](go-js/oauth.go) request signing |
| **Node.js** | Node 20+, express only | [`nodejs-express-js/`](nodejs-express-js/) | [`src/server.js`](nodejs-express-js/src/server.js) routes · [`src/paynet.js`](nodejs-express-js/src/paynet.js) the three gateway calls · [`src/oauth.js`](nodejs-express-js/src/oauth.js) request signing |
| **PHP** | PHP 8.4+, no Composer | [`php-js/`](php-js/) | [`index.php`](php-js/index.php) routes · [`paynet.php`](php-js/paynet.php) the three gateway calls · [`oauth.php`](php-js/oauth.php) request signing |
| **Python** | Python 3.12+, Flask | [`python-flask-js/`](python-flask-js/) | [`app.py`](python-flask-js/app.py) routes · [`paynet.py`](python-flask-js/paynet.py) the three gateway calls · [`oauth.py`](python-flask-js/oauth.py) request signing |
| **Next.js** | Node 20+, React 19, TypeScript | [`nextjs/`](nextjs/) | [`src/app/`](nextjs/src/app/) pages and route handlers · [`src/shared/lib/paynet.ts`](nextjs/src/shared/lib/paynet.ts) the three gateway calls · [`src/shared/ui/checkout-form.tsx`](nextjs/src/shared/ui/checkout-form.tsx) the page |

The browser half lives once, in [`shared/`](shared/) —
[`checkout.js`](shared/public/checkout.js) sets up the fields and tokenizes,
[`status.js`](shared/public/status.js) polls the order,
[`checkout.html`](shared/views/checkout.html) is the page — and
[`scripts/sync-shared.sh`](scripts/sync-shared.sh) copies it into every app, byte for byte.
That is the point of having more than one: everything interesting about Hosted Fields happens
in the page, and the server behind it is interchangeable. Pick whichever language you work in
and ignore the others.

The Next.js example answers the other question — what this looks like when the page is React.
It cannot share those files, so they are ported to components, but it serves the very same
[`public/styles.css`](go-js/public/styles.css) and the screens are the same to the pixel. Its
own subject is the seam: an SDK that injects cross-origin iframes imperatively, into elements
React also owns. See [nextjs/README.md](nextjs/README.md#react-and-a-cross-origin-sdk).

## What it looks like

| Checkout | After the payment |
| --- | --- |
| <img src="docs/checkout.png" alt="Checkout page: the card fields are gateway iframes, the cardholder name between them is the merchant's own input" width="380"> | <img src="docs/result.png" alt="Result panel: approved, with amount, card, cardholder, order, reference and approval code" width="380"> |

Look at the card section on the left. Card number, expiry and CVV are iframes from the gateway —
but **Cardholder name, sitting between them, is the merchant's own `<input>`**, in the same
visual row and the same style. That is what Hosted Fields buy you and what a redirect to a hosted
payment page cannot do.

## Download a built example

No build needed — each archive holds a ready binary. These links always point at the newest
release; the [releases page](https://github.com/payneteasy/hosted-fields-examples/releases) has
the older ones and the checksums.

| Example | Platform | Download | Then |
| --- | --- | --- | --- |
| Go | Linux x86-64 | [`..._linux_amd64.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-go_linux_amd64.tar.gz) | `tar -xzf`, set the environment, run the binary |
| Go | Linux arm64 | [`..._linux_arm64.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-go_linux_arm64.tar.gz) | the same |
| Go | macOS Apple silicon | [`..._darwin_arm64.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-go_darwin_arm64.tar.gz) | `tar -xzf`, then `xattr -d com.apple.quarantine hosted-fields-examples-go` — the binary is not notarised |
| Go | Windows x64 | [`..._windows_amd64.zip`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-go_windows_amd64.zip) | unzip, set the environment, run the `.exe` |
| Node.js | any | [`...nodejs-express-js.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-nodejs-express-js.tar.gz) | `tar -xzf`, then `node server.js` — needs Node 20+, no `npm install` |
| PHP | any | [`...php.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-php.tar.gz) | `tar -xzf`, then `php -S 127.0.0.1:3003 router.php` — needs PHP 8.4+, no Composer |
| Python | any | [`...python.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-python.tar.gz) | `tar -xzf`, then `pip install -r requirements.txt` in a venv and `python app.py` — needs Python 3.12+ |
| Next.js | any | [`...nextjs.tar.gz`](https://github.com/payneteasy/hosted-fields-examples/releases/latest/download/hosted-fields-examples-nextjs.tar.gz) | the same, `node server.js` — but the URL prefix is compiled in, so rebuild from source to change it |

The Linux archives also carry `deploy/` with a systemd unit, an nginx snippet and an environment
template. The macOS and Windows builds do not: those are for trying the example on a laptop.

Or clone the repository and run from source — see [Run](#run) below.

## What Hosted Fields buy you

The card number, expiry date and CVV are `<iframe>`s served by the payment gateway. They are not
your inputs, your page cannot read them, and the card never reaches your server — so your server
stays out of PCI scope.

The layout, the copy, the light and dark themes and the result panel are all yours; only the
three boxes holding card data are not.

## The flow

Identical in every example. `{prefix}` is the URL prefix each app is mounted under.

| # | Where | What happens |
| - | ----- | ------------ |
| 1 | `GET {prefix}/` and `{prefix}/config.js` | the page, then the config it needs — including a single-use `ephemeralTicket`, fresh on every load |
| 2 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 3 | `POST {prefix}/pay` | the server sends a Sale with `hosted_fields_token` in place of the card parameters |
| 4 | `GET {prefix}/status` | the page polls the order status every four seconds until a final status |
| 5 | `POST {prefix}/result/callback` | where the gateway returns the payer after a 3DS challenge; its `control` checksum is verified, then a `303` to the page with the same signed parameters |
| 6 | `GET {prefix}/result` | the return page; the checksum is verified again before anything is served, so an edited URL gets a `403` |

The page itself is never generated. The server hands it `window.CONFIG` as a separate
`{prefix}/config.js` — a fresh single-use ticket per page load — and that is the only thing any
of these servers generates. It is what lets the same HTML file serve from every one of them.

The card data goes from the iframes straight to the gateway. Your server only ever sees a token.

## Before you start

Ask the gateway for these. Every one is per-installation, and none of them belong in this repository:

| | |
| --- | --- |
| `API_URL` | the gateway root, e.g. `https://<gateway-host>/paynet` |
| `SDK_URL` | the Hosted Fields script, on that same host — the SDK refuses to run when served from the merchant origin |
| `ENDPOINT_ID` | the endpoint the payments go to |
| `MERCHANT_LOGIN` | signs the API calls as `oauth_consumer_key` |
| `MERCHANT_CONTROL` | shared secret; the 3DS return callback is verified against it |
| RSA private key | PKCS#8, signs every server call |

Put the key next to the app as `private_key.pem` or point `PRIVATE_KEY_PATH` at it. `*.pem`,
`*.key` and `.env` are git-ignored repository wide — keep it that way.

None of these have defaults. Every example refuses to serve a payment until all of them are set,
rather than falling back to a host baked in at some point and forgotten. Go, Express and Flask
check at startup; Next checks on the first request, so that a build needs no credentials, and PHP
on every request, because it has no startup to check at.

## Run

They all mount everything under a URL prefix, so they can sit behind one nginx at once, and they
all listen on `127.0.0.1` by default — they speak plain HTTP and trust `X-Forwarded-For`, so a
proxy belongs in front.

```bash
# Go — needs Go 1.24+, no dependencies at all
cd go-js
cp .env.example .env          # fill in the gateway URLs and your credentials
go run .                      # http://localhost:3001/hosted-fields-examples-go/
```

```bash
# Node.js — needs Node 20+, one dependency (express)
cd nodejs-express-js
npm install
cp .env.example .env          # the same values
npm start                     # http://localhost:3000/hosted-fields-examples-nodejs-express-js/
```

```bash
# PHP — needs PHP 8.4+ with curl and openssl, no Composer
cd php-js
cp .env.example .env          # the same values
php -S 127.0.0.1:3003 router.php   # http://localhost:3003/hosted-fields-examples-php/
```

```bash
# Python — needs Python 3.12+
cd python-flask-js
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # the same values
.venv/bin/python app.py       # http://localhost:3004/hosted-fields-examples-python/
```

```bash
# Next.js — needs Node 20+, yarn
cd nextjs
yarn install
cp .env.example .env          # the same values again
yarn dev                      # http://localhost:3002/hosted-fields-examples-nextjs/
```

Sandbox test card: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Each app has its own README with the details — settings, the 3DS return, deployment behind nginx:
[go-js/README.md](go-js/README.md) · [nodejs-express-js/README.md](nodejs-express-js/README.md) ·
[php-js/README.md](php-js/README.md) · [python-flask-js/README.md](python-flask-js/README.md) ·
[nextjs/README.md](nextjs/README.md)

## Layout

```
shared/                 the browser half, once
scripts/sync-shared.sh  copies it into every app
go-js/                  Go + plain JS, assets embedded in the binary
nodejs-express-js/      Node.js + Express + plain JS
php-js/                 PHP + plain JS, no Composer
python-flask-js/        Python + Flask + plain JS
nextjs/                 Next.js + React + TypeScript
e2e-tests/              a fake gateway, and every app driven through a browser
```

The copies stay committed, so every app directory runs on its own with no pre-step and the
release archives carry nothing extra. Editing one directly is the mistake to avoid:

```bash
# edit shared/, then
./scripts/sync-shared.sh
```

CI runs that script and then `git diff --exit-code`, so an unsynced copy fails the push. There
is no per-file list anywhere and no line that is allowed to differ — the config injection left
the HTML and became `config.js`, which is why a fourth or a seventh language costs nothing here.

`nextjs/` takes only `styles.css`: its scripts and views are React components. That one shared
file is what keeps them from looking different.

## What an example leaves for you

Everything above is the integration. These are the parts a shop needs and an example does not
have, listed so that copying this code does not quietly copy the gaps too:

- **`GET /status` is not authorised.** It takes the two order ids from the query and asks the
  gateway with the merchant's own credentials, so anyone holding those ids can read the order —
  card last four, holder, bank message. The ids are random rather than sequential, which makes
  them impractical to guess, but that is not the same as a check. A shop should tie the order to
  a payer session or a signed cookie and serve the status only to the session that paid.
- **Nothing is stored.** There is no order table and no ledger: the page polls the gateway and
  the page is all there is. A shop reconciles against its own records.
- **Nothing is rate limited.** Each page load spends an ephemeral ticket, and nothing stops a
  caller from loading the page in a loop.
- **The billing address in the Sale is demo data** — the Seattle address in every `paynet.*` is
  there so the call is complete. Send the payer's real one.
- **The apps bind to `127.0.0.1`** and take `X-Forwarded-For` on trust, because they speak plain
  HTTP and expect nginx in front. Exposed directly, the address the gateway screens for fraud
  becomes whatever the caller says it is.

## A note on the payer-facing language

This repository is English throughout. The payer can still see another language: field validation
messages come from the SDK bundle the gateway serves, as `error.payerMessage`, not from this code.
If you show the payer text in a language of your own, switch on `error.code` and supply your own
string — codes are stable and are never reused.

## Checking them all at once

The examples are the same payment written once per language, and `e2e-tests/` is what checks that
they still are. It starts a fake gateway on one local origin — the API the servers call and the
Hosted Fields SDK the browser loads — points every app at it with environment variables, and
drives a real browser through the payment.

```bash
cd e2e-tests
npm install && npm run browser   # once
npm test
```

It runs locally only, not in CI, and it needs every toolchain. The signatures and the 3DS
checksum are verified rather than accepted, so a green run means the whole handshake works and
not just that a page rendered. See [`e2e-tests/README.md`](e2e-tests/README.md).

## Documentation

- [Hosted Fields integration][docs] — the flow, the SDK, error codes, appearance and restrictions
- [OAuth RSA-SHA256 signing](https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html)
- [Merchant callback parameters](https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html)

[docs]: https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html
