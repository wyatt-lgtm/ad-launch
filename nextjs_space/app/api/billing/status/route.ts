export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/billing/status?businessId=...
 *
 * Returns billing & subscription status for a business.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
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

  const account = await prisma.creditAccount.findUnique({ where: { businessId } });

  if (!account) {
    return NextResponse.json({
      hasSubscription: false,
      creditBalance: 0,
      monthlyAllowance: 6,
      planName: 'beta',
      creditStatus: 'no_account',
      subscription: null,
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    });
  }

  return NextResponse.json({
    hasSubscription: !!account.stripeSubscriptionId,
    creditBalance: account.creditBalance,
    monthlyAllowance: account.monthlyCreditAllowance,
    planName: account.creditPlanName || 'beta',
    creditStatus: account.creditStatus,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    subscription: account.stripeSubscriptionId ? {
      status: account.stripeSubscriptionStatus,
      priceId: account.stripePriceId,
      trialEndsAt: account.trialEndsAt?.toISOString() || null,
      currentPeriodStart: account.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: account.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      lastPaymentStatus: account.lastPaymentStatus,
    } : null,
  });
}
