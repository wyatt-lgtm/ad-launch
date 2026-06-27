export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getAllowedAssetsForBusiness, type UseChannel } from '@/lib/shared-assets';

/**
 * GET /api/shared-assets/allowed?businessId=xxx&intendedUse=website
 * Returns all shared assets a business is allowed to use.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');
    const intendedUse = searchParams.get('intendedUse') as UseChannel | null;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const assets = await getAllowedAssetsForBusiness(
      businessId,
      intendedUse || undefined,
    );

    return NextResponse.json({ assets, count: assets.length });
  } catch (err) {
    console.error('[AllowedAssets GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
