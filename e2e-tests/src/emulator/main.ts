// Runs the emulator on its own. Playwright starts it this way, and so can you: `npm run
// emulator`, then point an app at it by hand to click through the flow.

import { ensureKeypair } from '../keys.ts';
import { EMULATOR_BIND, EMULATOR_ORIGIN, EMULATOR_PORT } from '../settings.ts';
import { createEmulator } from './server.ts';

ensureKeypair();

// Bound where the socket can be reached, logged as the one origin everything signs: in a
// container those are not the same address. See EMULATOR_BIND.
createEmulator().listen(EMULATOR_PORT, EMULATOR_BIND, () => {
  console.log('[emulator] listening on %s', EMULATOR_ORIGIN);
});
