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
 * gateway's own checksum over these very values. Rechecking it is what stops a hand-edited URL:
 * without it the page would happily poll somebody else's order.
 *
 * src/middleware.ts has already answered a bad signature with a 403, so in practice nothing
 * reaches this check that would fail it. It stays because a page that reads an order id out of
 * its own query should be the thing that verifies it: the day the matcher is edited, this is
 * what keeps the order from being served anyway.
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
  if (!(await validCallback(query, serverConfig().merchantControl))) {
    console.error(`[error] result signature mismatch for order ${orderId}`);
    return null;
  }
  return { orderId, clientOrderId: query.get('merchant_order') ?? '' };
}
