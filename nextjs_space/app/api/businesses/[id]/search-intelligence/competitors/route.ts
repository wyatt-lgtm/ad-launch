export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const competitors = await prisma.searchCompetitor.findMany({
    where: { businessId: r.business.id },
    orderBy: { lastSeenAt: 'desc' },
    include: { _count: { select: { observations: true, movements: true, paidAds: true } } },
  });
  return NextResponse.json({ competitors });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const body = await req.json().catch(() => ({}));
  if (!body.domain && !body.competitorName) {
    return NextResponse.json({ error: 'Provide a competitor name or domain' }, { status: 400 });
  }
  const competitor = await prisma.searchCompetitor.create({
    data: {
      businessId: r.business.id,
      competitorName: body.competitorName ?? null,
      domain: body.domain ?? null,
      source: 'manual',
    } as any,
  });
  return NextResponse.json({ ok: true, competitor });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'Missing competitor id' }, { status: 400 });
  const existing = await prisma.searchCompetitor.findFirst({
    where: { id: body.id, businessId: r.business.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });
  const data: Record<string, any> = {};
  for (const f of ['status', 'competitorName', 'domain'] as const) if (body[f] !== undefined) data[f] = body[f];
  const competitor = await prisma.searchCompetitor.update({ where: { id: body.id }, data: data as any });
  return NextResponse.json({ ok: true, competitor });
}
