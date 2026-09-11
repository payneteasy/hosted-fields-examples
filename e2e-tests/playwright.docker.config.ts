// The docker mode: the same specs, the same emulator, against docker-compose.yml.
//
// playwright.config.ts starts each app itself, which needs a toolchain for each of the nine.
// This one starts the containers instead, so the only thing that has to be installed is Docker.
// `npm run test:docker`, or `npm run test:docker:<app>` for one of them.
//
// Two differences from the native config, and both follow from that:
//
//  - all nine projects run by default. `onRequestOnly` on dotnet-aspnetcore-js exists because a
//    toolchain might be missing, and here none is;
//  - the apps do not each have a port. All nine are behind one nginx and are told apart by their
//    BASE_PATH — which the specs never notice, because they go through appOrigin() and appUrl().

import { defineConfig, devices } from '@playwright/test';
import { APPS, appOrigin, startedApps } from './src/apps.ts';
import { COMPOSE_COMMAND, composeUp } from './src/compose.ts';
import { ensureKeypair } from './src/keys.ts';
import { NGINX_ORIGIN, TARGET } from './src/settings.ts';

/* E2E_TARGET is what appOrigin() reads, and it is read at import time — a config cannot set it
   for itself. The npm scripts set it; this says so plainly rather than running every spec
   against nine ports that are not listening. */
if (TARGET !== 'docker') {
  throw new Error(
    `${COMPOSE_COMMAND} is the docker mode and needs E2E_TARGET=docker in the environment. ` +
      'Run it as `npm run test:docker`.',
  );
}

/* The key is mounted into all nine containers, so it has to exist before the stack comes up —
   and this module is evaluated before Playwright starts anything. */
ensureKeypair();

/* A run that asks for one app should start one container, not build nine. Playwright has no
   per-project webServer, but startedApps() reads the command line it does hand us. */
const appsToStart = startedApps();

export default defineConfig({
  testDir: './e2e',
  // The emulator holds the pending scenario and the order book in memory, and every app
  // shares it. Serial is what makes that unambiguous.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { trace: 'on-first-retry' },

  // Every app, .NET included: onRequestOnly is about a missing toolchain, and Docker has them all.
  projects: APPS.map((app) => ({
    name: app.name,
    use: { ...devices['Desktop Chrome'], baseURL: appOrigin(app) },
  })),

  webServer: {
    command: composeUp(appsToStart),
    cwd: '..',
    // nginx answers this as soon as it is up, which is well before the apps are. The apps, and
    // the emulator, are waited for in globalSetup — with a message naming the one that never came.
    url: `${NGINX_ORIGIN}/`,
    // Never: a stack already up was started by hand or left behind, and either way its images and
    // its settings are not knowably this run's.
    reuseExistingServer: false,
    // A cold run builds nine images from scratch
    timeout: 1_800_000,
    // `docker compose up` stops the stack on SIGTERM; globalTeardown is the belt to this braces.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 120_000 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
