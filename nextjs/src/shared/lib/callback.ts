/** The parameters the gateway signs its callback with, in the order the page wants them back. */
export const SIGNED_CALLBACK_FIELDS = ['status', 'orderid', 'merchant_order', 'control'] as const;

/**
 * The checksum the gateway signs its callbacks with:
 * sha1(status + orderid + merchant_order + merchant_control).
 *
 * Takes the POSTed form or the query string the callback redirected to — the same values travel
 * on to the result page, and are checked again there with this very function.
 * https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
 *
 * Web Crypto rather than node:crypto, and the secret passed in rather than read from
 * serverConfig(), because middleware.ts calls this too and runs on the edge runtime, where
 * neither node:crypto nor the node:fs that serverConfig() reaches for exists. One function for
 * all three checks is the point: the callback, the middleware and the page must not be able to
 * disagree about what a valid signature is.
 */
export async function validCallback(
  form: URLSearchParams,
  merchantControl: string,
): Promise<boolean> {
  const signed =
    (form.get('status') ?? '') +
    (form.get('orderid') ?? '') +
    (form.get('merchant_order') ?? '') +
    merchantControl;

  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return constantTimeEqual(form.get('control') ?? '', expected);
}

/**
 * node:crypto's timingSafeEqual is not available on the edge runtime, so this is the same idea
 * written out: every character is compared, and the loop never stops early on a mismatch. The
 * length is compared first and does leak — but a checksum of the wrong length is already wrong,
 * and its length is not a secret.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) {
    differing |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differing === 0;
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
