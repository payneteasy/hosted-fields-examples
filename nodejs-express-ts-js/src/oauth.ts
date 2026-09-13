// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

import { createSign, randomBytes } from 'node:crypto';
import { MERCHANT_LOGIN, PRIVATE_KEY } from './config.ts';

// RFC 3986 percent encoding: encodeURIComponent leaves ! ' ( ) * unescaped
export function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Accepts a PEM with real newlines or with escaped \n, and tolerates indentation
function normalizeKey(pem: string): string {
  return pem
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

/**
 * The signature base string: METHOD&url&sorted-parameters, each part percent-encoded. It carries
 * no secret, which is what makes it testable on its own — and it is where a signature usually
 * goes wrong, because every part has to be encoded to RFC 3986 rather than to the looser rules
 * the standard library applies.
 */
export function baseString(method: string, url: string, params: Record<string, string>): string {
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key] ?? '')}`)
    .join('&');
  return `${method.toUpperCase()}&${encode(url)}&${encode(normalized)}`;
}

/**
 * Builds the Authorization header for a signed API call.
 * bodyParams are the x-www-form-urlencoded parameters of the request, if any.
 */
export function buildAuthHeader(method: string, url: string, bodyParams: Record<string, string> = {}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: MERCHANT_LOGIN,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'RSA-SHA256',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };

  const base = baseString(method, url, { ...bodyParams, ...oauthParams });

  const signature = createSign('RSA-SHA256').update(base).sign(normalizeKey(PRIVATE_KEY), 'base64');

  // Header values are not encoded by the transport, so encode them here
  const header = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.entries(header)
    .map(([key, value]) => `${key}="${encode(value)}"`)
    .join(', ')}`;
}
