import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resultConfig } from '@/shared/config';
import { applyStoredTheme, statusAmount } from '@/shared/lib';
import { OrderSummary, PayShell, ResultView } from '@/shared/ui';

/* The 3DS return page, GET {prefix}/result — dist/result.html plus this bundle.

   The payer arrives here from their bank, through POST {prefix}/result/callback, which checks
   the gateway's checksum and redirects with the same four signed values in the query. The
   server checks that checksum again before it serves this page, so by the time this file runs
   the order in the query has been verified twice and a hand-edited URL has already had its
   403. No SDK on this page: there is no card on it to tokenize.                            */

applyStoredTheme();

const config = resultConfig();

const params = new URLSearchParams(window.location.search);
const orderId = params.get('orderid') ?? '';
const clientOrderId = params.get('merchant_order') ?? '';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root is missing from the page template');
}

createRoot(root).render(
  <StrictMode>
    <PayShell>
      {/* The amount the gateway was asked for, and the order from the signed callback */}
      <OrderSummary
        amount={statusAmount({ amount: config.amount, currency: config.currency })}
        orderRef={clientOrderId ? `Order ${clientOrderId}` : undefined}
      />
      <ResultView basePath={config.basePath} orderId={orderId} clientOrderId={clientOrderId} />
    </PayShell>
  </StrictMode>,
);
