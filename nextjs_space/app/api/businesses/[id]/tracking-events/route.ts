export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validateEventInput, logPixelAudit } from '@/lib/tracking-pixels';
import { EVENT_TEMPLATES } from '@/lib/tracking-defaults';

const EVENT_FIELDS = [
  'pixelId', 'eventName', 'platformEventName', 'eventType', 'triggerType',
  'pageScope', 'pageMatchRulesJson', 'selectorRule', 'urlRule', 'valueSource',
  'conversionValue', 'currency', 'leadStatusMapping', 'deduplicationEnabled',
  'deduplicationKeyStrategy', 'requiresConsent', 'consentCategory', 'status',
] as const;

function pickFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of EVENT_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (typeof out.eventName === 'string') out.eventName = out.eventName.trim();
  return out;
}

/** GET /api/businesses/[id]/tracking-events */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const events = await prisma.trackingEvent.findMany({
    where: { businessId: r.business.id, status: { not: 'archived' } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ events, templates: EVENT_TEMPLATES });
}

/** POST /api/businesses/[id]/tracking-events */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const body = await req.json().catch(() => ({}));

  // Template instantiation
  if (body.templateKey) {
    const tpl = EVENT_TEMPLATES.find((t) => t.key === body.templateKey);
    if (!tpl) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
    const ev = await prisma.trackingEvent.create({
      data: {
        businessId: business.id,
        pixelId: body.pixelId || null,
        eventName: tpl.eventName,
        platformEventName: tpl.platformEventName,
        eventType: tpl.eventType,
        triggerType: tpl.triggerType,
        pageScope: tpl.pageScope,
        consentCategory: tpl.consentCategory,
        requiresConsent: tpl.requiresConsent,
      },
    });
    await logPixelAudit({ businessId: business.id, eventId: ev.id, pixelId: ev.pixelId, action: 'created', details: { template: tpl.key }, userId: user.id });
    return NextResponse.json({ ok: true, event: ev });
  }

  const check = validateEventInput(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  // If a pixelId is supplied, ensure it belongs to this business.
  if (body.pixelId) {
    const owned = await prisma.trackingPixel.findFirst({ where: { id: body.pixelId, businessId: business.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: 'Invalid pixel reference' }, { status: 400 });
  }

  const ev = await prisma.trackingEvent.create({ data: { businessId: business.id, ...pickFields(body) } as any });
  await logPixelAudit({ businessId: business.id, eventId: ev.id, pixelId: ev.pixelId, action: 'created', details: { eventName: ev.eventName }, userId: user.id });
  return NextResponse.json({ ok: true, event: ev });
}
