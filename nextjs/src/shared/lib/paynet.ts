import { redirectUrl, serverConfig } from '@/shared/config';
import type { Customer } from './customer';
import { authHeader } from './oauth';

// The three gateway calls the Hosted Fields flow needs.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

/**
 * A decoded gateway reply. Keys are the documented kebab-case names; values are
 * mostly strings, but not always — error-code is a number in a sale response.
 */
export type GatewayResponse = Record<string, unknown>;

/**
 * A single-use ticket the browser exchanges for a hosted fields token. It is
 * valid for 15 minutes and safe to put on the page.
 */
export async function getEphemeralTicket(): Promise<string> {
  const decoded = await postJSON('/api/v4/tokenize/create-ephemeral-ticket/', {});
  const ticket = decoded.ephemeralTicket;
  if (typeof ticket !== 'string' || ticket.trim() === '') {
    // A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
    // field is quoted: this reason travels on to the page as a prop, where the browser can read
    // it, and the rest of the reply is the gateway's business and not the payer's.
    const message = decoded['error-message'];
    throw new Error(
      typeof message === 'string' && message !== ''
        ? `no ephemeralTicket: ${message}`
        : 'no ephemeralTicket in the response',
    );
  }
  return ticket.trim();
}

/**
 * Charges the card behind the hosted fields token. The token replaces
 * credit_card_number, expire_month, expire_year and cvv2 — sending those is an error.
 */
export function createSale(sale: {
  hostedFieldsToken: string;
  clientOrderId: string;
  ipaddress: string;
  browser: Record<string, string>;
  customer: Customer;
}): Promise<GatewayResponse> {
  const { orderAmount, orderCurrency } = serverConfig();

  return postJSON('/api/v4/sale/', {
    // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so it goes first
    // and every server-owned field below overwrites it: POST /pay already filtered it to the
    // documented keys, and this ordering is what keeps that a belt and not a single thread.
    ...sale.browser,
    client_orderid: sale.clientOrderId,
    order_desc: 'Hosted Fields example order',
    amount: orderAmount,
    currency: orderCurrency,
    hosted_fields_token: sale.hostedFieldsToken,
    card_printed_name: sale.customer.cardPrintedName,
    first_name: sale.customer.firstName,
    last_name: sale.customer.lastName,
    address1: '100 Main st',
    city: 'Seattle',
    zip_code: '98102',
    country: 'US',
    state: 'WA',
    phone: '+12063582043',
    email: sale.customer.email,
    ipaddress: sale.ipaddress,
    redirect_url: redirectUrl(),
  });
}

/** Polled until the order reaches a final status. */
export function getStatus(order: {
  orderId: string;
  clientOrderId: string;
}): Promise<GatewayResponse> {
  return postJSON('/api/v4/status/', {
    login: serverConfig().merchantLogin,
    client_orderid: order.clientOrderId,
    orderid: order.orderId,
  });
}

/**
 * Sends a signed command and decodes the reply. A rejected request — a validation error or a
 * decline — comes back as 4xx with a JSON body, so the body is decoded whatever the status:
 * it carries the error-message for the page. Only a reply that is not JSON at all counts as
 * a failure of the call itself.
 */
async function postJSON(command: string, params: Record<string, string>): Promise<GatewayResponse> {
  const { apiUrl, endpointId, merchantLogin, privateKey } = serverConfig();
  const endpoint = apiUrl + command + endpointId;
  const body = new URLSearchParams(params).toString();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Ask for JSON instead of the default x-www-form-urlencoded reply.
      // https://doc.payneteasy.com/integration/openapi.html
      Accept: 'application/vnd.pay+json',
      Authorization: authHeader('POST', endpoint, params, privateKey, merchantLogin),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  console.log(`[paynet] POST ${endpoint} -> ${response.status}${logReason(text)}`);

  try {
    return JSON.parse(text) as GatewayResponse;
  } catch {
    // The body is not quoted: it reaches the page as {error}. The log above has the detail.
    throw new Error(`gateway request failed with ${response.status}`);
  }
}

/**
 * What goes in the log beside the status code. Not the body: a status reply carries the card's
 * last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
 * puts everything a log needs to be useful into these two fields anyway.
 */
function logReason(text: string): string {
  let decoded: GatewayResponse;
  try {
    decoded = JSON.parse(text) as GatewayResponse;
  } catch {
    return ' (reply is not JSON)';
  }
  const orderId = decoded['paynet-order-id'] ? ` order ${String(decoded['paynet-order-id'])}` : '';
  const message = decoded['error-message'] ? ` ${oneLine(String(decoded['error-message']))}` : '';
  return orderId + message;
}

function oneLine(body: string): string {
  return body.split(/\s+/).filter(Boolean).join(' ');
}
