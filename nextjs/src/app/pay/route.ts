import { NextResponse } from 'next/server';
import { pickBrowser } from '@/shared/lib/browser-info';
import { clientIp } from '@/shared/lib/callback';
import type { Customer } from '@/shared/lib/customer';
import { createSale } from '@/shared/lib/paynet';

// node:crypto signs the call, so this must not run on the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PaymentRequest {
  hostedFieldsToken?: string;
  browser?: Record<string, string>;
  customer?: Customer;
}

// Step 3. The browser has exchanged the card for a token; start the payment.
export async function POST(request: Request) {
  let payment: PaymentRequest;
  try {
    payment = (await request.json()) as PaymentRequest;
  } catch {
    return NextResponse.json({ error: 'malformed request body' }, { status: 400 });
  }

  if (!payment.hostedFieldsToken) {
    return NextResponse.json({ error: 'hostedFieldsToken is required' }, { status: 400 });
  }

  const clientOrderId = `hf-${Date.now()}`;

  try {
    const sale = await createSale({
      hostedFieldsToken: payment.hostedFieldsToken,
      clientOrderId,
      ipaddress: clientIp(request.headers),
      browser: pickBrowser(payment.browser, request.headers),
      customer: payment.customer ?? {
        firstName: '',
        lastName: '',
        email: '',
        cardPrintedName: '',
      },
    });

    // clientOrderId last: it is the server's, and a gateway field of the same name must not win
    return NextResponse.json({ ...sale, clientOrderId });
  } catch (error) {
    return fail(error);
  }
}

/** Any gateway failure surfaces to the page as one 502 with a message. */
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  return NextResponse.json({ error: message }, { status: 502 });
}
