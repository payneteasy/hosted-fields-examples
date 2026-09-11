# Hosted Fields example — Kotlin + Ktor + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
Two dependencies, and one of them is the subject: **Ktor** and **kotlinx.serialization**, which is
here only because the JVM has no JSON of its own. Nothing is added for the integration itself —
`java.net.http` calls the gateway, `java.security` signs, and `MessageDigest`, `HexFormat` and
`SecureRandom` do the rest. `kotlin.test` tests it and ktlint checks it, both from the build.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
cp .env.example .env      # fill in ENDPOINT_ID and MERCHANT_LOGIN
./gradlew run
```

Open <http://localhost:3009/hosted-fields-examples-kotlin/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Needs a JDK 21 or newer. Nothing else: `./gradlew` is the Gradle wrapper and downloads the Gradle
it needs on first use, so no Gradle has to be installed. For a server, `./gradlew buildFatJar` and
then `java -jar` — see [Deploy behind nginx](#deploy-behind-nginx).

Unlike every other file in this repository, `gradle/wrapper/gradle-wrapper.jar` is a binary. Gradle
has no script-only wrapper the way Maven does, and the alternative is asking every reader to
install Gradle first. It is the stock wrapper, the distribution it fetches is pinned by SHA-256 in
[gradle-wrapper.properties](gradle/wrapper/gradle-wrapper.properties), and CI verifies the jar
itself with `gradle/actions/wrapper-validation`.

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read by
[Settings.kt](src/main/kotlin/com/payneteasy/hostedfields/Settings.kt) and consulted *after* the
real environment, so a shell value wins over the file — which is why there is no dotenv library
here, and why a harness can drive the app without writing an `.env`.

The five gateway settings have no defaults and are checked **in `main`, before the engine is
built**: the app refuses to boot rather than serving a page that cannot take a payment. That is
also where the port and the interface are read, because both decide how the engine is built — and
it is why `./gradlew build` needs no credentials, since nothing is validated at class
initialisation.

The RSA key signs the server calls and must never be exposed to the browser — point
`PRIVATE_KEY_PATH` at the key file, or pass the PEM inline in `PRIVATE_KEY` as a single line
with escaped `\n`. It has to be **PKCS#8**, the only format `KeyFactory` reads; a key whose header
says `BEGIN RSA PRIVATE KEY` is PKCS#1 and the app says so and names the conversion:

```bash
openssl pkcs8 -topk8 -nocrypt -in private_key.pem -out private_key.pk8.pem
```

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

Ktor has no context path, so every route in
[Routing.kt](src/main/kotlin/com/payneteasy/hostedfields/Routing.kt) spells `BASE_PATH` out — and
the redirect from the bare prefix to the trailing-slash form, which Go's mux and Tomcat send by
themselves, is a route of its own here. It has to be: the pages carry relative `href="styles.css"`
and `src="config.js"`, which resolve one segment too high from the prefix without its slash.
`IgnoreTrailingSlash` is deliberately *not* installed, because it would make the two the same
route and take that redirect away.

`public/` and `views/` are packaged **into the jar** and served from there — the Kotlin counterpart
of the `//go:embed` in `go-js`, and what makes the artefact one file with nothing beside it.
`public/` goes out through an allowlist of four names rather than Ktor's `staticResources`, which
is never installed: left to itself it would serve the class files and the views a second way, with
caching headers of its own.

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

Two details of that route are worth reading:

- **the body is parsed by hand**, not through `call.receiveParameters()`. The four values that are
  verified have to be provably the same four that are forwarded, and a parser written out in ten
  lines says so more plainly than a framework's does.
- **the `303` carries a relative `Location`.** An absolute one built from this request's own scheme
  would send the payer back over `http://` from behind a TLS-terminating proxy.

## Response format

The server calls ask for JSON with an `Accept` header, which is easier to parse than the
default form-encoded reply:

```
Accept: application/vnd.pay+json
```

See [the OpenAPI notes](https://doc.payneteasy.com/integration/openapi.html). Two things follow
from it and are worth knowing when reading
[Paynet.kt](src/main/kotlin/com/payneteasy/hostedfields/Paynet.kt):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. `java.net.http.HttpClient` hands a 4xx back like any
  other response rather than throwing, so that body is decoded as usual and its `error-message`
  passed to the page. Only a reply that is not JSON at all is a failed call, and that is the one
  thing `GatewayException` means.

That client is blocking, and a Ktor handler runs on a Netty event-loop thread — so every call goes
out inside `withContext(Dispatchers.IO)`. Blocking one of those threads stalls every other request
the server is serving, which is the one thing this example would get wrong if it read like
ordinary JVM code.

## Tests

```bash
./gradlew test       # or ./gradlew build, which adds the compiler checks and builds the jar
```

The two pieces that fail silently: the OAuth signature base string and the 3DS callback checksum.
The vectors are the same ones `go-js`, `nodejs-express-js`, `php-js`, `python-flask-js`,
`ruby-sinatra-js` and `java-springboot-js` check, computed outside all of them, so an example that
drifts fails here rather than agreeing with itself.

No credentials and no stubbed environment: `Control`, `OAuth.encode` and `Paynet.logReason` are
plain functions and `Settings` is built in `main`, so there is nothing to stub.

Two more checks the other examples get from their language and this one gets from the build:

```bash
./gradlew ktlintFormat   # format; ktlintCheck fails on anything unformatted
./gradlew build          # allWarningsAsErrors, this example's `go vet`
```

## Deploy behind nginx

Templates live in [deploy/](deploy). The jar speaks plain HTTP on loopback under systemd; nginx
terminates TLS and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the application, which is one file — the pages and scripts are inside it
./gradlew buildFatJar
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-kotlin
install -o hosted-fields -g hosted-fields build/libs/hosted-fields-example-kotlin.jar \
        /opt/hosted-fields-examples-kotlin/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-kotlin.key

# 3. settings
cp deploy/hosted-fields-examples-kotlin.env.example /etc/hosted-fields-examples-kotlin.env
chmod 640 /etc/hosted-fields-examples-kotlin.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-kotlin.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-kotlin

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-kotlin.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app — it routes
  on it rather than having nginx strip it.
- **`X-Forwarded-For` must be set.** The app takes the payer's address from that header on trust
  and sends it to the platform for fraud screening; without it every payer looks like the proxy.
  `ExecStart` names `/usr/bin/java`: check where the JRE 21 on your box actually is.

To run a second example on the same host, give it its own port and its own `BASE_PATH`, and add
one more pair of `location` blocks.

## Files

```
Settings.kt       environment variables, validation and the key
OAuth.kt          OAuth 1.0a RSA-SHA256 signing
Control.kt        the 3DS callback checksum
Paynet.kt         the three gateway calls, and GatewayException
Routing.kt        routes under BASE_PATH, and the generated config.js
Application.kt    main: settings, then the server
src/test/kotlin/  the OAuth base string, the callback checksum, the log line
views/            payment page, 3DS return page   — copies of shared/, do not edit
public/           stylesheet and client scripts   — copies of shared/, do not edit
```

The Kotlin sources are under `src/main/kotlin/com/payneteasy/hostedfields/`, which Gradle expects;
everything else sits where the other examples keep it.
