import { type NextRequest, NextResponse } from 'next/server';
import { validCallback } from '@/shared/lib/callback';

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * 1. A hand-edited /result URL gets a 403, the same as in the Go and Express examples. It lives
 *    here rather than in result/page.tsx because a React page cannot set a status code —
 *    `forbidden()` is still behind experimental.authInterrupts in this version of Next, and an
 *    example is not the place to turn an experimental flag on. A middleware runs first and can.
 *
 * 2. The security headers a payment page ought to send, including the Content-Security-Policy.
 *
 * The edge runtime is why callback.ts uses Web Crypto and takes the secret as an argument:
 * neither node:crypto nor the node:fs behind serverConfig() exists here. MERCHANT_CONTROL and
 * SDK_URL are read straight from the environment, and a deployment that has not set
 * MERCHANT_CONTROL fails every signature check — which is the right way round.
 */
export async function middleware(request: NextRequest) {
  const forbidden = await forbiddenResult(request);
  if (forbidden) {
    // Four words of plain text, and no script at all — so no nonce to mint for it.
    return withSecurityHeaders(forbidden);
  }

  /* Unlike the other two examples this page has an inline script it cannot move out: Next emits
     its own for hydration, and the theme bootstrap has to run before paint. So the policy carries
     a per-request nonce instead of 'unsafe-inline'. Next puts it on its own scripts when it finds
     it in the request's CSP header, and layout.tsx reads it back from x-nonce for ours. */
  const nonce = crypto.randomUUID();
  const policy = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);

  return withSecurityHeaders(NextResponse.next({ request: { headers } }), nonce);
}

/** Only /result carries a signature, and only when the payer actually came from a payment. */
async function forbiddenResult(request: NextRequest): Promise<NextResponse | null> {
  // nextUrl.pathname has basePath stripped off already, so this is the matcher's own spelling.
  if (request.nextUrl.pathname !== '/result') {
    return null;
  }

  const query = request.nextUrl.searchParams;
  // No query at all is fine: the page then says there is nothing to show.
  if (!query.get('orderid')) {
    return null;
  }
  if (await validCallback(query, process.env.MERCHANT_CONTROL ?? '')) {
    return null;
  }

  console.error(`[error] result signature mismatch for order ${query.get('orderid')}`);
  return new NextResponse('invalid result signature', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/* The card fields are iframes from the gateway, so the SDK host has to be named in frame-src as
   well as in script-src. Everything else is denied by default. */
function contentSecurityPolicy(nonce?: string): string {
  const sdkOrigin = URL.canParse(process.env.SDK_URL ?? '')
    ? new URL(process.env.SDK_URL as string).origin
    : '';

  return [
    "default-src 'none'",
    ["script-src 'self'", nonce && `'nonce-${nonce}'`, sdkOrigin].filter(Boolean).join(' '),
    "style-src 'self'",
    // The three card inputs are cross-origin iframes served by the gateway
    `frame-src ${sdkOrigin}`.trim(),
    `connect-src 'self' ${sdkOrigin}`.trim(),
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function withSecurityHeaders(response: NextResponse, nonce?: string): NextResponse {
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  // Each page belongs to one payment, and /result carries signed parameters in its URL
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/* The two pages. Static assets under /_next and public/ are left alone: they carry no order data
   and the policy is what protects the documents that load them. */
export const config = { matcher: ['/', '/result'] };
