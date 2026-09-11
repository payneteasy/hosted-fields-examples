import { createHash, timingSafeEqual } from 'node:crypto';
import { serverConfig } from '@/shared/config';

/**
 * The checksum the gateway signs its callbacks with:
 * sha1(status + orderid + merchant_order + merchant_control).
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
 * The payer's address, which the platform uses for fraud screening. Behind nginx it only
 * arrives in X-Forwarded-For, so the proxy must set it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : '').trim();
  if (ip === '' || ip === '::1') {
    return '127.0.0.1';
  }
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
