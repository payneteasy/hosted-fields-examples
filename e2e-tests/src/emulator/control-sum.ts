// The checksum the gateway signs its 3DS callback with.
//
// The same arithmetic as validCallback() in go-js/main.go, nodejs-express-js/src/callback.js and
// nextjs/src/shared/lib/callback.ts. The emulator is the other half of that handshake: it signs
// what those three verify, so a disagreement shows up as a 403 in the suite.

import { createHash } from 'node:crypto';
import { MERCHANT_CONTROL } from '../settings.ts';

export function controlSum(status: string, orderId: string, merchantOrder: string): string {
  return createHash('sha1')
    .update(status + orderId + merchantOrder + MERCHANT_CONTROL)
    .digest('hex');
}
