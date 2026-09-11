// Payment Gateway calls used by the Hosted Fields flow.
// https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

import { buildAuthHeader } from './oauth.js';
import { API_URL, ENDPOINT_ID, MERCHANT_LOGIN, ORDER_AMOUNT, ORDER_CURRENCY, REDIRECT_URL } from './config.js';

// A rejected request — a validation error or a decline — comes back as 4xx with a JSON body,
// so the body is decoded whatever the status: it carries the error-message the page shows the
// payer. Only a reply that is not JSON at all counts as a failure of the call itself.
async function postJson(url, params) {
  const { text, status } = await post(url, params);
  try {
    return JSON.parse(text);
  } catch {
    // The body is not quoted: it reaches the page as {error}. The log below has the detail.
    throw new Error(`gateway request failed with ${status}`);
  }
}

async function post(url, params) {
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
  const text = await response.text();
  console.log('[paynet] POST %s -> %d%s', url, response.status, logReason(text));
  return { text, status: response.status };
}

// What goes in the log beside the status code. Not the body: a status reply carries the card's
// last four digits and the holder's name, and the ticket reply carries the ticket. The gateway
// puts everything a log needs to be useful into these two fields anyway.
function logReason(text) {
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch {
    return ' (reply is not JSON)';
  }
  const orderId = decoded['paynet-order-id'] ? ` order ${decoded['paynet-order-id']}` : '';
  const message = decoded['error-message'] ? ` ${oneLine(String(decoded['error-message']))}` : '';
  return orderId + message;
}

function oneLine(text) {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

// Step 1. Single-use ticket, valid 15 minutes, safe to embed into the page.
export async function getEphemeralTicket() {
  const data = await postJson(`${API_URL}/api/v4/tokenize/create-ephemeral-ticket/${ENDPOINT_ID}`);
  if (!data.ephemeralTicket) throw new Error(data['error-message'] || 'no ephemeralTicket in the response');
  return String(data.ephemeralTicket).trim();
}

// Step 3. A regular Sale where hosted_fields_token replaces the card parameters.
// credit_card_number, expire_month, expire_year and cvv2 must not be sent.
export async function createSale({ hostedFieldsToken, clientOrderId, customer, ipaddress, browser }) {
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
    card_printed_name: customer?.cardPrintedName ?? '',
    first_name: customer?.firstName ?? '',
    last_name: customer?.lastName ?? '',
    address1: '100 Main st',
    city: 'Seattle',
    zip_code: '98102',
    country: 'US',
    state: 'WA',
    phone: '+12063582043',
    email: customer?.email ?? '',
    ipaddress,
    redirect_url: REDIRECT_URL,
  });
}

// Order status request, polled until a final status
export async function getStatus({ orderId, clientOrderId }) {
  return postJson(`${API_URL}/api/v4/status/${ENDPOINT_ID}`, {
    login: MERCHANT_LOGIN,
    client_orderid: clientOrderId,
    orderid: orderId,
  });
}
