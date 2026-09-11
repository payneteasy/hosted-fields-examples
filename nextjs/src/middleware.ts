import { type NextRequest, NextResponse } from 'next/server';
import { validCallback } from '@/shared/lib/callback';

/**
 * A hand-edited /result URL gets a 403, the same as in the Go and Express examples.
 *
 * It lives here rather than in result/page.tsx because a React page cannot set a status code —
 * `forbidden()` is still behind experimental.authInterrupts in this version of Next, and an
 * example is not the place to turn an experimental flag on. A middleware runs before the page
 * and can answer with whatever it likes.
 *
 * The edge runtime is why callback.ts uses Web Crypto and takes the secret as an argument:
 * neither node:crypto nor the node:fs behind serverConfig() exists here. MERCHANT_CONTROL is read
 * straight from the environment, and a deployment that has not set it fails every check — which
 * is the right way round for a signature.
 */
export async function middleware(request: NextRequest) {
  const query = request.nextUrl.searchParams;

  // No query at all is fine: the page then says there is nothing to show.
  if (!query.get('orderid')) {
    return NextResponse.next();
  }

  if (await validCallback(query, process.env.MERCHANT_CONTROL ?? '')) {
    return NextResponse.next();
  }

  console.error(`[error] result signature mismatch for order ${query.get('orderid')}`);
  return new NextResponse('invalid result signature', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

// Only the result page. The matcher is relative to basePath, and /result/callback — which does
// its own check, on a POST body this middleware cannot read — is a different path.
export const config = { matcher: '/result' };
