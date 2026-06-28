export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const recommendations = await prisma.searchIntelligenceRecommendation.findMany({
    where: { businessId: r.business.id },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  return NextResponse.json({ recommendations });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'Missing recommendation id' }, { status: 400 });
  const existing = await prisma.searchIntelligenceRecommendation.findFirst({
    where: { id: body.id, businessId: r.business.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
  const recommendation = await prisma.searchIntelligenceRecommendation.update({
    where: { id: body.id },
    data: { status: body.status ?? undefined } as any,
  });
  return NextResponse.json({ ok: true, recommendation });
}
