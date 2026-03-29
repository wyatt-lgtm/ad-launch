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
    const analyses = await prisma.analysis.findMany({
      where: { userId },
      include: { ads: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ analyses });
  } catch (err: any) {
    console.error('User analyses error:', err);
    return NextResponse.json({ error: 'Failed to load analyses' }, { status: 500 });
  }
}
