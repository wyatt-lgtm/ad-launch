// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/community-engagement/opportunities
 * Returns paginated opportunity log with filters.
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
    const status = url.searchParams.get('status');
    const platform = url.searchParams.get('platform');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const where: any = { businessId };
    if (status) where.status = status;
    if (platform) where.platform = platform;

    const [opportunities, total] = await Promise.all([
      prisma.communityEngagementOpportunity.findMany({
        where,
        include: { contentMatches: true, reviewer: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.communityEngagementOpportunity.count({ where }),
    ]);

    return NextResponse.json({ opportunities, total, limit, offset });
  } catch (err: any) {
    console.error('[community-engagement/opportunities] GET error:', err);
    return NextResponse.json({ error: 'Failed to load opportunities' }, { status: 500 });
  }
}
