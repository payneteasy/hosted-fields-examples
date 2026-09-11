# Hosted Fields example — Ruby + Sinatra + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
Three gems, and none of them for the integration: **sinatra** because it is the subject, and
**puma** and **rackup** because Sinatra 4 runs on Rack 3 and brings no server of its own. The
signing is `openssl`, the calls are `net/http` and the tests are `minitest` — all standard library.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
bundle install
cp .env.example .env   # fill in ENDPOINT_ID and MERCHANT_LOGIN
bundle exec ruby app.rb
```

Open <http://localhost:3005/hosted-fields-examples-ruby/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Needs Ruby 3.1 or newer — note that macOS ships an end-of-life 2.6 as `/usr/bin/ruby`, which
Sinatra 4 will not run on. `ruby app.rb` is Sinatra's development server; for anything else puma,
see [Deploy behind nginx](#deploy-behind-nginx).

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read by
`settings.rb` and never overrides a variable the environment already has, so a shell value wins
over the file — which is why there is no dotenv gem here.

The five gateway settings have no defaults and are checked **when `settings.rb` is required**,
which for both `ruby app.rb` and puma is the startup: the app refuses to boot rather than serving
a page that cannot take a payment. `ruby -c` loads nothing and the tests stub the environment, so
neither needs credentials.

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

Sinatra has no route prefix of its own, so `BASE_PATH` is interpolated into every pattern in
[app.rb](app.rb). A `map` in [config.ru](config.ru) would prefix them too, but then `ruby app.rb`
and `puma config.ru` would not agree on the URLs, and the point of the example is that the same
seven paths are served whatever starts them.

`public/` is served by an allowlisted route rather than by Sinatra's `public_folder`, which serves
at the root and not under the prefix. That allowlist — `styles.css`, `status.js`, `checkout.js`,
`result.js` — is also what keeps `views/`, `.env`, `Gemfile` and the sources unreachable.

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

Two Sinatra defaults are turned off in `configure` for this route's sake, and both would have been
quiet about it:

- **`http_origin`** in rack-protection answers any cross-origin POST with a `403`, and the gateway
  posts the 3DS return from its own origin. The callback is authenticated by `control`, a shared
  secret, not by where it came from.
- **`absolute_redirects`** would build the `303`'s `Location` from the request's own scheme and
  host, which behind a TLS-terminating proxy sends the payer back over `http://`. Every example
  here emits a relative `Location`.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading [paynet.rb](paynet.rb):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. `Net::HTTP` hands a 4xx back like any other
  response rather than raising, so that body is decoded as usual and its `error-message` passed
  to the page. Only a reply that is not a JSON object at all is a failed call.

## Tests

```bash
ruby test/all.rb
```

No `bundle exec`: the tests touch no gem at all, and minitest is a *bundled* gem, which
`bundle exec` hides from the load path unless the `Gemfile` names it. Leaving it out of the
Gemfile is the point — the checksum and the base string are plain Ruby.

The two pieces that fail silently: the OAuth signature base string and the 3DS callback
checksum. The vectors are the same ones `go-js`, `nodejs-express-js`, `php-js` and
`python-flask-js` check, computed outside all of them, so an example that drifts fails here
rather than agreeing with itself.

## Deploy behind nginx

Templates live in [deploy/](deploy). puma speaks plain HTTP on loopback under systemd; nginx
terminates TLS and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the app and its gems, vendored so the box needs no network at boot
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-ruby
rsync -a --exclude vendor --exclude .bundle ./ /opt/hosted-fields-examples-ruby/
cd /opt/hosted-fields-examples-ruby
bundle config set --local path vendor/bundle
bundle config set --local without development:test
bundle install

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-ruby.key

# 3. settings
cp deploy/hosted-fields-examples-ruby.env.example /etc/hosted-fields-examples-ruby.env
chmod 640 /etc/hosted-fields-examples-ruby.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-ruby.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-ruby

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-ruby.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app — it
  routes on `BASE_PATH` rather than having nginx strip it.
- **`X-Forwarded-For` must be set.** The app takes the payer's address from that header on trust
  and sends it to the platform for fraud screening; without it every payer looks like the proxy.
  `ExecStart` also names an absolute `bundle`: check where yours lives, since a Ruby from a
  version manager will not be at `/usr/local/bin`.

To run a second example on the same host, give it its own port and its own `BASE_PATH`, and add
one more pair of `location` blocks.

## Files

```
settings.rb   environment variables, validation and the key
oauth.rb      OAuth 1.0a RSA-SHA256 signing
control.rb    the 3DS callback checksum
paynet.rb     the three gateway calls
app.rb        routes under BASE_PATH, and the generated config.js
config.ru     the rack entry point, for puma
test/         the OAuth base string, the callback checksum, the log line
views/        payment page, 3DS return page   — copies of shared/, do not edit
public/       stylesheet and client scripts   — copies of shared/, do not edit
```
