// Bundles the server into one file so the deployed artefact carries no node_modules.
// Templates and client assets stay as plain files next to it: nginx can serve public/
// directly, and the pages stay readable on the server.

import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const OUT_DIR = 'dist';

await rm(OUT_DIR, { recursive: true, force: true });

await build({
  entryPoints: ['src/server.js'],
  outfile: `${OUT_DIR}/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // express is CommonJS and reaches for require() at runtime; an ESM bundle has none
  banner: { js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
});

await Promise.all([cp('public', `${OUT_DIR}/public`, { recursive: true }), cp('views', `${OUT_DIR}/views`, { recursive: true })]);

console.log(`built ${OUT_DIR}/server.js + public/ + views/`);
