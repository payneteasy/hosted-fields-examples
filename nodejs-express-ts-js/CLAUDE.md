# nodejs-express-ts-js

TypeScript server for the Hosted Fields example. Read the repository-level `CLAUDE.md` first —
the rules about the shared frontend and about English apply here too, and the section
`## TypeScript, in nodejs-express-ts-js/ only` is about this directory.

This is a port of `nodejs-express-js/`, kept close enough to read as a diff. A change to the
payment flow in either one belongs in both.

## Shape

npm, not yarn. **Node 22.18 or newer**, because `npm start` runs `src/server.ts` directly and
Node strips the types itself — there is no `tsx` and no `ts-node`. Express is the only runtime
dependency; TypeScript, Biome, esbuild and the two `@types` packages are the dev ones. Do not add
more without a reason the example itself demonstrates.

| File | Role |
| --- | --- |
| `src/config.ts` | environment variables, validated at startup and narrowed to non-optional types |
| `src/json.ts` | `unknown` → checked: gateway replies and request bodies. No counterpart in the JavaScript example |
| `src/oauth.ts` | OAuth 1.0a RSA-SHA256 signing |
| `src/callback.ts` | the 3DS return checksum |
| `src/paynet.ts` | the three gateway calls |
| `src/server.ts` | express routes under `BASE_PATH`, and the generated `config.js` |
| `build.mjs` | the esbuild bundle plus asset copy into `dist/`; `npm run build` runs `tsc` first |

`npm start` reads `.env` through Node's own `--env-file`, so there is no dotenv dependency. Run
`node src/server.ts` directly and the settings will be missing.

## Things that will bite

- **`tsc --noEmit` belongs inside `build`, not beside it.** `"build": "tsc --noEmit && node
  build.mjs"`, spelled out rather than left to npm's implicit `prebuild` hook. esbuild strips
  types without checking them, so moving the check into `lint` alone would make this example
  indistinguishable from the JavaScript one — which is the whole reason it exists.
- **Types must be erasable.** Node runs `.ts` by stripping, not compiling: no `enum`, no
  parameter properties, no `namespace`. `erasableSyntaxOnly` in `tsconfig.json` is what turns
  that from a runtime failure into a compile error.
- **Imports carry the `.ts` extension.** `./config.ts`, not `./config.js` — Node resolves the
  specifier literally, and esbuild is happy with it. `allowImportingTsExtensions` permits it.
- **`as` is not the way past a boundary.** `JSON.parse` and `req.body` are `any`; both go through
  `isJsonObject` / `text` in `src/json.ts`. An assertion there would type-check and be a lie in
  the two places — `POST /pay` and the 3DS callback — where being wrong costs the most.
- **Nothing in `views/` is templated.** Both pages go out through `res.sendFile`, and the only
  generated thing is `config.js` (`sendConfigJS` in `src/server.ts`).
- **`views/` and `public/` are copies of `shared/`,** and `public/` stays ES5. A `.ts` file must
  never appear there: `scripts/sync-shared.sh` overwrites that directory, and CI fails a copy
  that has drifted.
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
npm run lint
node --check public/*.js
npm test
npm run build
```
