# Hosted Fields example — PHP + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
No Composer, no framework, no autoloader — PHP 8.4 with `curl`, `openssl` and `json`, which is what a
stock install has. Six files, and four of them are the integration.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
cp .env.example .env   # fill in ENDPOINT_ID and MERCHANT_LOGIN
php -S 127.0.0.1:3003 router.php
```

Open <http://localhost:3003/hosted-fields-examples-php/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

`php -S` is a development server and handles one request at a time; for anything else see
[Deploy behind nginx](#deploy-behind-nginx) below.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read on
demand and never overrides a variable the environment already has, so a shell value or a
PHP-FPM `env[]` line wins over the file.

There is **no `PORT` and no `LISTEN_ADDR`**: PHP does not own the socket. `php -S` is told
where to listen on the command line, and behind nginx the address belongs to nginx and the FPM
pool. `PUBLIC_URL` is a separate setting because it is the origin the payer's browser sees,
which behind a proxy is not the address anything here listens on.

The five gateway settings have no defaults and the app refuses to serve without them. PHP has no
startup to fail at, so unlike the Go and Express examples — which will not boot — this one
answers `500` and logs which name is missing. The same property is what lets the unit tests and
`php -l` run with no credentials at all.

The RSA key signs the server calls and must never be exposed to the browser — point
`PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in `PRIVATE_KEY` as a single line
with escaped `\n`.

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

The form body is parsed by `form_params()` in [index.php](index.php) rather than read out of
`$_POST`, because `$_POST` rewrites `.` and a space in a parameter name and keeps the last of a
repeated one. Verifying one value and forwarding another is exactly the gap the second check is
there to close.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [paynet.php](paynet.php):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. That body carries `error-message`, so it is decoded
  and passed on to the page instead of being treated as a failed call.

## Tests

```bash
php tests/run.php
```

The two pieces that fail silently: the OAuth signature base string and the 3DS callback
checksum. The vectors are the same ones `go-js` and `nodejs-express-js` check, computed outside
all three, so an example that drifts fails here rather than agreeing with itself.

## Deploy behind nginx

Templates live in [deploy/](deploy). PHP-FPM is the service — a pool is what an app is here, so
there is no unit file — and nginx terminates TLS and routes by the `BASE_PATH` prefix, so
several examples share one server block.

```bash
# 1. the app
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-php
cp -r index.php router.php settings.php oauth.php control.php paynet.php public views \
      /opt/hosted-fields-examples-php/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-php.key

# 3. settings, which for FPM live in the pool
cp deploy/hosted-fields-examples-php.pool.conf /etc/php/8.4/fpm/pool.d/hosted-fields-examples-php.conf
chmod 640 /etc/php/8.4/fpm/pool.d/hosted-fields-examples-php.conf   # then fill in the env[] lines
systemctl restart php8.4-fpm

# 4. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-php.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **The whole prefix goes to `index.php`.** There is no `try_files` and no `root` in the
  location block: the app routes on the full path and serves `public/` from an allowlist, which
  is also what keeps `.env`, `views/` and the sources unreachable. Pointing a document root at
  the app directory instead would publish all three.
- **`X-Forwarded-For` must be set.** The app trusts the proxy and sends the payer's address to
  the platform for fraud screening; without the header every payer looks like the proxy.

To run a second example on the same host, give it its own pool, its own socket and its own
`BASE_PATH`, and add one more pair of `location` blocks.

## Files

```
settings.php  environment variables, validation and the key
oauth.php     OAuth 1.0a RSA-SHA256 signing
control.php   the 3DS callback checksum
paynet.php    the three gateway calls
index.php     routes under BASE_PATH, and the generated config.js
router.php    the `php -S` entry point, unused behind nginx
tests/        the OAuth base string and the callback checksum
views/        payment page, 3DS return page   — copies of shared/, do not edit
public/       stylesheet and client scripts   — copies of shared/, do not edit
```
