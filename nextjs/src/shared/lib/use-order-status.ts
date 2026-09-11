'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrderStatusData } from './status-format';

const FINAL_STATUSES = ['approved', 'declined', 'error', 'filtered'];
const POLL_INTERVAL = 4000;

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
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const url = `${basePath}/status?orderId=${encodeURIComponent(orderId)}&clientOrderId=${encodeURIComponent(clientOrderId)}`;
      try {
        const response = await fetch(url);
        const data = (await response.json()) as OrderStatusData;
        if (!active) {
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
