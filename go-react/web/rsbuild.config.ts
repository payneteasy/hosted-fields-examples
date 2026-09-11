import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

/* The prefix the Go server mounts everything under, and where it listens. Only the dev server
   below needs either: what is built into dist/ knows neither, which is the point. The pages
   address the server through window.CONFIG.basePath and reach their own assets with relative
   URLs, so one build serves under any BASE_PATH — the one thing nextjs/ cannot do, because
   `next build` bakes its basePath in. */
const BASE_PATH = process.env.BASE_PATH ?? '/hosted-fields-examples-go-react';
const SERVER = `http://127.0.0.1:${process.env.PORT ?? '3010'}`;

/** The routes the Go server answers. Everything else on the page is a static file. */
const SERVER_ROUTES = ['/config.js', '/result-config.js', '/pay', '/status', '/result/callback'];

export default defineConfig({
  plugins: [pluginReact()],

  /* Two entries, one per page, because the server has two routes to serve and neither is
     rendered by the other: GET {prefix}/ is dist/index.html and GET {prefix}/result is
     dist/result.html. There is no client-side router here — a payment is two screens with a
     trip to the payer's bank in between, and the second one is reached by an HTTP redirect
     the gateway performs. */
  source: {
    entry: {
      index: './src/app/checkout.tsx',
      result: './src/app/result.tsx',
    },
  },

  /* The templates are the whole of the markup this example does not write in React: a head, a
     stylesheet link, config.js and an empty #root. They carry no inline script and no inline
     style, because the Go server sends a Content-Security-Policy with no 'unsafe-inline' and
     nothing here is templated, so there is nowhere to put a nonce. */
  html: {
    template: ({ entryName }) =>
      entryName === 'result' ? './src/app/result.html' : './src/app/checkout.html',
  },

  output: {
    // Relative, so the injected <script> resolves against the page's own URL — correct from
    // both {prefix}/ and {prefix}/result — and BASE_PATH stays a setting of the server process.
    assetPrefix: './',
    // Everything under static/, which is what lets the Go server's allowlist be two names.
    distPath: { root: 'dist', js: 'static/js', css: 'static/css' },
    // Both default to false. Stated because a single inline <script> or style="" would be a
    // Content-Security-Policy violation on a page nobody can put a nonce into.
    inlineScripts: false,
    inlineStyles: false,
    // dist/ is emptied before every build, and dist/.gitkeep is the one file in it that is
    // committed: the //go:embed in ../main.go needs the directory to exist in a fresh clone,
    // before anyone has run this build.
    cleanDistPath: { keep: [/\.gitkeep$/] },
  },

  /* Only for `yarn dev`, which serves the pages itself and forwards the five server routes to
     a `go run .` on the side — so the seam is a proxy hop while iterating, the way it is an
     HTTP request in production. The dev server's own HMR scripts are inline, but they are the
     dev server's page: nothing built here ever carries one. */
  dev: {
    assetPrefix: BASE_PATH,
  },
  server: {
    base: BASE_PATH,
    proxy: Object.fromEntries(SERVER_ROUTES.map((route) => [BASE_PATH + route, SERVER])),
  },
});
