export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { isOneOf, PAGE_TYPES, logPixelAudit } from '@/lib/tracking-pixels';
import { ROUTE_TEMPLATES } from '@/lib/tracking-defaults';

const ROUTE_FIELDS = [
  'pageType', 'pageUrlPattern', 'eventName', 'platformsJson', 'firesOn',
  'requiresConsent', 'status',
] as const;

function pickFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of ROUTE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

/** GET /api/businesses/[id]/tracking-routes */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const routes = await prisma.trackingEventRoute.findMany({
    where: { businessId: r.business.id, status: { not: 'archived' } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ routes, templates: ROUTE_TEMPLATES });
}

/** POST /api/businesses/[id]/tracking-routes */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const body = await req.json().catch(() => ({}));

  if (body.templateKey) {
    const tpl = ROUTE_TEMPLATES.find((t) => t.key === body.templateKey);
    if (!tpl) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
    const route = await prisma.trackingEventRoute.create({
      data: {
        businessId: business.id,
        pageType: tpl.pageType,
        eventName: tpl.eventName,
        firesOn: tpl.firesOn,
        platformsJson: tpl.platforms as any,
      },
    });
    await logPixelAudit({ businessId: business.id, action: 'created', details: { routeTemplate: tpl.key, routeId: route.id }, userId: user.id });
    return NextResponse.json({ ok: true, route });
  }

  if (!isOneOf(body.pageType, PAGE_TYPES)) return NextResponse.json({ error: 'Invalid page type' }, { status: 400 });
  if (!body.eventName || typeof body.eventName !== 'string') return NextResponse.json({ error: 'Event name required' }, { status: 400 });

  const route = await prisma.trackingEventRoute.create({ data: { businessId: business.id, ...pickFields(body) } as any });
  await logPixelAudit({ businessId: business.id, action: 'created', details: { routeId: route.id, pageType: route.pageType }, userId: user.id });
  return NextResponse.json({ ok: true, route });
}
