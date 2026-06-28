export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

const LOC_FIELDS = [
  'locationType', 'zip', 'city', 'county', 'state', 'country', 'latitude',
  'longitude', 'radiusMiles', 'serviceAreaPriority', 'marketLabel', 'status',
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; lid: string } },
) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const existing = await prisma.searchIntelligenceLocation.findFirst({
    where: { id: params.lid, businessId: r.business.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Location not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  for (const f of LOC_FIELDS) if (body[f] !== undefined) data[f] = body[f];
  const location = await prisma.searchIntelligenceLocation.update({ where: { id: params.lid }, data: data as any });
  return NextResponse.json({ ok: true, location });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; lid: string } },
) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const existing = await prisma.searchIntelligenceLocation.findFirst({
    where: { id: params.lid, businessId: r.business.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Location not found' }, { status: 404 });
  await prisma.searchIntelligenceLocation.update({ where: { id: params.lid }, data: { status: 'disabled' } as any });
  return NextResponse.json({ ok: true });
}
