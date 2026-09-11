# Hosted Fields examples

Two working merchant integrations of [Hosted Fields][docs], one on Go and one on Node.js. Same
payment, same screens, same flow — only the server language differs.

## The examples

| | Server | Read the code | Start here |
| --- | --- | --- | --- |
| **Go** | Go 1.24+, standard library only | [`go-js/`](go-js/) | [`main.go`](go-js/main.go) routes · [`paynet.go`](go-js/paynet.go) the three gateway calls · [`oauth.go`](go-js/oauth.go) request signing |
| **Node.js** | Node 20+, express only | [`nodejs-express-js/`](nodejs-express-js/) | [`src/server.js`](nodejs-express-js/src/server.js) routes · [`src/paynet.js`](nodejs-express-js/src/paynet.js) the three gateway calls · [`src/oauth.js`](nodejs-express-js/src/oauth.js) request signing |

The browser half is shared and **byte-for-byte identical** between them —
[`public/checkout.js`](go-js/public/checkout.js) sets up the fields and tokenizes,
[`public/status.js`](go-js/public/status.js) polls the order,
[`views/checkout.html`](go-js/views/checkout.html) is the page. That is the point of having two:
everything interesting about Hosted Fields happens in the page, and the server behind it is
interchangeable. Pick whichever language you work in and ignore the other.

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

Identical in both examples. `{prefix}` is the URL prefix each app is mounted under.

| # | Where | What happens |
| - | ----- | ------------ |
| 1 | `GET {prefix}/` | the server obtains a single-use `ephemeralTicket` and embeds it in the page |
| 2 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 3 | `POST {prefix}/pay` | the server sends a Sale with `hosted_fields_token` in place of the card parameters |
| 4 | `GET {prefix}/status` | the page polls the order status every four seconds until a final status |
| 5 | `GET`/`POST {prefix}/result` | where the payer lands after a 3DS challenge; the gateway returns them with a POST whose `control` checksum is verified before the page renders |

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

None of these have defaults. Both apps refuse to start until every one of them is set, rather
than falling back to a host baked in at some point and forgotten.

## Run

Both apps mount everything under a URL prefix, so they can sit behind one nginx at once.

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

Sandbox test card: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Each app has its own README with the details — settings, the 3DS return, deployment behind nginx:
[go-js/README.md](go-js/README.md) · [nodejs-express-js/README.md](nodejs-express-js/README.md)

## Layout

```
go-js/                  Go + plain JS, assets embedded in the binary
nodejs-express-js/      Node.js + Express + plain JS
```

Five files are **shared and must stay byte-for-byte identical** between the two:

```
public/styles.css  public/status.js  public/checkout.js
views/checkout.html  views/result.html
```

Exactly one line may differ — the config injection, which uses each server's template syntax:

```
go-js:              <script>window.CONFIG = {{ . }};</script>
nodejs-express-js:  <script>window.CONFIG = __CONFIG__;</script>
```

Edit one copy, copy it across, swap that line back. CI checks this on every push, because the
whole premise of the repository is that the browser half does not depend on the server.

## A note on the payer-facing language

This repository is English throughout. The payer can still see another language: field validation
messages come from the SDK bundle the gateway serves, as `error.payerMessage`, not from this code.
If you show the payer text in a language of your own, switch on `error.code` and supply your own
string — codes are stable and are never reused.

## Documentation

- [Hosted Fields integration][docs] — the flow, the SDK, error codes, appearance and restrictions
- [OAuth RSA-SHA256 signing](https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html)
- [Merchant callback parameters](https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html)

[docs]: https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html
