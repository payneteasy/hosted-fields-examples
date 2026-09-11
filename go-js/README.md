# Hosted Fields example — Go + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
The standard library is the only dependency, and the pages and client scripts are embedded into the binary.

## Run

```bash
cp .env.example .env   # fill in ENDPOINT_ID and MERCHANT_LOGIN
go run .
```

Open <http://localhost:3001/hosted-fields-examples-go/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read at
startup and never overrides a variable the environment already has.
The RSA key signs the server calls and must never be exposed to the browser — point
`PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in `PRIVATE_KEY` as a single line
with escaped `\n`.

## Flow

| # | Where | What |
| - | ----- | ---- |
| 1 | `GET {prefix}/` | the server obtains a single-use `ephemeralTicket` (`/api/v4/tokenize/create-ephemeral-ticket/`) and embeds it into the page |
| 2 | browser | the SDK creates the `pan` / `exp` / `cvv` iframes; `sdk.tokenize(ticket)` exchanges the card for a `hostedFieldsToken` |
| 3 | `POST {prefix}/pay` | the server sends a Sale (`/api/v4/sale/`) with `hosted_fields_token` instead of the card parameters |
| 4 | `GET {prefix}/status` | the page polls the order status (`/api/v4/status/`) every 4 seconds until a final status |
| 5 | `GET`/`POST {prefix}/result` | where the payer lands after a 3DS challenge; the gateway returns them with a POST, whose `control` checksum is verified before the page renders |

## The 3DS return

The gateway returns the payer to `redirect_url` with a **POST**, not a GET, and signs the
parameters:

```
control = sha1(status + orderid + merchant_order + MERCHANT_CONTROL)
```

`/result` recomputes that checksum and answers `403` when it does not match, so the order
identifiers the page then polls with come from the gateway rather than from the browser.
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
from it and are worth knowing when reading [paynet.go](paynet.go):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. That body carries `error-message`, so it is decoded
  and passed on to the page instead of being treated as a failed call.

## Build

```bash
go build -o hosted-fields-examples-go .
```

`views/` and `public/` are embedded with `//go:embed`, so the artefact is one static binary
with no runtime files beside it.

## Deploy behind nginx

Templates live in [deploy/](deploy). The app speaks plain HTTP on loopback; nginx terminates TLS
and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the binary
GOOS=linux GOARCH=amd64 go build -o hosted-fields-examples-go .
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-go
install -m 755 hosted-fields-examples-go /opt/hosted-fields-examples-go/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-go.key

# 3. settings
cp deploy/hosted-fields-examples-go.env.example /etc/hosted-fields-examples-go.env
chmod 640 /etc/hosted-fields-examples-go.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-go.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-go

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-go.conf
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
config.go     environment variables
oauth.go      OAuth 1.0a RSA-SHA256 signing
paynet.go     the three gateway calls
main.go       routes under BASE_PATH
views/        payment page, 3DS return page
public/       stylesheet and client scripts
```
