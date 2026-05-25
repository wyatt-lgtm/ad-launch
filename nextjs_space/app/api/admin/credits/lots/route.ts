export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { getCreditLots } from '@/lib/credits';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  }

  const includeEmpty = req.nextUrl.searchParams.get('includeEmpty') === 'true';

  try {
    const lots = await getCreditLots(businessId, { includeEmpty });
    return NextResponse.json({ lots });
  } catch (err: any) {
    console.error('[admin/credits/lots] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch credit lots' }, { status: 500 });
  }
}
