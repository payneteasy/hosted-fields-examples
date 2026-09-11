'use client';

import { useEffect } from 'react';
import { PayShell } from '@/shared/ui';

/**
 * The last resort. The checkout page handles a failed ticket call itself, so what reaches this
 * boundary is something unforeseen — and the payer is told what they can do about it, in the
 * same words the other two examples use, rather than being shown the cause. An Error thrown on
 * the server can carry the gateway's own response, which is not the payer's to read.
 *
 * No action buttons: basePath is a server value, and a link built without it would send the
 * payer out of the app.
 */
export default function CheckoutError({ error }: { error: Error }) {
  // The detail belongs in the log. On the server it is already there; this covers the rest.
  useEffect(() => {
    console.error(`[error] ${error.message}`);
  }, [error]);

  return (
    <PayShell>
      <div id="orderStatus" className="status status--error">
        <div className="status__head">
          <span className="status__badge">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path
                d="M6 6l8 8M14 6l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div>
            <div className="status__eyebrow">Not completed</div>
            <h2 className="status__title">Something went wrong</h2>
          </div>
        </div>
        <p className="status__body">
          The payment could not be started and nothing has been charged. Reload the page to try
          again.
        </p>
      </div>
    </PayShell>
  );
}
