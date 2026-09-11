// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

import { createSign, randomBytes } from 'node:crypto';
import { MERCHANT_LOGIN, PRIVATE_KEY } from './config.js';

// RFC 3986 percent encoding: encodeURIComponent leaves ! ' ( ) * unescaped
function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Accepts a PEM with real newlines or with escaped \n, and tolerates indentation
function normalizeKey(pem) {
  return pem.replace(/\\n/g, '\n').split('\n').map((line) => line.trim()).join('\n');
}

/**
 * Builds the Authorization header for a signed API call.
 * bodyParams are the x-www-form-urlencoded parameters of the request, if any.
 */
export function buildAuthHeader(method, url, bodyParams = {}) {
  const oauthParams = {
    oauth_consumer_key: MERCHANT_LOGIN,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'RSA-SHA256',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };

  // Signature base string: METHOD&url&sorted-parameters, each part percent-encoded
  const params = { ...bodyParams, ...oauthParams };
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
  const baseString = `${method.toUpperCase()}&${encode(url)}&${encode(normalized)}`;

  const signature = createSign('RSA-SHA256').update(baseString).sign(normalizeKey(PRIVATE_KEY), 'base64');

  // Header values are not encoded by the transport, so encode them here
  const header = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.entries(header).map(([key, value]) => `${key}="${encode(value)}"`).join(', ')}`;
}
