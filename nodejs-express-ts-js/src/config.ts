// All settings come from the environment, see .env.example

import { readFileSync } from 'node:fs';

// The one shape the JavaScript example next door does not have. There a missing setting is
// caught by a loop at the bottom of the file and every use afterwards is still typed as
// possibly-undefined, which is why nothing downstream can tell the difference between "checked"
// and "hoped for". Here the check and the narrowing are the same line: everything below is
// `string`, and not one `!` appears in the rest of the app.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, see .env.example`);
  return value;
}

export const PORT = Number(process.env.PORT ?? 3011);
// Not in the JavaScript example, which passes whatever the environment said straight to
// app.listen: typing this as a number is what makes PORT=8O80 a refusal to start rather than a
// listener on a random port.
if (!Number.isInteger(PORT) || PORT <= 0) throw new Error('PORT must be a positive integer');

// Interface to listen on. The default is loopback: the example speaks plain HTTP and trusts
// X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0 knowingly.
export const LISTEN_ADDR = process.env.LISTEN_ADDR ?? '127.0.0.1';
export const BASE_PATH = process.env.BASE_PATH ?? '/hosted-fields-examples-nodejs-express-ts-js';
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

export const API_URL = required('API_URL');
export const SDK_URL = required('SDK_URL');
// Origin of SDK_URL, scheme and host only: the Content-Security-Policy has to name the host the
// SDK bundle and the card iframes come from, and nothing else.
export const SDK_ORIGIN = URL.canParse(SDK_URL) ? new URL(SDK_URL).origin : '';

export const ENDPOINT_ID = required('ENDPOINT_ID');
export const MERCHANT_LOGIN = required('MERCHANT_LOGIN');
// Shared secret the gateway signs its callbacks with. Not the RSA key.
export const MERCHANT_CONTROL = required('MERCHANT_CONTROL');

// The key is a multi-line PEM, which neither systemd's EnvironmentFile nor most secret stores
// handle well, so a path is the deployment-friendly form and the inline value the local one.
export const PRIVATE_KEY = process.env.PRIVATE_KEY_PATH
  ? readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8')
  : (process.env.PRIVATE_KEY ?? '');

if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example');

export const ORDER_AMOUNT = process.env.ORDER_AMOUNT ?? '1.00';
export const ORDER_CURRENCY = process.env.ORDER_CURRENCY ?? 'USD';

// Where the gateway sends the payer back after a 3DS challenge. It POSTs there, so this is
// /result/callback and not the /result page the callback then redirects to. Built from
// PUBLIC_URL, because behind a proxy the listen address is not what the payer's browser sees.
export const REDIRECT_URL = `${PUBLIC_URL}${BASE_PATH}/result/callback`;
