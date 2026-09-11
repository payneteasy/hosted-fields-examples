// Verification of the OAuth 1.0a RSA-SHA256 header the three apps sign their calls with.
//
// This is the half of the handshake no unit test can cover: go-js/oauth_test.go and
// nodejs-express-js/src/oauth.test.js check each signer against a hard-coded base string, but
// nothing checks that the bytes actually on the wire verify against the key. Here they do.
//
// Set E2E_VERIFY_OAUTH=0 to accept any header, which is worth doing only to find out whether a
// failure is the app's or this verifier's.

import { createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PUBLIC_KEY_PATH } from '../keys.ts';

/** RFC 3986: encodeURIComponent leaves ! ' ( ) * alone and the signature base string must not. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function baseString(method: string, url: string, params: Record<string, string>): string {
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key] ?? '')}`)
    .join('&');
  return `${method.toUpperCase()}&${encode(url)}&${encode(normalized)}`;
}

/** `OAuth key="value", key="value"` -> a map with the values percent-decoded. */
function parseHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const value = header.replace(/^OAuth\s+/i, '');
  for (const part of value.split(',')) {
    const match = part.trim().match(/^([^=]+)="(.*)"$/);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out[decodeURIComponent(match[1].trim())] = decodeURIComponent(match[2]);
    }
  }
  return out;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export function verifyOAuth(
  method: string,
  url: string,
  bodyParams: Record<string, string>,
  header: string | undefined,
): VerifyResult {
  if (process.env.E2E_VERIFY_OAUTH === '0') {
    return { ok: true };
  }
  if (!header) {
    return { ok: false, reason: 'no Authorization header' };
  }

  const oauth = parseHeader(header);
  const signature = oauth.oauth_signature;
  if (!signature) {
    return {
      ok: false,
      reason: 'no oauth_signature in the Authorization header',
    };
  }
  if (oauth.oauth_signature_method !== 'RSA-SHA256') {
    return {
      ok: false,
      reason: `unexpected oauth_signature_method ${oauth.oauth_signature_method}`,
    };
  }

  // Everything but the signature itself is signed, together with the form body.
  const { oauth_signature: _signature, ...signedOauth } = oauth;
  const base = baseString(method, url, { ...bodyParams, ...signedOauth });

  const verified = createVerify('RSA-SHA256')
    .update(base)
    .verify(readFileSync(PUBLIC_KEY_PATH, 'utf8'), signature, 'base64');

  return verified ? { ok: true } : { ok: false, reason: 'signature does not verify' };
}
