/** A gateway reply as the page sees it: kebab-case keys, values mostly but not always strings. */
export type OrderStatusData = Record<string, unknown>;

/**
 * Step 4. GET {prefix}/status — the order, looked up over the gateway's API by the server.
 *
 * Both identifiers are sent back on every poll: orderId is the gateway's, clientOrderId is the
 * merchant's own, and the server requires both. The 3DS return page takes them out of the
 * signed query the callback redirected to, which is why a hand-edited URL cannot reach
 * somebody else's order.
 */
export async function getOrderStatus(
  basePath: string,
  orderId: string,
  clientOrderId: string,
): Promise<OrderStatusData> {
  const query = `orderId=${encodeURIComponent(orderId)}&clientOrderId=${encodeURIComponent(clientOrderId)}`;
  const response = await fetch(`${basePath}/status?${query}`);
  return (await response.json()) as OrderStatusData;
}
