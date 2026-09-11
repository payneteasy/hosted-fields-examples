# e2e-tests

End-to-end tests for every example, run **locally only**. They are not part of CI: the suite
needs every toolchain, a browser and a Next.js production build, which is more than
`.github/workflows/ci.yml` is set up for.

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

Both `API_URL` and `SDK_URL` point at that one origin, and they have to: every example builds its
Content-Security-Policy from `SDK_URL`, naming that host in `script-src`, `frame-src` and
`connect-src` and denying everything else. Serving the API and the SDK from one port is what
makes the real policy apply instead of being worked around.

Two things are verified rather than waved through, so that a green run means something:

- **the OAuth 1.0a RSA-SHA256 signature on every server call**, checked against the generated
  public key. This is the only place the bytes actually on the wire are checked — the unit tests
  in `go-js`, `nodejs-express-js`, `php-js`, `python-flask-js` and `ruby-sinatra-js` each check
  their own signer against a fixed base string, and `nextjs` has no unit test at all;
- **the `control` checksum on the 3DS return**, because the emulator signs what every example
  verifies. A disagreement shows up as a `403`.

## Running it

```bash
npm install
npm run browser          # once: downloads Chromium
npm test                 # every application
npm run test:go          # or test:express / test:php / test:python / test:ruby / test:nextjs
npm run test:ui          # the Playwright UI, for watching a flow
```

Each application is a Playwright **project**, and the specs are written once and run against
every one of them — which is the point.

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

- **Nothing here touches your `.env` files.** Every setting goes to the apps as a process
  environment variable, which wins over `.env` in all of them, and the Go binary is run from
  `.tmp/` where there is no `.env` at all. The PHP and Flask examples have to run from their own
  directories, so `apps.ts` pins their `BASE_PATH` too — the one setting `gatewayEnv()` does not
  pass.
- **`npm test` rebuilds `nextjs/.next`**, because `basePath` is baked in at build time. Do not
  run the suite while `next dev` is live on the same directory.
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
- **The RSA key is generated, never committed** — into `.tmp/`, once, and reused.
- **Ports 4010-4016** are used so your own servers on 3000-3005 can keep running. If a run ends
  strangely, `lsof -ti tcp:4010,4011,4012,4013,4014,4015,4016 | xargs kill`.
- `E2E_VERIFY_OAUTH=0` turns off signature verification, which is worth doing only to find out
  whether a failure is the application's or this harness's.

`src/sdk/` is browser code served verbatim to the payment pages, written in the same ES5 style as
every other `public/` file here. It is not a `shared/` file: `scripts/sync-shared.sh` neither
knows nor cares about it.
