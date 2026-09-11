# Hosted Fields example — .NET + ASP.NET Core + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
A port of [`go-js/`](../go-js/), file for file. Minimal APIs and no MVC, no template engine, and
**no NuGet package at all** — Kestrel, `HttpClient`, RSA and `System.Text.Json` all ship with the
platform. The pages and the client scripts are compiled into the assembly.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
cp .env.example .env   # fill in ENDPOINT_ID and MERCHANT_LOGIN
dotnet run
```

Open <http://localhost:3008/hosted-fields-examples-dotnet/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Needs the .NET 10 SDK. There is no solution file, so `dotnet run` in this directory picks the one
project here; the tests under `tests/` are named explicitly.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read at
startup and never overrides a variable the environment already has.
The RSA key signs the server calls and must never be exposed to the browser — point
`PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in `PRIVATE_KEY` as a single line
with escaped `\n`.

Everything is read and validated in `Main`, before the listener is opened, so a missing credential
stops the process instead of surfacing later as a payment page that cannot take a payment —
and `dotnet build` and `dotnet test` need no credentials at all.

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

A request for the bare prefix, without the trailing slash, is answered with a `301` to
`{prefix}/` — the page's asset URLs are relative and resolve against that form.

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

The callback body is read with `ReadFormAsync`, which reads the body and nothing else, so the four
values verified are the four forwarded. A repeated name keeps its first value, in the callback body
and in the `/result` query alike.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [Paynet.cs](Paynet.cs):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. That body carries `error-message`, so it is decoded
  and passed on to the page instead of being treated as a failed call.

A reply is decoded into `Dictionary<string, JsonElement>` rather than a model class, because the
gateway answers `paynet-order-id` as a number in a sale reply and as a string everywhere else. A
typed model turns that difference into "the reply is not JSON" on a perfectly good answer.

## Tests

```bash
dotnet test tests/HostedFields.Tests.csproj
```

xUnit, no credentials. They cover the two pieces that fail silently — the OAuth signature base
string and the 3DS callback checksum — on the same vectors as the Go and Express examples, plus
the log line that must never carry the card, the holder or the ticket.

## Build

```bash
dotnet publish HostedFields.csproj -c Release -o out
dotnet out/hosted-fields-example-dotnet.dll
```

`views/` and `public/` are compiled in as embedded resources, so the artefact is the assembly and
nothing else — the analogue of Go's `//go:embed` and of the pages packaged into the Java example's
jar. Change a page and you have to rebuild; there is nothing to edit on a server.

The publish is framework-dependent and platform-neutral: it needs the .NET 10 runtime on the
target and runs unchanged on any of them.

## Deploy behind nginx

Templates live in [deploy/](deploy). The app speaks plain HTTP on loopback; nginx terminates TLS
and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the application, which is one assembly — the pages and scripts are inside it
dotnet publish HostedFields.csproj -c Release -o out
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-dotnet
cp -r out/. /opt/hosted-fields-examples-dotnet/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-dotnet.key

# 3. settings
cp deploy/hosted-fields-examples-dotnet.env.example /etc/hosted-fields-examples-dotnet.env
chmod 640 /etc/hosted-fields-examples-dotnet.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-dotnet.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-dotnet

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-dotnet.conf
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
Settings.cs   environment variables plus a small .env reader
OAuth.cs      OAuth 1.0a RSA-SHA256 signing
Control.cs    the checksum the gateway signs its 3DS callbacks with
Paynet.cs     the three gateway calls
Program.cs    routes under BASE_PATH, and the generated config.js
tests/        the signature base string, the checksum, and the log line
views/        payment page, 3DS return page   — copies of shared/, do not edit
public/       stylesheet and client scripts   — copies of shared/, do not edit
```
