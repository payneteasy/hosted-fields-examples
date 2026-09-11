import { type NextRequest, NextResponse } from 'next/server';
import { getStatus } from '@/shared/lib/paynet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 4. The page polls this until the order reaches a final status.
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId');
  const clientOrderId = request.nextUrl.searchParams.get('clientOrderId');

  if (!orderId || !clientOrderId) {
    return NextResponse.json({ error: 'orderId and clientOrderId are required' }, { status: 400 });
  }

  try {
    const status = await getStatus({ orderId, clientOrderId });
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
