export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any)?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const businesses = await prisma.business.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        analyses: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            ads: { select: { id: true } },
            socialPosts: { select: { id: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            analyses: true,
          },
        },
      },
    });

    return NextResponse.json({ businesses });
  } catch (err: any) {
    console.error('User businesses error:', err);
    return NextResponse.json({ error: 'Failed to load businesses' }, { status: 500 });
  }
}
