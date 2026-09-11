// A readiness probe with a useful error message.
//
// go-js and nodejs-express-js refuse to start at all on a bad configuration, but nextjs starts
// happily and only fails on the first request, because its settings are validated lazily so
// that `next build` can run without credentials. Without this check that difference shows up as
// an inscrutable test failure instead of "the app is misconfigured".
//
// It is also where the docker mode waits. Playwright's webServer waits on nginx, which answers
// long before the containers behind it do; and an app that is not up answers 502 there rather
// than refusing the connection, so absence and "not yet" look the same and both have to be
// waited out.

import { appUrl, startedApps } from '../src/apps.ts';
import { EMULATOR_ORIGIN, TARGET } from '../src/settings.ts';

/** Long enough for nine containers to come up, and a `next build` is not among them here. */
const DOCKER_READY_TIMEOUT = 180_000;
const POLL_INTERVAL = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `url` until it answers 200, or gives up with `what` in the message. Natively there is
 * nothing to wait for — every server was up before Playwright ran this — so the budget is one
 * attempt and a failure is reported as it happens.
 */
async function waitForOk(url: string, what: string): Promise<void> {
  const deadline = Date.now() + (TARGET === 'docker' ? DOCKER_READY_TIMEOUT : 0);
  let last = '';
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      last = `answered ${response.status}`;
    } catch (error) {
      last = `is not listening (${error instanceof Error ? error.message : String(error)})`;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${what} ${last} for ${url}.`);
    }
    await sleep(POLL_INTERVAL);
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForOk(`${EMULATOR_ORIGIN}/__control/health`, 'the emulator');

  for (const app of startedApps()) {
    const url = appUrl(app, '/');
    try {
      await waitForOk(url, app.name);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
          'The app cannot serve the payment page — check its settings.',
      );
    }
  }
}
