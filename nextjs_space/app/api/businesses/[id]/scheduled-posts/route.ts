export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/scheduled-posts
 * Returns all scheduled posts for a business, with optional status filter.
 * Query params: ?status=needs_approval&limit=50&offset=0
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const where: any = { businessId };
    if (status) {
      where.status = status;
    }

    const [posts, total] = await Promise.all([
      prisma.scheduledPost.findMany({
        where,
        orderBy: { scheduledFor: 'asc' },
        take: limit,
        skip: offset,
        include: {
          approvedBy: { select: { id: true, email: true } },
        },
      }),
      prisma.scheduledPost.count({ where }),
    ]);

    return NextResponse.json({ posts, total, limit, offset });
  } catch (err: any) {
    console.error('[scheduled-posts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
