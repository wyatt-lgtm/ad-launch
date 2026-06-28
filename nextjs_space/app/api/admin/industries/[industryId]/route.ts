export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/industries/[industryId]
 * Industry detail with its services.
 */
export async function GET(req: NextRequest, { params }: { params: { industryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const industry = await prisma.industry.findUnique({
    where: { id: params.industryId },
    include: { services: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!industry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ industry });
}

/**
 * PATCH /api/admin/industries/[industryId]
 * Update industry fields.
 */
export async function PATCH(req: NextRequest, { params }: { params: { industryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json();
  const data: any = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === 'string') data.description = body.description;
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;
  if (Array.isArray(body.matchKeywords)) data.matchKeywords = body.matchKeywords;
  if (Array.isArray(body.gbpCategories)) data.gbpCategories = body.gbpCategories;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const industry = await prisma.industry.update({ where: { id: params.industryId }, data });
  return NextResponse.json({ ok: true, industry });
}

/**
 * DELETE /api/admin/industries/[industryId]
 * Soft-disable to protect existing business offerings. Pass ?hard=true to delete
 * only when there are no business offerings referencing it.
 */
export async function DELETE(req: NextRequest, { params }: { params: { industryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const hard = new URL(req.url).searchParams.get('hard') === 'true';
  if (hard) {
    const offeringCount = await prisma.businessServiceOffering.count({ where: { industryId: params.industryId } });
    if (offeringCount > 0) {
      return NextResponse.json({ error: `Cannot hard-delete: ${offeringCount} business offerings reference this industry. Disable it instead.` }, { status: 409 });
    }
    await prisma.industry.delete({ where: { id: params.industryId } });
    return NextResponse.json({ ok: true, deleted: true });
  }
  await prisma.industry.update({ where: { id: params.industryId }, data: { enabled: false } });
  return NextResponse.json({ ok: true, disabled: true });
}
