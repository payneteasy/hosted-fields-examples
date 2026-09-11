# Hosted Fields example — Python + Flask + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
Two runtime dependencies, both unavoidable: **Flask**, which is the point of the example, and
**cryptography**, because Python has no RSA in the standard library. The gateway calls go through
`urllib.request` and the tests through `unittest` — nothing is installed for either.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env     # fill in ENDPOINT_ID and MERCHANT_LOGIN
.venv/bin/python app.py
```

Open <http://localhost:3004/hosted-fields-examples-python/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

`python app.py` is the Werkzeug development server, and `debug` is off deliberately — see
[CLAUDE.md](CLAUDE.md). For anything else, gunicorn: [Deploy behind nginx](#deploy-behind-nginx).

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read by
`settings.py` and never overrides a variable the environment already has, so a shell value wins
over the file — which is also why `python-dotenv` is not a dependency.

The five gateway settings have no defaults and are checked **when `settings.py` is imported**,
which for both `python app.py` and gunicorn is the startup: the app refuses to boot rather than
serving a page that cannot take a payment. `python -m compileall` does not import anything and
the tests stub the environment, so neither needs credentials.

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

All seven live on one `Blueprint(url_prefix=BASE_PATH)`. `public/` is mounted on the prefix itself
(`static_url_path=BASE_PATH`), so the pages can link their assets relatively; `views/` sits
outside it and is never reachable as a file. A request for the bare prefix gets a **308** to
`{prefix}/` from Flask's own `strict_slashes` — the other examples hand-write a 302 or a 307 for
the same reason, which is that the pages' asset URLs are relative.

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

`valid_callback()` in [control.py](control.py) takes a `request.form` or a `request.args`
directly, and `.get()` on either returns the first of a repeated name — so the value verified is
the value forwarded, which is what the second check depends on.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [paynet.py](paynet.py):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. `urllib.request.urlopen` *raises* on a 4xx, so that
  body is read off the `HTTPError` and decoded like any other reply. Letting the exception
  propagate instead would turn every decline into a `502`.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -t .
```

The two pieces that fail silently: the OAuth signature base string and the 3DS callback
checksum. The vectors are the same ones `go-js`, `nodejs-express-js` and `php-js` check, computed
outside all of them, so an example that drifts fails here rather than agreeing with itself.

## Deploy behind nginx

Templates live in [deploy/](deploy). gunicorn speaks plain HTTP on loopback under systemd; nginx
terminates TLS and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the app and its virtualenv
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-python
rsync -a --exclude .venv --exclude __pycache__ ./ /opt/hosted-fields-examples-python/
python3 -m venv /opt/hosted-fields-examples-python/.venv
/opt/hosted-fields-examples-python/.venv/bin/pip install -r requirements.txt

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-python.key

# 3. settings
cp deploy/hosted-fields-examples-python.env.example /etc/hosted-fields-examples-python.env
chmod 640 /etc/hosted-fields-examples-python.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-python.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-python

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-python.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app — it
  routes on `BASE_PATH` rather than having nginx strip it.
- **`X-Forwarded-For` must be set.** `ProxyFix` in [app.py](app.py) reads the address that header
  attributes to the client and the app sends it to the platform for fraud screening; without the
  header every payer looks like the proxy. `ProxyFix(x_for=1)` counts one trusted proxy from the
  right, so a caller cannot prepend an address of their own — the other examples take the
  leftmost entry and can be told what to believe.

To run a second example on the same host, give it its own port and its own `BASE_PATH`, and add
one more pair of `location` blocks.

## Files

```
settings.py   environment variables, validation and the key
oauth.py      OAuth 1.0a RSA-SHA256 signing
control.py    the 3DS callback checksum
paynet.py     the three gateway calls
app.py        routes under BASE_PATH, and the generated config.js
tests/        the OAuth base string, the callback checksum, the log line
views/        payment page, 3DS return page   — copies of shared/, do not edit
public/       stylesheet and client scripts   — copies of shared/, do not edit
```
