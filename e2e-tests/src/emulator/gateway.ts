// The three Paynet calls the examples make, faked.
//
//   POST {API_URL}/api/v4/tokenize/create-ephemeral-ticket/{ENDPOINT_ID}
//   POST {API_URL}/api/v4/sale/{ENDPOINT_ID}
//   POST {API_URL}/api/v4/status/{ENDPOINT_ID}
//
// All three are x-www-form-urlencoded and carry an OAuth 1.0a RSA-SHA256 Authorization header,
// which is verified here before anything else happens.

import type { ServerResponse } from 'node:http';
import {
  EMULATOR_ORIGIN,
  ENDPOINT_ID,
  MERCHANT_LOGIN,
  ORDER_AMOUNT,
  ORDER_CURRENCY,
} from '../settings.ts';
import { sendJson } from './http.ts';
import { createOrder, findOrder, mintTicket, type Order, scenarioForToken } from './state.ts';

/** The card the READMEs tell you to pay with; the emulator reports it back on the status. */
const CARD = { type: 'VISA', lastFour: '4448' };

export function createEphemeralTicket(response: ServerResponse): void {
  const ticket = mintTicket();

  if (ticket.startsWith('tkt_no-ticket_')) {
    // A refusal is a normal JSON reply, not a transport failure. The page turns it into the
    // "unavailable" copy and kills the Pay button, because only a reload can produce a new one.
    sendJson(response, 400, {
      'error-message': 'The endpoint is not allowed to create ephemeral tickets.',
      'error-code': 1,
    });
    return;
  }

  sendJson(response, 200, { ephemeralTicket: ticket });
}

export function sale(response: ServerResponse, params: Record<string, string>): void {
  const token = params.hosted_fields_token ?? '';
  const scenario = scenarioForToken(token);

  if (!scenario) {
    sendJson(response, 400, {
      'error-message': 'Unknown or already spent hosted_fields_token.',
    });
    return;
  }

  // The one thing the harness asserts about the request itself: the amount is the server's, and
  // a page that could choose it would be the bug this repository keeps warning about.
  if (params.amount !== ORDER_AMOUNT || params.currency !== ORDER_CURRENCY) {
    sendJson(response, 400, {
      'error-message': `Unexpected amount ${params.amount} ${params.currency}.`,
    });
    return;
  }

  if (scenario === 'sale-error') {
    sendJson(response, 400, {
      'error-message': 'The card number was rejected by the processor.',
      'error-code': 2,
    });
    return;
  }

  const order = createOrder({
    clientOrderId: params.client_orderid ?? '',
    scenario,
    redirectUrl: params.redirect_url ?? '',
    amount: params.amount ?? '',
    currency: params.currency ?? '',
    cardholderName: params.card_printed_name ?? '',
  });

  // paynet-order-id is a number here and a string in every other reply. That asymmetry is the
  // real gateway's, and reproducing it keeps the Go logger fix (commit bbd6ef1) covered.
  sendJson(response, 200, {
    'paynet-order-id': Number(order.orderId),
    'merchant-order-id': order.clientOrderId,
    'serial-number': `sn-${order.orderId}`,
  });
}

export function status(response: ServerResponse, params: Record<string, string>): void {
  if (params.login !== MERCHANT_LOGIN) {
    sendJson(response, 400, {
      'error-message': `Unknown login ${params.login}.`,
    });
    return;
  }

  const order = findOrder(params.orderid ?? '');
  if (!order) {
    sendJson(response, 400, {
      'error-message': `Unknown order ${params.orderid}.`,
    });
    return;
  }

  // 3DS: send the payer to the issuer once, then answer approved when they come back. The page
  // follows `redirect-to` on the first poll, so the challenge starts without a four-second wait.
  if (order.scenario === 'threeds' && !order.challengeDone) {
    sendJson(response, 200, {
      ...common(order),
      status: 'processing',
      'redirect-to': `${EMULATOR_ORIGIN}/acs?order=${encodeURIComponent(order.orderId)}`,
    });
    return;
  }

  if (order.scenario === 'declined') {
    sendJson(response, 200, {
      ...common(order),
      status: 'declined',
      'error-message': 'The issuing bank declined the payment.',
      'error-code': 3,
    });
    return;
  }

  sendJson(response, 200, {
    ...common(order),
    status: 'approved',
    'approval-code': '831000',
    'processor-rrn': `rrn-${order.orderId}`,
    bank_message: 'Approved',
  });
}

function common(order: Order) {
  return {
    // A string this time, unlike the sale reply above.
    'paynet-order-id': order.orderId,
    'merchant-order-id': order.clientOrderId,
    amount: order.amount,
    currency: order.currency,
    'card-type': CARD.type,
    'last-four-digits': CARD.lastFour,
    'cardholder-name': order.cardholderName,
  };
}

/** `/api/v4/<command>/<endpointId>` -> the command, when the endpoint id is ours. */
export function gatewayCommand(pathname: string): string | null {
  const match = pathname.match(/^\/api\/v4\/(.+)\/([^/]+)$/);
  if (!match?.[1] || match[2] !== ENDPOINT_ID) {
    return null;
  }
  return match[1];
}
