import { BASE_PATH, serverConfig } from '@/shared/config';
import { getEphemeralTicket } from '@/shared/lib/paynet';
import { CheckoutForm, PayShell } from '@/shared/ui';

// Step 1. A fresh single-use ticket for every page load, handed to the page as a prop.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const { sdkUrl, endpointId, orderAmount, orderCurrency } = serverConfig();
  const ephemeralTicket = await getEphemeralTicket();

  return (
    <PayShell>
      <CheckoutForm
        config={{
          basePath: BASE_PATH,
          sdkUrl,
          endpointId,
          ephemeralTicket,
          // The page shows what the server will actually charge
          amount: orderAmount,
          currency: orderCurrency,
        }}
      />
    </PayShell>
  );
}
