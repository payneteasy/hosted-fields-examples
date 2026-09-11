import { NextResponse } from 'next/server';
import { BASE_PATH, serverConfig } from '@/shared/config';
import { SIGNED_CALLBACK_FIELDS, validCallback } from '@/shared/lib/callback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST.
 *
 * A page cannot be delivered by POST — doubly so in the App Router, where a page.tsx and a
 * route.ts cannot even share a path — so the signature is checked here and the payer is sent
 * on to the page with the same signed parameters in the query. The browser carries them, but
 * it cannot forge them: it does not know MERCHANT_CONTROL, and the page checks them again.
 */
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return new NextResponse('malformed callback', { status: 400 });
  }

  if (!(await validCallback(form, serverConfig().merchantControl))) {
    console.error(`[error] callback signature mismatch for order ${form.get('orderid')}`);
    return new NextResponse('invalid callback signature', { status: 403 });
  }

  return redirectToResult(form);
}

/** A GET here is nobody arriving from a payment; send them to the empty page. */
export function GET() {
  return redirectToResult(new URLSearchParams());
}

function redirectToResult(form: URLSearchParams) {
  const signed = new URLSearchParams();
  for (const name of SIGNED_CALLBACK_FIELDS) {
    const value = form.get(name);
    if (value) {
      signed.set(name, value);
    }
  }

  const query = signed.toString();
  // Built from PUBLIC_URL, like redirect_url itself: behind a proxy the request URL is the
  // internal one, and the payer would be sent to a host they cannot reach.
  const target = new URL(
    `${serverConfig().publicUrl}${BASE_PATH}/result${query ? `?${query}` : ''}`,
  );
  // 303, so the browser follows with a GET whatever it arrived with
  return NextResponse.redirect(target, 303);
}
