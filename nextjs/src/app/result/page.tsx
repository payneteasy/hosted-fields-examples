import type { Metadata } from 'next';
import { BASE_PATH, serverConfig } from '@/shared/config';
import { statusAmount } from '@/shared/lib';
import { validCallback } from '@/shared/lib/callback';
import { OrderSummary, PayShell, ResultView } from '@/shared/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment result · Northwind Supply',
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { orderAmount, orderCurrency } = serverConfig();
  const order = await verifiedOrder(searchParams);

  return (
    <PayShell>
      {/* The amount the gateway was asked for, and the order from the signed callback */}
      <OrderSummary
        amount={statusAmount({ amount: orderAmount, currency: orderCurrency })}
        orderRef={order ? `Order ${order.clientOrderId}` : undefined}
      />
      <ResultView
        basePath={BASE_PATH}
        orderId={order?.orderId ?? ''}
        clientOrderId={order?.clientOrderId ?? ''}
      />
    </PayShell>
  );
}

/**
 * The query is only there when the payer came through /result/callback, and it carries the
 * gateway's own checksum over these very values. Rechecking it is what stops a hand-edited
 * URL: without it the page would happily poll somebody else's order.
 *
 * Unlike the other examples this answers with the empty page rather than a 403 — a React
 * page cannot set a status code without the experimental `forbidden()`, and refusing to show
 * the order is the part that matters.
 */
async function verifiedOrder(
  searchParams: Promise<SearchParams>,
): Promise<{ orderId: string; clientOrderId: string } | null> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') {
      query.set(name, value);
    }
  }

  const orderId = query.get('orderid') ?? '';
  if (orderId === '') {
    return null;
  }
  if (!validCallback(query)) {
    console.error(`[error] result signature mismatch for order ${orderId}`);
    return null;
  }
  return { orderId, clientOrderId: query.get('merchant_order') ?? '' };
}
