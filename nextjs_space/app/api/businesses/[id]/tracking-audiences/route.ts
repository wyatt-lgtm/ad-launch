export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { validateAudienceInput, logPixelAudit } from '@/lib/tracking-pixels';
import { AUDIENCE_TEMPLATES } from '@/lib/tracking-defaults';

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

/** GET /api/businesses/[id]/tracking-audiences */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const audiences = await prisma.trackingAudience.findMany({
    where: { businessId: r.business.id, status: { not: 'archived' } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ audiences, templates: AUDIENCE_TEMPLATES });
}

/** POST /api/businesses/[id]/tracking-audiences */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { user, business } = r;
  const body = await req.json().catch(() => ({}));

  if (body.templateKey) {
    const tpl = AUDIENCE_TEMPLATES.find((t) => t.key === body.templateKey);
    if (!tpl) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
    const aud = await prisma.trackingAudience.create({
      data: {
        businessId: business.id,
        audienceName: tpl.audienceName,
        platform: body.platform || 'custom',
        audienceType: tpl.audienceType,
        sourceEvent: tpl.sourceEvent,
        includeRulesJson: tpl.includeRules ?? undefined,
        excludeRulesJson: tpl.excludeRules ?? undefined,
        retentionDays: tpl.retentionDays,
        funnelStage: tpl.funnelStage,
      },
    });
    await logPixelAudit({ businessId: business.id, action: 'created', details: { audienceTemplate: tpl.key, audienceId: aud.id }, userId: user.id });
    return NextResponse.json({ ok: true, audience: aud });
  }

  const check = validateAudienceInput(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
  const aud = await prisma.trackingAudience.create({ data: { businessId: business.id, ...pickFields(body) } as any });
  await logPixelAudit({ businessId: business.id, action: 'created', details: { audienceId: aud.id, audienceName: aud.audienceName }, userId: user.id });
  return NextResponse.json({ ok: true, audience: aud });
}
