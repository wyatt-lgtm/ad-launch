export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const [history, observations] = await Promise.all([
    prisma.organicPositionHistory.findMany({
      where: { businessId: r.business.id },
      orderBy: { observedAt: 'desc' },
      take: 500,
      include: { keyword: { select: { keyword: true, serviceLine: true } }, location: { select: { marketLabel: true, city: true, state: true } } },
    }),
    prisma.searchVisibilityObservation.findMany({
      where: { businessId: r.business.id, resultType: 'organic' },
      orderBy: { observedAt: 'desc' },
      take: 200,
      include: { keyword: { select: { keyword: true } } },
    }),
  ]);
  return NextResponse.json({ history, observations });
}
