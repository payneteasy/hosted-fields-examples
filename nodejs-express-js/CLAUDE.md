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
| `src/server.js` | express routes under `BASE_PATH`, and the generated `config.js` |
| `build.mjs` | esbuild bundle plus asset copy into `dist/` |

`npm start` reads `.env` through Node's own `--env-file`, so there is no dotenv dependency. Run
`node src/server.js` directly and the settings will be missing.

## Things that will bite

- **Nothing in `views/` is templated.** Both pages go out through `res.sendFile`, and the only
  generated thing is `config.js` (`sendConfigJS` in `src/server.js`). Reintroducing a template
  would break the promise that the same HTML serves from every example.
- **`views/` and `public/` are copies of `shared/`.** Edit `shared/`, run
  `scripts/sync-shared.sh`. CI fails a copy that has drifted.
- **The 3DS return is a POST, and it lands on `/result/callback`, not on the page.** The
  callback verifies the `control` checksum and redirects with the same signed parameters;
  `/result` verifies them again before serving anything.
- **`deploy/nginx.conf` names the static files one by one.** A blanket `\.js$` rule there would
  serve `config.js` and `result-config.js` off the disk, where they do not exist, and every
  payment would break.
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
