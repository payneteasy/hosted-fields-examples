/**
 * The order the payer comes back from the 3DS challenge with.
 *
 * The gateway returns them with a signed POST, and an App Router page cannot serve POST — so
 * the callback route verifies the signature, puts the order in this cookie and redirects to
 * the page, which reads it. The identifiers still come from the gateway's own callback and
 * never from the browser's URL, which is the property worth keeping.
 */
export const RETURN_COOKIE = 'hf-3ds-return';

/** Short: it exists only to survive one redirect. A server component cannot clear a cookie,
 *  so this and the path are what stop a stale one from resurfacing on a later visit. */
export const RETURN_COOKIE_MAX_AGE = 600;

export interface ReturnOrder {
  orderId: string;
  clientOrderId: string;
}

export function encodeReturnOrder(order: ReturnOrder): string {
  return new URLSearchParams(order as unknown as Record<string, string>).toString();
}

export function decodeReturnOrder(value: string | undefined): ReturnOrder | null {
  if (!value) {
    return null;
  }
  const params = new URLSearchParams(value);
  const orderId = params.get('orderId') ?? '';
  if (orderId === '') {
    return null;
  }
  return { orderId, clientOrderId: params.get('clientOrderId') ?? '' };
}
