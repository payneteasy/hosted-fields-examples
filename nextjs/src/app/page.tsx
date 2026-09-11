import { BASE_PATH, serverConfig } from '@/shared/config';
import { getEphemeralTicket } from '@/shared/lib/paynet';
import { CheckoutForm, PayShell } from '@/shared/ui';

// Step 1. A fresh single-use ticket for every page load, handed to the page as a prop.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const { sdkUrl, endpointId, orderAmount, orderCurrency } = serverConfig();

  /* The page has to render even when the gateway call behind the ticket failed, or the payer is
     shown a crash instead of a sentence telling them what to do. This is what the other two
     examples do by emitting `error` in place of `ephemeralTicket` in config.js — the ticket is
     the only generated thing on the page, and it must not be able to take the page with it. */
  let ephemeralTicket = '';
  let error: string | undefined;
  try {
    ephemeralTicket = await getEphemeralTicket();
  } catch (cause) {
    // The reason stays on the server: it can carry the gateway's own response.
    error = cause instanceof Error ? cause.message : String(cause);
    console.error(`[error] ${error}`);
  }

  return (
    <PayShell>
      <CheckoutForm
        config={{
          basePath: BASE_PATH,
          sdkUrl,
          endpointId,
          ephemeralTicket,
          error,
          // The page shows what the server will actually charge
          amount: orderAmount,
          currency: orderCurrency,
        }}
      />
    </PayShell>
  );
}
