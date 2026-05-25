export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { grantCredits } from '@/lib/credits';

/**
 * POST /api/admin/credits/grant
 * Body: { businessId, amount, reason? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json().catch(() => ({} as any));
  const { businessId, amount, reason } = body;

  if (!businessId || typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'businessId and positive amount required' }, { status: 400 });
  }

  const result = await grantCredits(
    businessId,
    amount,
    'admin_grant',
    reason || 'Admin credit grant',
    { userId: auth.userId },
  );

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
