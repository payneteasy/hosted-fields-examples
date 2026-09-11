'use client';

import { PayShell } from '@/shared/ui';

/**
 * The gateway calls the pages make can fail — most often because a setting is missing. The
 * other two examples answer such a failure with one 502 and a message; here the equivalent
 * is this boundary, which puts the message in the panel the payer would see anyway.
 *
 * No action buttons: basePath is a server value, and a link built without it would send the
 * payer out of the app.
 */
export default function CheckoutError({ error }: { error: Error }) {
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
        <dl className="status__rows">
          <dt>Reason</dt>
          <dd>{error.message}</dd>
        </dl>
      </div>
    </PayShell>
  );
}
