// Bundles the server into one file so the deployed artefact carries no node_modules.
// Templates and client assets stay as plain files next to it: nginx can serve public/
// directly, and the pages stay readable on the server.
//
// esbuild strips the types without checking them, which is why `npm run build` is
// `tsc --noEmit && node build.mjs` and not this script alone. Spelled out rather than left to
// npm's implicit prebuild hook, because the point of the example is that the check is visible
// and not a lifecycle detail a different package manager might skip.

import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const OUT_DIR = 'dist';

await rm(OUT_DIR, { recursive: true, force: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: `${OUT_DIR}/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // express is CommonJS and reaches for require() at runtime; an ESM bundle has none
  banner: { js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
});

await Promise.all([cp('public', `${OUT_DIR}/public`, { recursive: true }), cp('views', `${OUT_DIR}/views`, { recursive: true })]);

console.log(`built ${OUT_DIR}/server.js + public/ + views/`);
