export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isBusinessAssetEligible } from '@/lib/asset-access';

/**
 * GET /api/assets/eligibility?businessId=xxx
 *
 * Quick check: is this business eligible for Creative Assets?
 * Used by the frontend to decide whether to show the tab.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ eligible: false });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ eligible: false });
    }

    // Get user ID
    const { prisma } = await import('@/lib/db');
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ eligible: false });
    }

    const eligible = await isBusinessAssetEligible(businessId, user.id);
    return NextResponse.json({ eligible });
  } catch {
    return NextResponse.json({ eligible: false });
  }
}
