// All settings come from the environment, see .env.example

import { readFileSync } from 'node:fs';

export const PORT = process.env.PORT ?? 3000;
export const BASE_PATH = process.env.BASE_PATH ?? '';
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

export const API_URL = process.env.API_URL;
export const SDK_URL = process.env.SDK_URL;

export const ENDPOINT_ID = process.env.ENDPOINT_ID;
export const MERCHANT_LOGIN = process.env.MERCHANT_LOGIN;
// Shared secret the gateway signs its callbacks with. Not the RSA key.
export const MERCHANT_CONTROL = process.env.MERCHANT_CONTROL;
// The key is a multi-line PEM, which neither systemd's EnvironmentFile nor most secret stores
// handle well, so a path is the deployment-friendly form and the inline value the local one.
export const PRIVATE_KEY = process.env.PRIVATE_KEY_PATH ? readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8') : process.env.PRIVATE_KEY;

export const ORDER_AMOUNT = process.env.ORDER_AMOUNT ?? '1.00';
export const ORDER_CURRENCY = process.env.ORDER_CURRENCY ?? 'EUR';

// The payer returns here after a 3DS challenge
export const REDIRECT_URL = `${PUBLIC_URL}${BASE_PATH}/result`;

for (const [name, value] of Object.entries({ API_URL, SDK_URL, ENDPOINT_ID, MERCHANT_LOGIN, MERCHANT_CONTROL })) {
  if (!value) throw new Error(`${name} is not set, see .env.example`);
}

if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example');
