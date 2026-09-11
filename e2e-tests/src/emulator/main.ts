// Runs the emulator on its own. Playwright starts it this way, and so can you: `npm run
// emulator`, then point an app at it by hand to click through the flow.

import { ensureKeypair } from '../keys.ts';
import { EMULATOR_PORT, HOST } from '../settings.ts';
import { createEmulator } from './server.ts';

ensureKeypair();

createEmulator().listen(EMULATOR_PORT, HOST, () => {
  console.log('[emulator] listening on http://%s:%d', HOST, EMULATOR_PORT);
});
