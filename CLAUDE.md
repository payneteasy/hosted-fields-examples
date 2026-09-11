# Hosted Fields examples

Seven merchant integrations of the same payment — `go-js/`, `nodejs-express-js/`, `php-js/`,
`python-flask-js/`, `ruby-sinatra-js/`, `java-springboot-js/` and `nextjs/`. They exist to be
read, so clarity beats cleverness everywhere in this repository.

## The rule that breaks most often

`shared/` is the source of truth for the browser half, and `scripts/sync-shared.sh` copies it
into every app:

```
shared/public/styles.css  status.js  checkout.js  result.js
shared/views/checkout.html  result.html
```

The copies stay committed, so every app directory still runs on its own with no pre-step. A
frontend change is therefore: **edit `shared/`, run `scripts/sync-shared.sh`, commit both.**
Never edit a copy — the script overwrites it, and CI runs the script and then
`git diff --exit-code`, so forgetting cannot reach main.

`nextjs/` takes only `styles.css`: its scripts and views are React components. That one file is
what keeps every example looking identical.

There are no exceptions and no per-app lines. Nothing in `views/` is templated — see below.

## The server contract

Every app serves the same routes under `BASE_PATH`, and adding a language means implementing
exactly these and nothing else:

| Route | What |
| --- | --- |
| `GET /` | `views/checkout.html`, byte for byte as it is on disk |
| `GET /config.js` | `window.CONFIG = {basePath, sdkUrl, endpointId, amount, currency, ephemeralTicket}` |
| `GET /result-config.js` | the same, without `sdkUrl` and without a ticket |
| `POST /pay` | Sale; JSON in, the gateway's JSON plus `clientOrderId` out, `502 {error}` on failure |
| `GET /status` | order status as JSON, `Cache-Control: no-store` |
| `POST /result/callback` | verify `control`, `403` on a mismatch, else `303` to `/result` with the signed query |
| `GET /result` | verify the query when `orderid` is present, then `views/result.html` |

Four things about it are load-bearing:

- **`config.js` is the only generated thing anywhere.** That is what lets the views be
  identical across languages, so never reintroduce templating into an HTML file.
- **`config.js` is `no-store`** — the ticket in it is single-use — and it must stay valid
  JavaScript even when the gateway call behind it failed: emit `error` in place of
  `ephemeralTicket`, and `checkout.js` tells the payer and kills the button.
- **`POST /pay` never takes a payment parameter from the request.** The body carries a
  `browser` object for 3DS 2.0, and it is filtered against a fixed list of eight
  `customer_browser_*` keys before it goes anywhere near the Sale. `amount`, `currency`,
  `redirect_url`, `hosted_fields_token` and `client_orderid` are the server's, and the Sale is
  built so that they are written after the browser fields rather than before. Merging the body
  over them — which is what the first version did — let a caller choose what to charge.
- **The 3DS return is signed twice over the same checksum.** The gateway POSTs
  `status`/`orderid`/`merchant_order`/`control` to `/result/callback`; the redirect forwards
  those four verbatim, and `GET /result` checks them again with the same function. The browser
  carries them but cannot forge them, so a hand-edited URL gets a `403` instead of a page that
  polls somebody else's order. In `nextjs/` the `403` comes from `src/middleware.ts`, because a
  React page cannot set a status code without an experimental flag.

`nextjs/` is the one exception, and only to the first two rows: a React page gets its config as
props from the server component, so it has no `config.js` and no `result-config.js`. Everything
below those rows it implements exactly as written.

## English only

Code, comments, documentation, commit messages, anything on screen. No Cyrillic anywhere in the
repository.

The payer can still be shown another language, but not from here: `error.payerMessage` comes from
the SDK bundle the gateway serves.

## The DOM contract

These ids are wired to the SDK and to the page scripts. Renaming one means renaming it in
`HostedFields.init()` too, so do not rename them casually:

`cardNumber`, `expiryDate`, `cvv` (also the keys of the `fields` map), `pay`, `formError`,
`orderStatus`.

The three card containers **stay empty in the markup** — the SDK injects an iframe into each. They
are cross-origin, so the page cannot read a value, style the inside with CSS, or attach a
listener. The inside is styled only through the `style` bag passed to `init()`, over an allowlist
of properties; the outside is the container div and is yours.

State arrives as classes the SDK toggles on the container — `hf-field--focus`, `hf-field--filled`,
`hf-field--error` — because `:focus-within` does not cross an origin boundary.

## React, in `nextjs/` only

The SDK injects an iframe into each container and toggles classes on it; React owns the same
elements. Four rules, each explained where it is enforced:

- the containers render **no children** and their `className` is a **constant** — React leaves
  foreign DOM alone, but it rewrites an attribute whose rendered value changed, which would
  wipe `hf-field--focus` / `--filled`. Class changes of our own go through `classList`;
- `HostedFields.init()` runs **once**, behind a ref guard, because React 19 invokes effects
  twice in development StrictMode — and nothing is destroyed on cleanup for the same reason;
- `sdk.setStyle()` is pushed for all three fields on **every** theme change, after the
  `data-theme` attribute is on `<html>`;
- settings are validated **lazily**, not at module import: `next build` imports the route
  modules, and CI builds without credentials.

## PHP, in `php-js/` only

No Composer and no framework, so the whole app is six files of plain functions. Four rules, each
explained where it is enforced:

- **`router.php` never `return false`s.** The app root is the `php -S` document root, so a
  delegated request would serve `.env` or execute `paynet.php`. `index.php` answers every path
  and serves `public/` from an allowlist, which is also why the nginx block has no `root` and no
  `try_files`;
- settings are validated **per request**, in `settings()`, because PHP has no startup to refuse
  at — a missing name is a `500` with the detail in the log, and the tests and `php -l` need no
  credentials;
- the signature encoder is **`rawurlencode`**, and every sort is **`ksort(…, SORT_STRING)`**:
  `urlencode` writes `+` for a space, and the default sort reads numeric-looking keys as numbers;
- forms are parsed by **`form_params()`**, not `$_POST`/`$_GET`, which rewrite `.` and a space in
  a name and keep the last of a repeated one. The 3DS return is verified and then forwarded, and
  those must be the same value.

## Flask, in `python-flask-js/` only

Flask brings a template engine and a router into an example whose whole point is that neither is
used for the page. Four rules, each explained where it is enforced:

- **nothing in `views/` is templated**, which is the easiest rule in the repository to break here
  because Jinja is already in the box. Both pages go out through `send_view`, and `config.js` is
  the only generated thing;
- there is **no global `errorhandler`**: one on `Exception` would catch Werkzeug's `NotFound` and
  answer `502` to every 404, so the two handlers that call the gateway catch for themselves;
- **`debug` stays off.** The Werkzeug debugger is remote code execution behind a payment page, and
  its injected scripts would breach the Content-Security-Policy too;
- **`urlopen` raises on a 4xx**, and a 4xx with a JSON body is a decline rather than a failure —
  so the body is read off the `HTTPError`. This is the one place Python's standard library pushes
  back against the contract, and getting it wrong turns every decline into a `502`.

## Sinatra, in `ruby-sinatra-js/` only

Sinatra and rack-protection both come with defaults that are sensible in general and wrong for
this page. Four rules, each explained where it is enforced:

- **nothing in `views/` is templated**, and `erb` is one method call away — the same hazard Flask
  has. Both pages go out through `send_view`, and `config.js` is the only generated thing;
- **`http_origin` and `frame_options` are off** in `configure`: the first answers the gateway's
  cross-origin 3DS POST with a `403` before the checksum is ever read, the second sends an
  `X-Frame-Options: SAMEORIGIN` that contradicts this app's `frame-ancestors 'none'` and that no
  other example sends. **`absolute_redirects` is off** too, so the `303` carries a relative
  `Location` and a TLS-terminating proxy cannot turn the 3DS return into an `http://` redirect;
- **`static` is off** and `public/` goes out through an allowlist route declared last, because
  Sinatra's `public_folder` serves at the root rather than under `BASE_PATH` and Sinatra matches
  routes in declaration order;
- the signature encoder is **`ERB::Util.url_encode`** and never `CGI.escape`, which is form
  encoding and writes `+` for a space.

## Spring Boot, in `java-springboot-js/` only

Spring Boot brings a template engine, a static file server and a parameter binder, and this page
wants none of the three. Four rules, each explained where it is enforced:

- **nothing in `views/` is templated**, and no template engine is on the classpath — keep it that
  way. Both pages are read out of the jar and written byte for byte, and `config.js` is the only
  generated thing;
- **`spring.web.resources.add-mappings` is `false`.** `pom.xml` packages `public/` at
  `classpath:/public/`, which is one of the four locations Spring Boot serves by itself: left on,
  the framework would serve the client scripts a second way, outside the allowlist in `Routes` and
  with its own caching headers;
- **`BASE_PATH` is the servlet context path, set in `main()`** before the container is built, which
  is why the settings are loaded and validated there rather than in a bean — the port, the
  interface and the prefix all decide how the container is built. Tomcat's redirect from the bare
  prefix to the trailing-slash form comes from the same place, and the views' relative asset URLs
  need it. Nothing is validated at class initialisation, so `./mvnw verify` needs no credentials;
- the signature encoder is **hand-written**, never `URLEncoder.encode`, which is form encoding:
  `+` for a space, and `*` left alone. `Paynet.formEncode` *is* `URLEncoder`, because the request
  body really is form encoded — and the 3DS callback body is parsed by hand rather than through
  `@RequestParam`, which the servlet container fills from the query string too, so the four values
  verified would not be the four forwarded.

## Frontend constraints

Everywhere:

- No CDN, no webfonts, no images. Plain CSS in one file, shipped as written.
- Never do anything to `.hf-field` that could hide or fake a card input — no `transform`,
  `opacity`, `clip-path`, `filter`, positioned overlays. The SDK rejects it.
- **No inline `<script>` and no inline `style=` in a view.** Every page ships a
  Content-Security-Policy with no `'unsafe-inline'`, and a nonce cannot go in the markup because
  nothing in `views/` is templated. That is why the result page's script is
  `public/result.js`. The policy names the `SDK_URL` origin in `script-src` **and** in
  `frame-src` — the card fields are iframes from that host — and is built at runtime, so it is a
  header and not a violation of the no-templating rule. `nextjs/` is the exception again: Next
  emits its own inline scripts, so its middleware mints a nonce per request instead.

In every example but `nextjs/`:

- No dependencies and no bundler for the browser half.
- `public/` is ES5: `var`, `function`, no arrow functions, no template literals.

In `nextjs/` the bundler is the point of the example, but the dependencies are still only
Next, React and the two linters — nothing for the integration itself.

## Secrets

`.env`, `*.pem` and `*.key` are git-ignored repository wide. Never commit a key, a
`MERCHANT_CONTROL`, or a real `ENDPOINT_ID`/`MERCHANT_LOGIN`; `.env.example` carries placeholders
only.

## Checks before a commit

```bash
./scripts/sync-shared.sh && git diff --exit-code   # every copy matches shared/
cd go-js              && gofmt -l . && go vet ./... && go build ./...
cd nodejs-express-js  && npm ci && npm run build
cd php-js             && php -l *.php tests/*.php && php tests/run.php
cd python-flask-js    && python -m compileall -q -x '(\.venv|__pycache__)' . \
                      && python -m unittest discover -s tests -t .
cd ruby-sinatra-js    && ruby -c *.rb config.ru test/*.rb && ruby test/all.rb
cd java-springboot-js && ./mvnw -B -Perrorprone compile && ./mvnw -B verify
cd nextjs             && yarn install && yarn lint && yarn build
```

The first line is what CI runs — see `.github/workflows/ci.yml`.

## The end-to-end tests

`e2e-tests/` starts a fake gateway on one origin, points every app at it with environment
variables and drives a browser through the payment. It is **local only and not part of CI or of
the checks above** — it needs every toolchain, a browser and a `next build`.

```bash
cd e2e-tests && npm test        # or test:go / test:express / test:php / test:python /
                                #    test:ruby / test:java / test:nextjs
```

Four things about it are load-bearing:

- **It is a standalone npm project.** Playwright is never added to an app's `package.json`: the
  dependency lists in `nodejs-express-js/` and `nextjs/` are deliberately minimal, and that is
  part of what the examples demonstrate.
- **It changes nothing in an app.** Every setting reaches every server as a process
  environment variable, which wins over `.env` in all of them, so no `.env` is read for those
  values or written. If a change to an app looks necessary to make a test pass, the test has
  probably found something.
- **`API_URL` and `SDK_URL` must name the same origin**, because each app builds its
  Content-Security-Policy from `SDK_URL` and the card fields are iframes from that host.
- **`e2e-tests/src/sdk/` is not a `shared/` file.** It is a stand-in for the bundle the gateway
  serves, written in the same ES5 style as `public/`, and `scripts/sync-shared.sh` does not touch
  it.

Running it rebuilds `nextjs/.next`, because `basePath` is baked in at build time.

## Documentation

Link to `doc.payneteasy.com`, never to internal or staging hosts. The integration reference is
<https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>.
