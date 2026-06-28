export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { normalizeKeyword } from '@/lib/search-intelligence';

const KW_FIELDS = [
  'keyword', 'serviceLine', 'marketOrientation', 'keywordIntent', 'funnelStage',
  'priority', 'source', 'matchTypeHint', 'preferredLandingPageUrl', 'status',
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; kid: string } },
) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const existing = await prisma.searchIntelligenceKeyword.findFirst({
    where: { id: params.kid, businessId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, any> = {};
  for (const f of KW_FIELDS) if (body[f] !== undefined) data[f] = body[f];
  if (data.keyword) data.normalizedKeyword = normalizeKeyword(data.keyword);
  const keyword = await prisma.searchIntelligenceKeyword.update({ where: { id: params.kid }, data: data as any });
  return NextResponse.json({ ok: true, keyword });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; kid: string } },
) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const existing = await prisma.searchIntelligenceKeyword.findFirst({
    where: { id: params.kid, businessId: r.business.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
  await prisma.searchIntelligenceKeyword.update({ where: { id: params.kid }, data: { status: 'disabled' } as any });
  return NextResponse.json({ ok: true });
}
