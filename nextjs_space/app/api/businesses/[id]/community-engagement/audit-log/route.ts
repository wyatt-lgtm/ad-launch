// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/community-engagement/audit-log
 * Returns all reviewed opportunities as audit trail.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({ where: { id: businessId, userId }, select: { id: true } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);

    const entries = await prisma.communityEngagementOpportunity.findMany({
      where: {
        businessId,
        reviewedAt: { not: null },
      },
      select: {
        id: true,
        platform: true,
        communityName: true,
        threadTitle: true,
        threadUrl: true,
        topic: true,
        opportunityScore: true,
        status: true,
        reviewDecision: true,
        reviewNotes: true,
        reviewedAt: true,
        manuallyPostedUrl: true,
        postedAt: true,
        referralClicks: true,
        draftStatus: true,
        reviewer: { select: { email: true } },
        createdAt: true,
      },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ entries, total: entries.length });
  } catch (err: any) {
    console.error('[community-engagement/audit-log] GET error:', err);
    return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 });
  }
}
