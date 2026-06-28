export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { normalizeKeyword } from '@/lib/search-intelligence';

const KW_FIELDS = [
  'keyword', 'serviceLine', 'marketOrientation', 'keywordIntent', 'funnelStage',
  'priority', 'source', 'matchTypeHint', 'preferredLandingPageUrl', 'status',
] as const;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const keywords = await prisma.searchIntelligenceKeyword.findMany({
    where: { businessId: r.business.id },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ keywords });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;
  const body = await req.json().catch(() => ({}));

  // Bulk import: { keywords: ["a", "b"] } or [{keyword, ...}]
  const items: any[] = Array.isArray(body.keywords)
    ? body.keywords
    : body.keyword
      ? [body]
      : [];
  if (items.length === 0) return NextResponse.json({ error: 'No keywords provided' }, { status: 400 });

  const created: any[] = [];
  for (const item of items) {
    const kwText = typeof item === 'string' ? item : item.keyword;
    if (!kwText || !kwText.trim()) continue;
    const normalized = normalizeKeyword(kwText);
    const exists = await prisma.searchIntelligenceKeyword.findFirst({
      where: { businessId, normalizedKeyword: normalized },
      select: { id: true },
    });
    if (exists) continue;
    const data: Record<string, any> = { businessId, keyword: kwText.trim(), normalizedKeyword: normalized };
    if (typeof item === 'object') for (const f of KW_FIELDS) if (item[f] !== undefined) data[f] = item[f];
    if (!data.source) data.source = 'manual';
    const row = await prisma.searchIntelligenceKeyword.create({ data: data as any });
    created.push(row);
  }
  return NextResponse.json({ ok: true, created: created.length, keywords: created });
}
