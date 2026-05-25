export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { adjustCredits } from '@/lib/credits';

/**
 * POST /api/admin/credits/adjust
 * Body: { businessId, amount (can be negative), reason }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json().catch(() => ({} as any));
  const { businessId, amount, reason } = body;

  if (!businessId || typeof amount !== 'number' || amount === 0) {
    return NextResponse.json({ error: 'businessId and non-zero amount required' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'reason is required for adjustments' }, { status: 400 });
  }

  const result = await adjustCredits(businessId, amount, reason, { userId: auth.userId });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
