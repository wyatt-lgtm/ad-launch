export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createCheckoutSession } from '@/lib/billing';

/**
 * POST /api/billing/create-checkout-session
 * Body: { businessId, trialDays? }
 * Returns: { url: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, email: true },
    });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const { businessId, trialDays } = body;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Verify user owns this business
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId: user.id },
      select: { id: true, businessName: true },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3000';

    const url = await createCheckoutSession({
      businessId,
      userId: user.id,
      email: user.email,
      businessName: business.businessName,
      origin,
      trialDays: trialDays ?? undefined,
    });

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[billing] create-checkout-session error:', err.message);
    if (err.message?.includes('not configured')) {
      return NextResponse.json({ error: 'Billing is not configured yet' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
