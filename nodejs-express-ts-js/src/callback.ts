// The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.
// https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
//
// This lives apart from server.ts so it can be tested without starting a listener. Go keeps the
// same function in main.go, the JavaScript example in src/callback.js and Next.js in
// src/shared/lib/callback.ts; all four must agree.

import { createHash, timingSafeEqual } from 'node:crypto';
import { MERCHANT_CONTROL } from './config.ts';
import { type JsonObject, text } from './json.ts';

// The parameters the gateway signs its callback with, in the order the page wants them back
export const SIGNED_CALLBACK_FIELDS = ['status', 'orderid', 'merchant_order', 'control'] as const;

// Takes a form body or a query string: the same values travel on to /result, and are checked
// again there with this very function. Express types req.query as a bag of strings, arrays and
// nested objects, so the values are read through text() rather than trusted to be strings.
export function validCallback(source: JsonObject): boolean {
  const expected = createHash('sha1')
    .update(text(source, 'status') + text(source, 'orderid') + text(source, 'merchant_order') + MERCHANT_CONTROL)
    .digest('hex');
  const control = text(source, 'control');
  // timingSafeEqual throws on a length mismatch, so the length is compared first — and a wrong
  // length is already a wrong checksum.
  return control.length === expected.length && timingSafeEqual(Buffer.from(control), Buffer.from(expected));
}
