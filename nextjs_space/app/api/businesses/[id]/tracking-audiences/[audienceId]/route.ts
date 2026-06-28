export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validateAudienceInput, logPixelAudit } from '@/lib/tracking-pixels';

const AUDIENCE_FIELDS = [
  'audienceName', 'platform', 'audienceType', 'sourceEvent', 'includeRulesJson',
  'excludeRulesJson', 'retentionDays', 'funnelStage', 'status',
  'externalAudienceId',
] as const;

function pickFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of AUDIENCE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (typeof out.audienceName === 'string') out.audienceName = out.audienceName.trim();
  if (out.funnelStage === '') out.funnelStage = null;
  return out;
}

/** PATCH /api/businesses/[id]/tracking-audiences/[audienceId] */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; audienceId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const existing = await prisma.trackingAudience.findFirst({ where: { id: params.audienceId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Audience not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body.audienceName !== undefined || body.audienceType !== undefined) {
    const check = validateAudienceInput({ ...existing, ...body });
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const updated = await prisma.trackingAudience.update({ where: { id: existing.id }, data: pickFields(body) });
  await logPixelAudit({ businessId: business.id, action: 'updated', details: { audienceId: existing.id }, userId: user.id });
  return NextResponse.json({ ok: true, audience: updated });
}

/** DELETE /api/businesses/[id]/tracking-audiences/[audienceId] */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; audienceId: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const existing = await prisma.trackingAudience.findFirst({ where: { id: params.audienceId, businessId: business.id } });
  if (!existing) return NextResponse.json({ error: 'Audience not found' }, { status: 404 });
  await prisma.trackingAudience.delete({ where: { id: existing.id } });
  await logPixelAudit({ businessId: business.id, action: 'disabled', details: { audienceId: existing.id, deleted: true }, userId: user.id });
  return NextResponse.json({ ok: true, deleted: true });
}
