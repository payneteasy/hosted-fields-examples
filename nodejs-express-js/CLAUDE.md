# nodejs-express-js

Node.js server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first — the
rules about the shared frontend and about English apply here too.

## Shape

npm, not yarn. Node 20 or newer. Express is the only runtime dependency and esbuild the only dev
one; do not add more without a reason the example itself demonstrates.

| File | Role |
| --- | --- |
| `src/config.js` | environment variables, validated at startup |
| `src/oauth.js` | OAuth 1.0a RSA-SHA256 signing |
| `src/paynet.js` | the three gateway calls |
| `src/server.js` | express routes, mounted on a router under `BASE_PATH` |
| `build.mjs` | esbuild bundle plus asset copy into `dist/` |

`npm start` reads `.env` through Node's own `--env-file`, so there is no dotenv dependency. Run
`node src/server.js` directly and the settings will be missing.

## Things that will bite

- **The config injection is matched on the whole line.** Both views carry a comment naming the
  other app's placeholder, so a plain `replace('__CONFIG__', ...)` substitutes the comment
  instead of the script tag. `renderPage` anchors on the line and throws if it is absent. Go
  never hits this because `html/template` strips HTML comments from the output.
- **The 3DS return is a POST.** `router.all('/result')` handles both methods and verifies the
  `control` checksum; a GET-only route answers the gateway with 405.
- **`proxy_pass` carries no trailing slash and no path**, so the prefix reaches the app, which
  routes on `BASE_PATH` rather than having nginx strip it.
- **`X-Forwarded-For` must be set by the proxy.** The payer's address goes to the gateway for
  fraud screening; without the header every payer looks like the proxy.

## Checks

```bash
npm ci
node --check src/*.js public/*.js
npm run build
```
