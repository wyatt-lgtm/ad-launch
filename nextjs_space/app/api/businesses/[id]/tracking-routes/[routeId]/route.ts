export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { isOneOf, PAGE_TYPES, logPixelAudit } from '@/lib/tracking-pixels';

const ROUTE_FIELDS = [
  'pageType', 'pageUrlPattern', 'eventName', 'platformsJson', 'firesOn',
  'requiresConsent', 'status',
] as const;

function pickFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of ROUTE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

/** PATCH /api/businesses/[id]/tracking-routes/[routeId] */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; routeId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const existing = await prisma.trackingEventRoute.findFirst({ where: { id: params.routeId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (body.pageType !== undefined && !isOneOf(body.pageType, PAGE_TYPES)) return NextResponse.json({ error: 'Invalid page type' }, { status: 400 });
  const updated = await prisma.trackingEventRoute.update({ where: { id: existing.id }, data: pickFields(body) });
  await logPixelAudit({ businessId: business.id, action: 'updated', details: { routeId: existing.id }, userId: user.id });
  return NextResponse.json({ ok: true, route: updated });
}

/** DELETE /api/businesses/[id]/tracking-routes/[routeId] */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; routeId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const existing = await prisma.trackingEventRoute.findFirst({ where: { id: params.routeId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  await prisma.trackingEventRoute.delete({ where: { id: existing.id } });
  await logPixelAudit({ businessId: business.id, action: 'disabled', details: { routeId: existing.id, deleted: true }, userId: user.id });
  return NextResponse.json({ ok: true, deleted: true });
}
