export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validateEventInput, logPixelAudit } from '@/lib/tracking-pixels';

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

/** PATCH /api/businesses/[id]/tracking-events/[eventId] */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; eventId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;

  const existing = await prisma.trackingEvent.findFirst({ where: { id: params.eventId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body.eventName !== undefined) {
    const check = validateEventInput({ ...existing, ...body });
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
  }
  if (body.pixelId) {
    const owned = await prisma.trackingPixel.findFirst({ where: { id: body.pixelId, businessId: business.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: 'Invalid pixel reference' }, { status: 400 });
  }

  const updated = await prisma.trackingEvent.update({ where: { id: existing.id }, data: pickFields(body) });
  await logPixelAudit({ businessId: business.id, eventId: existing.id, action: 'updated', details: { fields: Object.keys(pickFields(body)) }, userId: user.id });
  return NextResponse.json({ ok: true, event: updated });
}

/** DELETE /api/businesses/[id]/tracking-events/[eventId] */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; eventId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const existing = await prisma.trackingEvent.findFirst({ where: { id: params.eventId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  await prisma.trackingEvent.delete({ where: { id: existing.id } });
  await logPixelAudit({ businessId: business.id, eventId: existing.id, action: 'disabled', details: { deleted: true }, userId: user.id });
  return NextResponse.json({ ok: true, deleted: true });
}
