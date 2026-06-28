export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const movements = await prisma.competitorSearchMovement.findMany({
    where: { businessId: r.business.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      competitor: { select: { competitorName: true, domain: true } },
      keyword: { select: { keyword: true } },
      location: { select: { marketLabel: true, city: true, state: true } },
    },
  });
  return NextResponse.json({ movements });
}
