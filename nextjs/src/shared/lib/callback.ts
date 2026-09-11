import { createHash, timingSafeEqual } from 'node:crypto';
import { serverConfig } from '@/shared/config';

/** The parameters the gateway signs its callback with, in the order the page wants them back. */
export const SIGNED_CALLBACK_FIELDS = ['status', 'orderid', 'merchant_order', 'control'] as const;

/**
 * The checksum the gateway signs its callbacks with:
 * sha1(status + orderid + merchant_order + merchant_control).
 *
 * Takes the POSTed form or the query string the callback redirected to — the same values
 * travel on to the result page, and are checked again there.
 * https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
 */
export function validCallback(form: URLSearchParams): boolean {
  const expected = createHash('sha1')
    .update(
      (form.get('status') ?? '') +
        (form.get('orderid') ?? '') +
        (form.get('merchant_order') ?? '') +
        serverConfig().merchantControl,
    )
    .digest('hex');

  const control = form.get('control') ?? '';
  return (
    control.length === expected.length &&
    timingSafeEqual(Buffer.from(control), Buffer.from(expected))
  );
}

/**
 * The payer's address, which the platform uses for fraud screening. Behind nginx it only arrives
 * in X-Forwarded-For, so the proxy must set it — and the header is taken on trust, which is one
 * of the reasons the app binds to loopback by default. Exposed straight to the internet it would
 * let any caller pick the address the gateway screens.
 *
 * The Web Request API gives a route handler no socket peer, so an absent header leaves nothing
 * better than the loopback address to send.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : '').trim();
  if (ip === '' || ip === '::1') {
    return '127.0.0.1';
  }
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
