// A readiness probe with a useful error message.
//
// go-js and nodejs-express-js refuse to start at all on a bad configuration, but nextjs starts
// happily and only fails on the first request, because its settings are validated lazily so
// that `next build` can run without credentials. Without this check that difference shows up as
// an inscrutable test failure instead of "the app is misconfigured".

import { APPS, appUrl } from '../src/apps.ts';
import { EMULATOR_ORIGIN } from '../src/settings.ts';

export default async function globalSetup(): Promise<void> {
  const response = await fetch(`${EMULATOR_ORIGIN}/__control/health`);
  if (!response.ok) {
    throw new Error(`the emulator is not healthy: ${response.status}`);
  }

  for (const app of APPS) {
    const url = appUrl(app, '/');
    let page: Response;
    try {
      page = await fetch(url);
    } catch {
      // Only the apps this run actually starts are up; the rest are legitimately absent.
      continue;
    }
    if (!page.ok) {
      throw new Error(
        `${app.name} answered ${page.status} for ${url}. ` +
          'The app started but cannot serve the payment page — check its settings.',
      );
    }
  }
}
