# Hosted Fields examples

Nine merchant integrations of the same payment — `go-js/`, `nodejs-express-js/`, `php-js/`,
`python-flask-js/`, `ruby-sinatra-js/`, `java-springboot-js/`, `rust-axum-js/`,
`dotnet-aspnetcore-js/` and `nextjs/`.
They exist to be read, so clarity beats cleverness everywhere in this repository.

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

## Rust, in `rust-axum-js/` only

axum leaves the routing table honest but has one shape of its own, and the crate ecosystem has
defaults that would quietly bring back what the other examples avoid. Four rules, each explained
where it is enforced:

- **`Router::nest` maps the mounted router's `/` onto the *bare* prefix**, not onto `{prefix}/`.
  So the payment page is registered outside the nest, at the trailing-slash form — the one the
  views' relative asset URLs resolve against — and the bare prefix answers a `301` to it, the
  redirect Go's mux and Tomcat both send by themselves. Nesting the page instead leaves
  `{prefix}/` a 404 and every asset URL one segment too high;
- **nothing in `views/` is templated**, and both pages are compiled in with `include_dir!` — the
  analogue of `//go:embed`, so the artefact is one binary. `config.js` is the only generated
  thing, and `views/`, `public/` stay synced copies of `shared/`;
- the signature encoder is **hand-written RFC 3986**, never `form_urlencoded`, which is form
  encoding: `+` for a space, and `!'()*` left alone. The Sale body *is* form encoded — that is
  what `.form(params)` is for — and the 3DS callback is parsed off the **body**, never the query,
  so the four values verified are the four forwarded;
- settings are parsed and validated **in `main`, before the listener is opened**, never lazily out
  of a `static`, so the process refuses to start without credentials — and `cargo test` and
  `cargo build` need none.

Two dependency choices carry the same weight, and reverting either brings back what it was picked
to avoid: **reqwest with `default-features = false` and `rustls-no-provider`** — the defaults are
native-tls, which is OpenSSL, and the plain `rustls` feature picks aws-lc-rs, which wants cmake —
with an **explicit 10-second timeout**, because reqwest has no default one at all; and **`rsa` +
`sha2` + `sha1`**, pure Rust rather than bindings to OpenSSL. `X-Forwarded-For` is read by hand,
five lines, taking the **last** element: nginx appends the address it saw, so that is the one
element the caller could not choose.

## .NET, in `dotnet-aspnetcore-js/` only

ASP.NET Core brings a static file server, a parameter binder and a development mode that all want
what this page does not. Four rules, each explained where it is enforced:

- **The bare prefix is redirected in middleware, not by a route.** ASP.NET Core's endpoint matcher
  ignores a trailing slash, so `{prefix}` and `{prefix}/` reach the same endpoint and the views'
  relative asset URLs would resolve one segment too high. The middleware at the top of `Program.cs`
  runs before any endpoint and answers an exact `{prefix}` with a `301` — the redirect Go's mux and
  Tomcat both send by themselves. The page is registered at the bare prefix and served at the
  trailing-slash form;
- **nothing in `views/` is templated**, no template engine is referenced and none should be. Both
  pages are `<EmbeddedResource>`s written out byte for byte, so the artefact is one assembly, and
  `config.js` is the only generated thing. `public/` goes out through a four-name allowlist and
  `UseStaticFiles` is never called: left to itself the framework would serve the client scripts a
  second way, at the root rather than under `BASE_PATH` and with caching headers of its own, which
  is what `spring.web.resources.add-mappings` and Sinatra's `static` exist to turn off;
- **the environment is pinned to `Production`** in `WebApplicationOptions`, never taken from
  `ASPNETCORE_ENVIRONMENT`. The developer exception page is a stack trace behind a payment page,
  and its injected inline script would breach the Content-Security-Policy too — the same reason
  Flask's `debug` stays off. Settings are loaded and validated in `Main`, before the listener is
  opened, so `dotnet build` and `dotnet test` need no credentials;
- the signature encoder is **hand-written RFC 3986**, never a form encoder: `+` for a space, and
  `!'()*` left alone, are what a form encoder does and what the gateway rejects. The Sale body
  *is* form encoded — that is what `FormUrlEncodedContent` is for — and the 3DS callback is parsed
  off the **body** with `ReadFormAsync`, never off the query, so the four values verified are the
  four forwarded.

**No NuGet package is referenced by the app**, and reintroducing one is the thing to avoid:
Kestrel, `HttpClient`, RSA, SHA-1 and `System.Text.Json` all ship with the platform, which is what
keeps the Go example's property that the integration needs nothing but the standard library. xUnit
under `tests/` is the only exception and is not published. `X-Forwarded-For` is read by hand, five
lines, taking the **first** element, as every example but the axum one does.

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
cd rust-axum-js       && cargo fmt --check && cargo clippy --all-targets -- -D warnings \
                      && cargo test && cargo build --release
cd dotnet-aspnetcore-js && dotnet format HostedFields.csproj --verify-no-changes \
                      && dotnet format tests/HostedFields.Tests.csproj --verify-no-changes \
                      && dotnet build HostedFields.csproj -c Release \
                      && dotnet test tests/HostedFields.Tests.csproj
cd nextjs             && yarn install && yarn lint && yarn build
```

The first line is what CI runs — see `.github/workflows/ci.yml`.

## The end-to-end tests

`e2e-tests/` starts a fake gateway on one origin, points every app at it with environment
variables and drives a browser through the payment. It is **local only and not part of CI or of
the checks above** — it needs every toolchain, a browser and a `next build`.

```bash
cd e2e-tests && npm test        # or test:go / test:express / test:php / test:python /
                                #    test:ruby / test:java / test:rust / test:nextjs
cd e2e-tests && npm run test:dotnet   # .NET only, and never part of a bare `npm test`
```

Five things about it are load-bearing:

- **It is a standalone npm project.** Playwright is never added to an app's `package.json`: the
  dependency lists in `nodejs-express-js/` and `nextjs/` are deliberately minimal, and that is
  part of what the examples demonstrate.
- **It changes nothing in an app.** Every setting reaches every server as a process
  environment variable, which wins over `.env` in all of them, so no `.env` is read for those
  values or written. If a change to an app looks necessary to make a test pass, the test has
  probably found something.
- **`API_URL` and `SDK_URL` must name the same origin**, because each app builds its
  Content-Security-Policy from `SDK_URL` and the card fields are iframes from that host.
- **`dotnet-aspnetcore-js` is opt-in.** It carries `onRequestOnly: true` in `src/apps.ts`, so a
  bare `npm test` leaves it out and `npm run test:dotnet` is what runs it. A missing toolchain is a
  hard failure here rather than a skip, and the .NET SDK is the newest of the ones the suite wants.
- **`e2e-tests/src/sdk/` is not a `shared/` file.** It is a stand-in for the bundle the gateway
  serves, written in the same ES5 style as `public/`, and `scripts/sync-shared.sh` does not touch
  it.

Running it rebuilds `nextjs/.next`, because `basePath` is baked in at build time.

## All nine at once, in `docker-compose.yml`

`docker compose up --build` builds nine images and runs them behind one nginx on `:8080`. It
exists for two reasons, and the second is the one to protect:

- no toolchain to install, which is what `e2e-tests/` still needs nine of;
- **it is the only thing that ever executes the nine `deploy/nginx.conf`.** Those files ship in
  the release archives and the READMEs tell people to install them, and until this they were
  documentation with nothing to check them.

That second reason is what fixes the shape of the file. Every app service joins the nginx
container's network namespace (`network_mode: "service:nginx"`), so the snippets' own
`proxy_pass http://127.0.0.1:300x` is true inside it and they are mounted **unmodified**. Service
names and `LISTEN_ADDR=0.0.0.0` would have been the ordinary answer and would have meant nine
second copies, drifting silently — the one thing `shared/` exists to prevent. Keep the mounts
read-only and keep them pointing at `*/deploy/nginx.conf`.

Three consequences worth knowing before editing it: a service in a shared namespace may not
declare `ports`, `networks` or `hostname`; **`docker compose restart` does not work** — the nine
hold a handle on the namespace nginx owns, so restarting leaves some of them without a network and
`up -d --force-recreate` is the way; and the root `.env` must carry **no `PORT`, `LISTEN_ADDR` or
`BASE_PATH`** — all nine read that one file, and every example already defaults to its own port
and prefix.

`php-js` is the only app whose shipped deploy config cannot be mounted as it is: its pool sets
`clear_env = yes` and names every setting as an `env[]` line, which is right for a system FPM and
blind to compose's environment. Its `Dockerfile` writes a compose pool instead, and says in a
comment exactly which two lines differ and why. `nextjs` is the only one needing a build argument,
because `next build` bakes `basePath` in.

**This is what a ninth language now costs**, on top of the one line in `scripts/sync-shared.sh`:
a `Dockerfile`, a `.dockerignore`, a service in `docker-compose.yml` and a mount line for its
snippet. Images are not built in CI.

## Documentation

Link to `doc.payneteasy.com`, never to internal or staging hosts. The integration reference is
<https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html>.
