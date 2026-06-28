export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { queueSearchIntelligenceRun } from '@/lib/search-intelligence';

/**
 * POST /api/businesses/[id]/search-intelligence/run
 * Manually queue an ongoing Search Intelligence run. Requires the business to
 * be registered (it has an owner via resolveBusinessAccess). Fails gracefully
 * when the configured provider key is missing (run completes as partial).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const body = await req.json().catch(() => ({}));
  const { runId } = await queueSearchIntelligenceRun(businessId, {
    runType: body.runType || 'weekly_search_intelligence',
  });
  const run = await prisma.searchIntelligenceRun.findUnique({ where: { id: runId } });
  return NextResponse.json({ ok: true, run });
}
