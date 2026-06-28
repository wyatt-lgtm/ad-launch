export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';

const LOC_FIELDS = [
  'locationType', 'zip', 'city', 'county', 'state', 'country', 'latitude',
  'longitude', 'radiusMiles', 'serviceAreaPriority', 'marketLabel', 'status',
] as const;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const locations = await prisma.searchIntelligenceLocation.findMany({
    where: { businessId: r.business.id },
    orderBy: [{ serviceAreaPriority: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ locations });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = { businessId: r.business.id };
  for (const f of LOC_FIELDS) if (body[f] !== undefined) data[f] = body[f];
  if (!data.city && !data.zip && !data.county && !data.state && data.locationType !== 'national') {
    return NextResponse.json({ error: 'Provide a city, ZIP, county, or state' }, { status: 400 });
  }
  const location = await prisma.searchIntelligenceLocation.create({ data: data as any });
  return NextResponse.json({ ok: true, location });
}
