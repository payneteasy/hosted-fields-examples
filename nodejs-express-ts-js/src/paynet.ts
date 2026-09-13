// Payment Gateway calls used by the Hosted Fields flow.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

import { API_URL, ENDPOINT_ID, MERCHANT_LOGIN, ORDER_AMOUNT, ORDER_CURRENCY, REDIRECT_URL } from './config.ts';
import { isJsonObject, type JsonObject, text } from './json.ts';
import { buildAuthHeader } from './oauth.ts';

// A rejected request — a validation error or a decline — comes back as 4xx with a JSON body,
// so the body is decoded whatever the status: it carries the error-message the page shows the
// payer. Only a reply that is not JSON at all counts as a failure of the call itself.
async function postJson(url: string, params?: Record<string, string>): Promise<JsonObject> {
  const { text: body, status } = await post(url, params);
  // JSON.parse is `any`. Annotating the result `unknown` is what forces the check below to
  // exist: without it every field of a reply the gateway wrote would be read as though this
  // file had promised its shape.
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    // The body is not quoted: it reaches the page as {error}. The log below has the detail.
    throw new Error(`gateway request failed with ${status}`);
  }
  if (!isJsonObject(decoded)) throw new Error(`gateway request failed with ${status}`);
  return decoded;
}

async function post(url: string, params?: Record<string, string>): Promise<{ text: string; status: number }> {
  const body = params ? new URLSearchParams(params).toString() : '';
  const response = await fetch(url, {
    method: 'POST',
    // The Go example's http.Client has the same 30s, and Next passes the same AbortSignal:
    // without one a wedged gateway holds the request, and the payer's page, indefinitely.
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Ask for JSON instead of the default x-www-form-urlencoded reply, which arrives as
      // key=value pairs separated by newlines. https://doc.payneteasy.com/integration/openapi.html
      Accept: 'application/vnd.pay+json',
      Authorization: buildAuthHeader('POST', url, params),
    },
    body,
  });
  const replyText = await response.text();
  console.log('[paynet] POST %s -> %d%s', url, response.status, logReason(replyText));
  return { text: replyText, status: response.status };
}

// What goes in the log beside the status code. Not the body: a status reply carries the card's
// last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
// puts everything a log needs to be useful into these two fields anyway.
function logReason(body: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return ' (reply is not JSON)';
  }
  if (!isJsonObject(decoded)) return ' (reply is not JSON)';
  const orderId = text(decoded, 'paynet-order-id') ? ` order ${text(decoded, 'paynet-order-id')}` : '';
  const reason = text(decoded, 'error-message') ? ` ${oneLine(text(decoded, 'error-message'))}` : '';
  return orderId + reason;
}

function oneLine(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

// Step 1. Single-use ticket, valid 15 minutes, safe to embed into the page.
export async function getEphemeralTicket(): Promise<string> {
  const data = await postJson(`${API_URL}/api/v4/tokenize/create-ephemeral-ticket/${ENDPOINT_ID}`);
  const ticket = text(data, 'ephemeralTicket').trim();
  if (!ticket) throw new Error(text(data, 'error-message') || 'no ephemeralTicket in the response');
  return ticket;
}

export interface SaleRequest {
  hostedFieldsToken: string;
  clientOrderId: string;
  /** Straight off the request body, so it is a bag of unknowns rather than a Customer. */
  customer: JsonObject;
  ipaddress: string;
  browser: Record<string, string>;
}

// Step 3. A regular Sale where hosted_fields_token replaces the card parameters.
// credit_card_number, expire_month, expire_year and cvv2 must not be sent.
export async function createSale({ hostedFieldsToken, clientOrderId, customer, ipaddress, browser }: SaleRequest): Promise<JsonObject> {
  return postJson(`${API_URL}/api/v4/sale/${ENDPOINT_ID}`, {
    // 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so it goes first
    // and every server-owned field below overwrites it — the handler already filtered it to the
    // documented keys, and this ordering is what keeps that a belt and not a single thread.
    ...browser,
    client_orderid: clientOrderId,
    order_desc: 'Hosted Fields example order',
    amount: ORDER_AMOUNT,
    currency: ORDER_CURRENCY,
    hosted_fields_token: hostedFieldsToken,
    // Composed by the page from first and last name: the hosted fields token does not carry
    // the holder, and the platform leaves it empty unless it is sent here.
    card_printed_name: text(customer, 'cardPrintedName'),
    first_name: text(customer, 'firstName'),
    last_name: text(customer, 'lastName'),
    address1: '100 Main st',
    city: 'Seattle',
    zip_code: '98102',
    country: 'US',
    state: 'WA',
    phone: '+12063582043',
    email: text(customer, 'email'),
    ipaddress,
    redirect_url: REDIRECT_URL,
  });
}

// Order status request, polled until a final status
export async function getStatus({ orderId, clientOrderId }: { orderId: string; clientOrderId: string }): Promise<JsonObject> {
  return postJson(`${API_URL}/api/v4/status/${ENDPOINT_ID}`, {
    login: MERCHANT_LOGIN,
    client_orderid: clientOrderId,
    orderid: orderId,
  });
}
