export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { expireCreditsForBusiness } from '@/lib/credits';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const body = await req.json();
    const { businessId } = body;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const result = await expireCreditsForBusiness(businessId);
    return NextResponse.json({
      success: true,
      expiredLots: result.expiredLots,
      expiredCredits: result.expiredCredits,
    });
  } catch (err: any) {
    console.error('[admin/credits/expire-now] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to expire credits' }, { status: 500 });
  }
}
