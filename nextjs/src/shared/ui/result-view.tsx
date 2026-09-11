'use client';

import { useOrderStatus } from '@/shared/lib';
import { StatusPanel } from './status-panel';

/**
 * The 3DS return page. The payer arrives mid-payment, so the panel opens in its processing
 * state and the polling replaces it with the final verdict.
 *
 * The order comes from the callback the gateway signed, handed down by the server component,
 * so nothing has to be trusted to the browser and nothing is kept in sessionStorage.
 */
export function ResultView({
  basePath,
  orderId,
  clientOrderId,
}: {
  basePath: string;
  orderId: string;
  clientOrderId: string;
}) {
  const status = useOrderStatus(
    // Already back from the issuer, do not bounce there again
    orderId ? { basePath, orderId, clientOrderId, redirected: true } : null,
  );

  if (!orderId) {
    return (
      <StatusPanel
        data={{
          status: 'error',
          'error-message': 'Nothing to show: open this page from a payment.',
        }}
        basePath={basePath}
      />
    );
  }

  if (status) {
    return <StatusPanel data={status} basePath={basePath} />;
  }

  // Until the first poll answers. Its own copy: the payer has just come back from the bank.
  return (
    <div id="orderStatus" className="status status--processing" aria-live="polite" aria-busy="true">
      <div className="status__head">
        <span className="status__badge">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle
              cx="10"
              cy="10"
              r="7.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeDasharray="3.2 3.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div>
          <div className="status__eyebrow">In progress</div>
          <h2 className="status__title">Confirming your payment</h2>
        </div>
      </div>
      <p className="status__body">
        You are back from your bank. This takes a few seconds — please do not close or reload this
        window.
      </p>
    </div>
  );
}
