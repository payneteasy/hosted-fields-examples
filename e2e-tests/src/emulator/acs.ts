// The issuer's 3DS challenge page, and the signed return that follows it.
//
// The payer's browser is sent here by `redirect-to` on the first status poll. The page posts
// status / orderid / merchant_order / control back to the redirect_url the Sale carried — which
// is {PUBLIC_URL}{BASE_PATH}/result/callback — and `control` is the sha1 the three examples
// check. The browser carries those four values on to /result but cannot forge them, because it
// never sees MERCHANT_CONTROL.

import type { ServerResponse } from 'node:http';
import { controlSum } from './control-sum.ts';
import { sendHtml, sendText } from './http.ts';
import { findOrder } from './state.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function challengePage(response: ServerResponse, orderId: string): void {
  const order = findOrder(orderId);
  if (!order) {
    sendText(response, 404, `unknown order ${orderId}`);
    return;
  }

  // The payer has "passed" the challenge by arriving; the next status poll says approved.
  order.challengeDone = true;

  const status = 'approved';
  const control = controlSum(status, order.orderId, order.clientOrderId);
  const fields: Array<[string, string]> = [
    ['status', status],
    ['orderid', order.orderId],
    ['merchant_order', order.clientOrderId],
    ['control', control],
  ];

  // A real ACS shows the payer a code to type. This one submits as soon as the test clicks,
  // which keeps the hop visible in a trace instead of flashing past.
  sendHtml(
    response,
    200,
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>3-D Secure challenge</title></head>
<body>
  <h1>Your bank</h1>
  <p id="acsOrder">Confirming order ${escapeHtml(order.clientOrderId)}</p>
  <form id="acsForm" method="post" action="${escapeHtml(order.redirectUrl)}">
    ${fields.map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join('\n    ')}
    <button type="submit" id="acsApprove">Approve</button>
  </form>
</body>
</html>`,
  );
}
