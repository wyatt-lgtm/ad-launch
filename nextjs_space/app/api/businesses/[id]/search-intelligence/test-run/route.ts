export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { runSingleTestSearch } from '@/lib/search-intelligence';

/**
 * POST /api/businesses/[id]/search-intelligence/test-run
 * Manual single keyword + single location SERP test against the configured
 * provider (default DataForSEO). Persists results flagged with the current
 * sandbox mode and returns normalized organic + paid observations for display.
 * Body: { keyword: string, location: string }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const body = await req.json().catch(() => ({} as any));
  const keyword = String(body?.keyword || '').trim();
  const location = String(body?.location || '').trim();
  if (!keyword) {
    return NextResponse.json({ error: 'keyword is required' }, { status: 400 });
  }

  try {
    const result = await runSingleTestSearch(businessId, { keyword, location });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err).slice(0, 500) },
      { status: 502 },
    );
  }
}
