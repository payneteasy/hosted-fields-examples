# e2e-tests

End-to-end tests for every example, run **locally only**. They are not part of CI: the suite
needs a browser, a Next.js production build and either nine toolchains or Docker, which is more
than `.github/workflows/ci.yml` is set up for.

The examples are supposed to be the same payment written once per language. This is what checks
that they are.

## What it fakes

One emulator process on `http://127.0.0.1:4010` plays both halves of the gateway:

| | |
| --- | --- |
| `POST /api/v4/tokenize/create-ephemeral-ticket/:id` | the single-use ticket the page is rendered with |
| `POST /api/v4/sale/:id` | the Sale |
| `POST /api/v4/status/:id` | the order status the page polls |
| `GET /sdk.js` | a stand-in for the Hosted Fields bundle |
| `GET /hf/:type` | one card field, as a real cross-origin iframe |
| `GET /acs` | the issuer's 3DS challenge page |
| `POST /__control/*` | scenario selection, which no application knows about |

In the docker mode it is a container of its own — plain `node:22`, no image to build, because it
imports nothing but Node builtins — on the same published port, `4010`. It has to be *the same
port inside the stack and out*: the emulator does not read the request's `Host`, it rebuilds the
signed URL from its own `EMULATOR_ORIGIN`, so a signature verifies only if the application signed
that very string. The same goes for nginx's `4020` and `PUBLIC_URL`.

It also stays on its own port rather than behind that nginx, in both modes, because the card
fields are iframes from `SDK_URL` and the cross-origin boundary is part of what is being tested.

Both `API_URL` and `SDK_URL` point at that one origin, and they have to: every example builds its
Content-Security-Policy from `SDK_URL`, naming that host in `script-src`, `frame-src` and
`connect-src` and denying everything else. Serving the API and the SDK from one port is what
makes the real policy apply instead of being worked around.

Two things are verified rather than waved through, so that a green run means something:

- **the OAuth 1.0a RSA-SHA256 signature on every server call**, checked against the generated
  public key. This is the only place the bytes actually on the wire are checked — the unit tests
  in `go-js`, `nodejs-express-js`, `php-js`, `python-flask-js`, `ruby-sinatra-js`,
  `java-springboot-js`, `rust-axum-js` and `dotnet-aspnetcore-js` each check their own signer
  against a fixed base string, and `nextjs` has no unit test at all;
- **the `control` checksum on the 3DS return**, because the emulator signs what every example
  verifies. A disagreement shows up as a `403`.

## Running it

There are two ways, and they run the same specs against the same emulator. What differs is where
the applications come from.

### Natively — `npm test`

Playwright starts each application itself, one per port, so a run needs that application's
toolchain installed.

```bash
npm install
npm run browser          # once: downloads Chromium
npm test                 # every application except .NET, which is asked for by name
npm run test:go          # or test:express / test:php / test:python / test:ruby /
                         #    test:java / test:rust / test:dotnet / test:nextjs
npm run test:ui          # the Playwright UI, for watching a flow
```

`npm test` covers **eight** of the nine: `dotnet-aspnetcore-js` carries `onRequestOnly: true` and
is run by name, because a missing toolchain here is a hard failure rather than a skip.

### Against the containers — `npm run test:docker`

`docker-compose.yml` at the repository root already builds and runs all nine behind one nginx.
This mode points the suite at that stack instead, so the only thing that has to be installed is
Docker — no Go, no JDK, no cargo, no .NET SDK.

```bash
npm run test:docker         # all nine, .NET included
npm run test:docker:java    # or :go / :express / :php / :python / :ruby / :rust / :dotnet /
                            #    :nextjs — builds and starts that one container, not nine
npm run test:docker:ui      # the Playwright UI against the stack
npm run report              # either mode
```

The first run builds the images and takes a while; after that it is a few seconds of container
start. Every project runs by default here, .NET included: `onRequestOnly` exists for a toolchain
that might be missing, and Docker supplies all of them.

The stack comes up and goes down with the run — `docker compose … up --build` is Playwright's
`webServer`, and a `globalTeardown` runs `down` whatever happened. It carries its own project
name, `hosted-fields-examples-e2e`, so a demo stack you already have up on `:8080` is left alone.

### Either way

Each application is a Playwright **project**, and the specs are written once and run against
every one of them — which is the point. Not one spec knows which mode it is in: they address an
app through `appOrigin()` and `appUrl()`, which return its own port natively and the shared nginx
origin plus its `BASE_PATH` behind compose.

## What it covers

| Spec | |
| --- | --- |
| `checkout.spec.ts` | pay and reach `approved`; the SDK's field-state classes; validation before tokenizing |
| `threeds.spec.ts` | the 3DS hop out to the issuer and back through the signed callback |
| `result-signature.spec.ts` | a hand-edited `/result` query gets a `403`, an empty one gets a page |
| `failures.spec.ts` | no ephemeral ticket, a refused Sale, a declined payment |

Scenarios are chosen with `useScenario()` before the page loads, and the choice is then bound
into the ephemeral ticket the page is rendered with, so a flow already in progress keeps its own
behaviour.

## Things worth knowing

Everything here about starting an application — where its toolchain is found, what it is built
into, which `startTimeout` it needs — is the native mode. The docker mode reads none of it: it
starts containers, and `apps.ts` uses only each entry's `name`, `service` and `basePath`.

- **Nothing here touches your `.env` files.** Every setting goes to the apps as a process
  environment variable, which wins over `.env` in all of them, and the Go binary is run from
  `.tmp/` where there is no `.env` at all. The PHP and Flask examples have to run from their own
  directories, so `apps.ts` pins their `BASE_PATH` too — the one setting `gatewayEnv()` does not
  pass. The docker mode is the same promise by a different route: `environment:` in
  `docker-compose.e2e.yml`, and the root `.env` dropped outright.
- **`npm test` rebuilds `nextjs/.next`**, because `basePath` is baked in at build time. Do not
  run the suite while `next dev` is live on the same directory. The docker mode builds inside the
  image instead and leaves `nextjs/.next` alone.
- **The Go example is compiled to `.tmp/` and exec'd**, not run with `go run .`: `go run` leaves
  the compiled binary behind as a grandchild that keeps holding the port. Set `GO_BIN` if your Go
  is not at `~/opt/go/bin/go` or on `PATH`.
- **The PHP example is served by `php -S`**, which takes the port on the command line and
  handles one request at a time. The flow is sequential, so that is not a problem here; a test
  that seems to hang on `php-js` is worth reading as a request waiting behind another one.
- **The Flask example gets its virtualenv in `.tmp/`**, built and installed into by its own
  `command` before the server starts, so nothing lands in `python-flask-js/`. The first run pays
  for a `pip install cryptography`, which is why that entry sets a longer `startTimeout`; after
  that both steps are near-instant.
- **The Sinatra example keeps its gems in `.tmp/` too**, through a `BUNDLE_PATH` environment
  variable rather than `bundle config set path`, which would write a `.bundle/config` into the
  app. It also needs a **Ruby 3.1 or newer**: macOS's `/usr/bin/ruby` is 2.6 and bundler refuses
  the `Gemfile`, so `apps.ts` locates one the way it locates Go and puts it first on `PATH`. Set
  `RUBY_BIN` if yours is not at `~/opt/ruby/bin/ruby` or on `PATH`.
- **The Spring Boot example is packaged and then run from its jar.** `./mvnw` is the Maven
  wrapper, so no Maven has to be installed — it downloads one on the first run, along with Spring
  Boot, which is what the long `startTimeout` on that entry is for. The jar lands in the app's own
  git-ignored `target/`, and `apps.ts` puts the JDK it found first on `PATH` so `mvnw` and
  `java` agree on one. Set `JAVA_HOME` if yours is neither there nor under `~/.sdkman`.
- **The Rust example is built into `.tmp/` and run from there**, exactly like the Go one:
  `--target-dir` keeps cargo's `target/` out of the app directory, and a binary started from
  `.tmp/` finds no `.env` to read. A cold build compiles axum, tokio and rustls from source, which
  is what the long `startTimeout` on that entry is for. `apps.ts` locates cargo the way it locates
  Go — rustup puts it in `~/.cargo/bin`, which is on `PATH` only for a shell that sourced
  `~/.cargo/env`. Set `CARGO_BIN` if yours is somewhere else.
- **The .NET example runs only when it is asked for**, with `npm run test:dotnet`, and a bare
  `npm test` leaves it out — it carries `onRequestOnly: true` in `apps.ts`. A missing toolchain is
  a hard failure here rather than a skip, and the .NET SDK is the newest of the ones this suite
  wants, so including it in the default run would take the whole suite down on a machine that has
  every other toolchain. Everything else about the entry is ordinary: it is **published into
  `.tmp/` and run from there**, for the same two reasons the Go and Rust ones are — no `bin/` or
  `obj/` of this suite's making is left in the app directory, and an assembly started from `.tmp/`
  finds no `.env` to read. `apps.ts` locates the SDK the way it locates cargo — the macOS installer
  puts it in `/usr/local/share/dotnet`, which is usually symlinked onto `PATH` but need not be.
  Set `DOTNET_BIN` or `DOTNET_ROOT` if yours is somewhere else.
- **The RSA key is generated, never committed** — into `.tmp/`, once, and reused. The docker mode
  mounts that same pair into all nine containers, in place of the demo stack's
  `private_key.pem`, and gives them the fake credentials through `environment:`. A root `.env`
  with real ones cannot reach a test run: `docker-compose.e2e.yml` drops it.
- **Ports 4010-4019** are used so your own servers on 3000-3008 can keep running, and **4020** is
  nginx in the docker mode. If a run ends strangely,
  `lsof -ti tcp:4010,4011,4012,4013,4014,4015,4016,4017,4018,4019,4020 | xargs kill` — or, for the
  docker mode, `docker compose -p hosted-fields-examples-e2e down`.
- `E2E_VERIFY_OAUTH=0` turns off signature verification, which is worth doing only to find out
  whether a failure is the application's or this harness's.

`src/sdk/` is browser code served verbatim to the payment pages, written in the same ES5 style as
every other `public/` file here. It is not a `shared/` file: `scripts/sync-shared.sh` neither
knows nor cares about it.
