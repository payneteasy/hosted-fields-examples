import { readFileSync } from 'node:fs';

/**
 * Settings, all of them environment variables. See .env.example.
 *
 * Server-side only: nothing here may be imported from a 'use client' component. What the
 * browser needs is handed to it as props by the server components, the way the other two
 * examples inject `window.CONFIG` — so there is no NEXT_PUBLIC_* variable and no value baked
 * into the client bundle at build time.
 *
 * Unlike the Go and Express examples, the settings are validated on the first request rather
 * than at startup: `next build` imports this module to collect the routes, and a build must
 * not need production credentials.
 */

/** The URL prefix everything is mounted under. Also `basePath` in next.config.ts. */
export const BASE_PATH = process.env.BASE_PATH ?? '/hosted-fields-examples-nextjs';

export interface ServerConfig {
  publicUrl: string;
  apiUrl: string;
  sdkUrl: string;
  endpointId: string;
  merchantLogin: string;
  /** Shared secret the gateway signs its callbacks with. Not the RSA key. */
  merchantControl: string;
  orderAmount: string;
  orderCurrency: string;
  /** Signs the server calls, never leaves the server. */
  privateKey: string;
}

let cached: ServerConfig | null = null;

export function serverConfig(): ServerConfig {
  if (!cached) {
    cached = load();
  }
  return cached;
}

/** Where the payer lands after a 3DS challenge. Built from PUBLIC_URL, because behind a proxy
 *  the listen address is not what the payer's browser sees. */
export function redirectUrl(): string {
  return `${serverConfig().publicUrl}${BASE_PATH}/result/callback`;
}

function load(): ServerConfig {
  const port = process.env.PORT || '3002';

  return {
    publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
    // No defaults: the gateway host is per-installation, and a stale one baked in here would
    // silently point a real payment somewhere it does not belong.
    apiUrl: required('API_URL'),
    sdkUrl: required('SDK_URL'),
    endpointId: required('ENDPOINT_ID'),
    merchantLogin: required('MERCHANT_LOGIN'),
    merchantControl: required('MERCHANT_CONTROL'),
    orderAmount: process.env.ORDER_AMOUNT || '1.00',
    orderCurrency: process.env.ORDER_CURRENCY || 'USD',
    privateKey: readPrivateKey(),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set, see .env.example`);
  }
  return value;
}

/** The key comes from a file on a server, or inline for local runs. */
function readPrivateKey(): string {
  const path = process.env.PRIVATE_KEY_PATH;
  if (path) {
    return readFileSync(path, 'utf8');
  }
  const inline = process.env.PRIVATE_KEY;
  if (inline) {
    return inline;
  }
  throw new Error('set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example');
}
