import { createSign, randomBytes } from 'node:crypto';

// OAuth 1.0a RSA-SHA256 request signing.
// https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

/**
 * encode is RFC 3986 percent encoding. encodeURIComponent leaves ! ' ( ) *
 * alone, and those break the signature.
 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalize(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
}

/**
 * Builds the Authorization header for a signed API call. `params` are the
 * x-www-form-urlencoded parameters of the request, which are signed together
 * with the oauth_* ones.
 */
export function authHeader(
  method: string,
  endpoint: string,
  params: Record<string, string>,
  privateKeyPem: string,
  merchantLogin: string,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: merchantLogin,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'RSA-SHA256',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };

  // Signature base string: METHOD&url&sorted-parameters, each part percent-encoded
  const baseString = [
    method.toUpperCase(),
    encode(endpoint),
    encode(normalize({ ...params, ...oauth })),
  ].join('&');

  const sign = createSign('RSA-SHA256');
  sign.update(baseString);
  // A PEM that travelled through a single-line environment variable carries escaped \n
  oauth.oauth_signature = sign.sign(privateKeyPem.replace(/\\n/g, '\n'), 'base64');

  // Header values are not encoded by the transport, so encode them here
  return `OAuth ${Object.keys(oauth)
    .sort()
    .map((key) => `${key}="${encode(oauth[key])}"`)
    .join(', ')}`;
}
