import type { NextConfig } from 'next';

// Unlike the Go and Express examples, where BASE_PATH is read at startup, Next resolves
// basePath at build time and bakes it into the output. It is read from .env here, which
// `next build` loads too, so the build and the runtime agree — but changing it means
// rebuilding. See README.md.
const basePath = process.env.BASE_PATH ?? '/hosted-fields-examples-nextjs';

const nextConfig: NextConfig = {
  // One self-contained server.js plus .next/static and public/, so a release carries no
  // node_modules — the same shape as the Express example's esbuild bundle.
  output: 'standalone',
  basePath: basePath === '' ? undefined : basePath,
};

export default nextConfig;
