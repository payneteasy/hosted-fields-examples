import type { Customer } from '@/shared/lib';

/** What the gateway answered the Sale with, plus the clientOrderId the server minted. */
export type SaleResult = Record<string, unknown>;

export interface SaleRequest {
  /** What the card became. The card itself never leaves the gateway's iframes. */
  hostedFieldsToken: string;
  browser: Record<string, string>;
  customer: Customer;
}

/**
 * Step 3. POST {prefix}/pay — the Sale.
 *
 * Note what is not in the body: no amount, no currency, no redirect_url, no client_orderid.
 * Those are the server's, and it writes them after the browser's fields rather than before, so
 * a request that named one would not get to choose what the payer is charged.
 */
export async function postSale(basePath: string, body: SaleRequest): Promise<SaleResult> {
  const response = await fetch(`${basePath}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as SaleResult;
}
