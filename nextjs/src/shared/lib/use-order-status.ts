'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrderStatusData } from './status-format';

const FINAL_STATUSES = ['approved', 'declined', 'error', 'filtered'];
const POLL_INTERVAL = 4000;
// Roughly three minutes. A payment that has not resolved by then is not going to resolve while
// the payer watches, and a page that polls a wedged server until the tab closes helps nobody.
// The plain-JS port keeps the same ceiling — see shared/public/status.js.
const MAX_POLLS = 45;

export interface Order {
  basePath: string;
  orderId: string;
  clientOrderId: string;
  /** Already back from the issuer, do not bounce there again. */
  redirected?: boolean;
}

/**
 * Polls the order until it reaches a final status, and sends the payer to the issuer once if
 * the gateway asks for a 3DS challenge.
 *
 * The order does not outlive the page: after the 3DS redirect the return page gets it from the
 * server, which takes it from the signed callback.
 */
export function useOrderStatus(order: Order | null): OrderStatusData | null {
  const [status, setStatus] = useState<OrderStatusData | null>(null);
  const redirected = useRef(false);

  const { basePath, orderId, clientOrderId } = order ?? {};

  useEffect(() => {
    if (!basePath || !orderId || !clientOrderId) {
      return;
    }
    redirected.current = order?.redirected ?? false;

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const url = `${basePath}/status?orderId=${encodeURIComponent(orderId)}&clientOrderId=${encodeURIComponent(clientOrderId)}`;
      attempts += 1;
      try {
        const response = await fetch(url);
        const data = (await response.json()) as OrderStatusData;
        if (!active) {
          return;
        }

        // A 502 from our own route parses as JSON too, and it carries no status — which the
        // panel reads as 'processing'. Without this the page would poll a broken server for as
        // long as it stayed open.
        if (!data.status) {
          setStatus({
            status: 'error',
            'error-message':
              typeof data.error === 'string'
                ? data.error
                : 'The server did not return an order status.',
          });
          return;
        }

        setStatus(data);

        // 3DS: the gateway asks to send the payer to the issuer, once
        const redirectTo = data['redirect-to'];
        if (typeof redirectTo === 'string' && redirectTo !== '' && !redirected.current) {
          redirected.current = true;
          window.location.href = redirectTo;
          return;
        }

        if (FINAL_STATUSES.includes(String(data.status))) {
          return;
        }

        if (attempts >= MAX_POLLS) {
          setStatus({
            status: 'error',
            'error-message':
              'The bank did not answer in time. The payment may still complete — check your email or contact the merchant before paying again.',
          });
          return;
        }

        timer = setTimeout(poll, POLL_INTERVAL);
      } catch (error) {
        if (active) {
          setStatus({ status: 'error', 'error-message': (error as Error).message });
        }
      }
    };

    poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `order.redirected` is an initial value, not a trigger: re-reading it would bounce the
    // payer back to the issuer on a re-render.
  }, [basePath, orderId, clientOrderId, order?.redirected]);

  return status;
}
