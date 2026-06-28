export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

const STRING_FIELDS = ['name', 'shortDescription', 'fullDescriptionTemplate', 'customerProblem', 'recommendedPageTitle', 'recommendedMetaDescription', 'recommendedH1', 'recommendedSchemaType', 'explainerVideoTitle', 'explainerVideoBrief', 'explainerVideoScriptTemplate'];
const ARRAY_FIELDS = ['commonQuestions', 'commonObjections', 'relatedServices', 'matchKeywords'];

/**
 * PATCH /api/admin/industries/[industryId]/services/[serviceId]
 */
export async function PATCH(req: NextRequest, { params }: { params: { industryId: string; serviceId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json();
  const data: any = {};
  for (const f of STRING_FIELDS) if (typeof body[f] === 'string') data[f] = body[f];
  for (const f of ARRAY_FIELDS) if (Array.isArray(body[f])) data[f] = body[f];
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.conditional === 'boolean') data.conditional = body.conditional;
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const service = await prisma.industryService.update({
    where: { id: params.serviceId },
    data,
  });
  return NextResponse.json({ ok: true, service });
}

/**
 * DELETE /api/admin/industries/[industryId]/services/[serviceId]
 * Soft-disable to protect business offerings; pass ?hard=true to delete when unreferenced.
 */
export async function DELETE(req: NextRequest, { params }: { params: { industryId: string; serviceId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const hard = new URL(req.url).searchParams.get('hard') === 'true';
  if (hard) {
    const refs = await prisma.businessServiceOffering.count({ where: { industryServiceId: params.serviceId } });
    if (refs > 0) {
      return NextResponse.json({ error: `Cannot hard-delete: ${refs} business offerings reference this service. Disable it instead.` }, { status: 409 });
    }
    await prisma.industryService.delete({ where: { id: params.serviceId } });
    return NextResponse.json({ ok: true, deleted: true });
  }
  await prisma.industryService.update({ where: { id: params.serviceId }, data: { enabled: false } });
  return NextResponse.json({ ok: true, disabled: true });
}
