# Hosted Fields example — Java + Spring Boot + plain JS

A minimal merchant integration of [Hosted Fields](https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html):
the card fields are iframes served by the payment gateway, so no card data ever reaches this app.

Everything is mounted under a single URL prefix (`BASE_PATH`), so several such examples can live behind one nginx.
One dependency, and it is the subject: **spring-boot-starter-web**. Nothing is added for the
integration itself — `java.net.http` calls the gateway, `java.security` signs, and `MessageDigest`,
`HexFormat` and `SecureRandom` do the rest. JUnit tests it, and Spotless and NullAway check it, all
from the build.

The browser half is not written here: it lives in [`shared/`](../shared/) and
[`scripts/sync-shared.sh`](../scripts/sync-shared.sh) copies it into `public/` and `views/`.
Edit it there, run the script, commit both — CI fails a copy that has drifted.

## Run

```bash
cp .env.example .env      # fill in ENDPOINT_ID and MERCHANT_LOGIN
./mvnw spring-boot:run
```

Open <http://localhost:3006/hosted-fields-examples-java/>.

Test card for the sandbox: `4444 4444 4444 4448`, any future expiry, CVV `123`.

Needs a JDK 21 or newer. Nothing else: `./mvnw` is the [Maven wrapper](.mvn/wrapper/maven-wrapper.properties)
and downloads the Maven it needs on first use, so no Maven has to be installed. For a server,
`./mvnw package` and then `java -jar` — see [Deploy behind nginx](#deploy-behind-nginx).

## Settings

All settings are environment variables, see [.env.example](.env.example). `.env` is read by
[Settings.java](src/main/java/com/payneteasy/hostedfields/Settings.java) and consulted *after* the
real environment, so a shell value wins over the file — which is why there is no dotenv library
here, and why a harness can drive the app without writing an `.env`.

The five gateway settings have no defaults and are checked **in `main`, before the servlet
container is built**: the app refuses to boot rather than serving a page that cannot take a
payment. That is also where the port, the interface and `BASE_PATH` are read, because all three
decide how the container is built — and it is why `./mvnw verify` needs no credentials, since
nothing is validated at class initialisation.

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

`BASE_PATH` is the servlet **context path**, set in `main` before the container starts, so the
mappings in [Routes.java](src/main/java/com/payneteasy/hostedfields/Routes.java) are the seven
paths above and nothing repeats the prefix. It also buys Tomcat's own redirect from the bare prefix
to the trailing-slash form, which is what the relative `href="styles.css"` and `src="config.js"` on
the pages need.

`public/` and `views/` are packaged **into the jar** and served from there — the Java counterpart
of the `//go:embed` in `go-js`, and what makes the artefact one file with nothing beside it.
`public/` goes out through an allowlist of four names rather than Spring's static resource handler,
which is switched off in [application.properties](src/main/resources/application.properties): the
files are packaged at `classpath:/public/`, one of the locations Spring Boot serves by itself, and
left on it would serve them a second way, outside the allowlist and with its own caching headers.

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

- **the body is parsed by hand**, not through `@RequestParam`. The servlet container fills those
  from the query string as well as from the body, and the four values that are verified have to be
  the same four that are forwarded — otherwise `?orderid=…` on the callback URL could change what
  the payer ends up looking at.
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
[Paynet.java](src/main/java/com/payneteasy/hostedfields/Paynet.java):

- the ephemeral ticket arrives as a one-field object, `{"ephemeralTicket": "..."}`, and is read out of it;
- a rejected request (a validation error, a decline) arrives as **4xx with a JSON body**, not as
  `200` the way the form-encoded API answers. `java.net.http.HttpClient` hands a 4xx back like any
  other response rather than throwing, so that body is decoded as usual and its `error-message`
  passed to the page. Only a reply that is not JSON at all is a failed call, and that is the one
  thing `GatewayException` means.

## Tests

```bash
./mvnw test        # or ./mvnw verify, which adds the formatting check and builds the jar
```

The two pieces that fail silently: the OAuth signature base string and the 3DS callback checksum.
The vectors are the same ones `go-js`, `nodejs-express-js`, `php-js`, `python-flask-js` and
`ruby-sinatra-js` check, computed outside all of them, so an example that drifts fails here rather
than agreeing with itself.

No credentials and no stubbed environment, unlike the other examples: `Control`, `OAuth.encode`
and `Paynet.logReason` are plain static methods and `Settings` is built in `main`, so there is
nothing to stub.

Two more checks the other examples get from their language and this one gets from the build:

```bash
./mvnw spotless:apply        # format; `verify` fails on anything unformatted
./mvnw -Perrorprone compile  # Error Prone and NullAway, this example's `go vet`
```

## Deploy behind nginx

Templates live in [deploy/](deploy). The jar speaks plain HTTP on loopback under systemd; nginx
terminates TLS and routes by the `BASE_PATH` prefix, so several examples share one server block.

```bash
# 1. the application, which is one file — the pages and scripts are inside it
./mvnw package
install -d -o hosted-fields -g hosted-fields /opt/hosted-fields-examples-java
install -o hosted-fields -g hosted-fields target/hosted-fields-example-java.jar \
        /opt/hosted-fields-examples-java/

# 2. the RSA key as a file, not an env variable
install -m 640 -o root -g hosted-fields private_key.pem /etc/hosted-fields-examples-java.key

# 3. settings
cp deploy/hosted-fields-examples-java.env.example /etc/hosted-fields-examples-java.env
chmod 640 /etc/hosted-fields-examples-java.env   # then fill in ENDPOINT_ID, MERCHANT_LOGIN, PUBLIC_URL

# 4. service
cp deploy/hosted-fields-examples-java.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hosted-fields-examples-java

# 5. nginx
cp deploy/nginx.conf /etc/nginx/snippets/hosted-fields-examples-java.conf
# include it from your server { } block, then:
nginx -t && systemctl reload nginx
```

Three things to get right:

- **`PUBLIC_URL`** is the origin the payer's browser sees (`https://…`). It builds the absolute
  `redirect_url` the payer returns to after a 3DS challenge; a wrong value strands them.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app — it is the
  servlet context path rather than something nginx strips.
- **`X-Forwarded-For` must be set.** The app takes the payer's address from that header on trust
  and sends it to the platform for fraud screening; without it every payer looks like the proxy.
  `ExecStart` names `/usr/bin/java`: check where the JRE 21 on your box actually is.

To run a second example on the same host, give it its own port and its own `BASE_PATH`, and add
one more pair of `location` blocks.

## Files

```
Settings.java     environment variables, validation and the key
OAuth.java        OAuth 1.0a RSA-SHA256 signing
Control.java      the 3DS callback checksum
Paynet.java       the three gateway calls
GatewayException  a call that produced no answer — never a decline
Routes.java       routes under BASE_PATH, and the generated config.js
Application.java  main: settings, then the server
src/test/java/    the OAuth base string, the callback checksum, the log line
views/            payment page, 3DS return page   — copies of shared/, do not edit
public/           stylesheet and client scripts   — copies of shared/, do not edit
```

The Java sources are under `src/main/java/com/payneteasy/hostedfields/`, which Maven requires;
everything else sits where the other examples keep it.
