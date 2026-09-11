import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { BASE_PATH, serverConfig } from '@/shared/config';
import { decodeReturnOrder, RETURN_COOKIE } from '@/shared/lib/return-cookie';
import { statusAmount } from '@/shared/lib/status-format';
import { OrderSummary, PayShell, ResultView } from '@/shared/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment result · Northwind Supply',
};

export default async function ResultPage() {
  const { orderAmount, orderCurrency } = serverConfig();
  const order = decodeReturnOrder((await cookies()).get(RETURN_COOKIE)?.value);

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
