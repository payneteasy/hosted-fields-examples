// What the fake SDK bundle calls to turn three card values into a hosted_fields_token.
//
// The real SDK does this against the gateway from inside the browser, which is the whole point
// of Hosted Fields: the card never reaches the merchant's server, only the token does. This
// endpoint is reached by `fetch` from the merchant page, so it is what the CSP's
// `connect-src 'self' {SDK_ORIGIN}` rule has to allow.

import type { ServerResponse } from 'node:http';
import { sendJson } from './http.ts';
import { mintToken } from './state.ts';

interface TokenizeRequest {
  ephemeralTicket?: string;
  cardNumber?: string;
  expiryDate?: string;
  cvv?: string;
}

export function tokenize(response: ServerResponse, body: string): void {
  let request: TokenizeRequest;
  try {
    request = JSON.parse(body) as TokenizeRequest;
  } catch {
    sendJson(response, 400, {
      code: 4001,
      message: 'malformed tokenize request',
    });
    return;
  }

  const number = (request.cardNumber ?? '').replace(/\s+/g, '');
  if (number.length < 12) {
    // 4004 is the everyday mistyped-card case, and the page has a distinct copy for it.
    sendJson(response, 400, {
      code: 4004,
      message: 'card number rejected',
      payerMessage: 'That card number was not accepted.',
      field: 'cardNumber',
    });
    return;
  }
  if (!request.expiryDate || !request.cvv) {
    sendJson(response, 400, {
      code: 4002,
      message: 'incomplete card data',
      payerMessage: 'Check the expiry date and CVV.',
    });
    return;
  }

  const token = mintToken(request.ephemeralTicket ?? '');
  if (!token) {
    // The 4xxx class spends the ticket, so the page treats this as terminal.
    sendJson(response, 400, {
      code: 4003,
      message: 'the ephemeral ticket is unknown or already spent',
    });
    return;
  }

  sendJson(response, 200, { hostedFieldsToken: token });
}
