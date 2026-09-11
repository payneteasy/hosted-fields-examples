// The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.
// https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
//
// This lives apart from server.js so it can be tested without starting a listener. Go keeps the
// same function in main.go and Next.js in src/shared/lib/callback.ts; all three must agree.

import { createHash, timingSafeEqual } from 'node:crypto';
import { MERCHANT_CONTROL } from './config.js';

// The parameters the gateway signs its callback with, in the order the page wants them back
export const SIGNED_CALLBACK_FIELDS = ['status', 'orderid', 'merchant_order', 'control'];

// Takes a form body or a query string: the same values travel on to /result, and are checked
// again there with this very function.
export function validCallback(source) {
  const field = (name) => String(source[name] ?? '');
  const expected = createHash('sha1')
    .update(field('status') + field('orderid') + field('merchant_order') + MERCHANT_CONTROL)
    .digest('hex');
  const control = field('control');
  // timingSafeEqual throws on a length mismatch, so the length is compared first — and a wrong
  // length is already a wrong checksum.
  return control.length === expected.length && timingSafeEqual(Buffer.from(control), Buffer.from(expected));
}
