export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

/** GET /api/businesses/[id]/tracking-audit — recent activity / verification log */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50, 200);
  const events = await prisma.trackingPixelAuditEvent.findMany({
    where: { businessId: r.business.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({ events });
}
