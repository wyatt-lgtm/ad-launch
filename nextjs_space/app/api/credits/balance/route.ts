export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getCreditBalance, CREDIT_COSTS, RECHARGE_PACKS } from '@/lib/credits';

/**
 * GET /api/credits/balance?businessId=...
 *
 * Returns credit balance for the authenticated user's business.
 * businessId is required. User must own the business.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }

  // Verify ownership
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId: user.id },
    select: { id: true },
  });
  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const balance = await getCreditBalance(businessId);

  return NextResponse.json({
    ...balance,
    costs: {
      imagePost: CREDIT_COSTS.IMAGE_POST,
      videoUpgrade: CREDIT_COSTS.VIDEO_UPGRADE,
    },
    rechargePacks: RECHARGE_PACKS,
    expirationPolicy: {
      grantExpiryDays: 60,
      closureExpiryDays: 30,
      expiringSoonDays: 14,
    },
  });
}
