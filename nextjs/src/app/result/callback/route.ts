import { NextResponse } from 'next/server';
import { BASE_PATH, serverConfig } from '@/shared/config';
import { validCallback } from '@/shared/lib/callback';
import {
  encodeReturnOrder,
  RETURN_COOKIE,
  RETURN_COOKIE_MAX_AGE,
} from '@/shared/lib/return-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 5. Where the gateway returns the payer after a 3DS challenge.
 *
 * It is a POST, and an App Router page cannot serve one — so `redirect_url` points here
 * instead of at the page. The parameters are signed, so the order is taken from them, the
 * browser is never asked to carry it across the redirect, and the page one redirect later
 * reads it out of an httpOnly cookie.
 */
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return new NextResponse('malformed callback', { status: 400 });
  }

  if (!validCallback(form)) {
    console.error(`[error] callback signature mismatch for order ${form.get('orderid')}`);
    return new NextResponse('invalid callback signature', { status: 403 });
  }

  // The callback carries the outcome too, but the documentation says not to treat it as the
  // status — the order is looked up over the API instead.
  const response = redirectToResult();
  response.cookies.set({
    name: RETURN_COOKIE,
    value: encodeReturnOrder({
      orderId: form.get('orderid') ?? '',
      clientOrderId: form.get('merchant_order') ?? '',
    }),
    httpOnly: true,
    // The gateway's POST is cross-site, but the redirect that follows is an ordinary
    // top-level navigation to our own origin, which Lax allows.
    sameSite: 'lax',
    secure: resultUrl().protocol === 'https:',
    path: `${BASE_PATH}/result`,
    maxAge: RETURN_COOKIE_MAX_AGE,
  });
  return response;
}

/** Nothing to verify and nothing to remember: the page will say there is nothing to show. */
export function GET() {
  return redirectToResult();
}

function redirectToResult() {
  // 303 so the browser follows with a GET, whatever it arrived with
  return NextResponse.redirect(resultUrl(), 303);
}

/** Built from PUBLIC_URL, like redirect_url itself: behind a proxy the request URL is the
 *  internal one, and the payer would be sent to a host they cannot reach. */
function resultUrl() {
  return new URL(`${serverConfig().publicUrl}${BASE_PATH}/result`);
}
