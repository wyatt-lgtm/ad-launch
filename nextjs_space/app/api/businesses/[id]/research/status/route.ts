export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { nextWeeklyRun } from '@/lib/search-intelligence';
import { canRunDeepResearch } from '@/lib/research-tiers';

/** GET /api/businesses/[id]/research/status — three-tier research status panel. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const [biz, light, deep, settings, lastRun] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { userId: true, tombstoneBusinessId: true },
    }),
    prisma.businessResearch.findFirst({
      where: { businessId, researchDepth: 'light' },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.businessResearch.findFirst({
      where: { businessId, researchDepth: { in: ['deep', 'refresh'] } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.searchIntelligenceSettings.findUnique({ where: { businessId } }),
    prisma.searchIntelligenceRun.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const gate = canRunDeepResearch({
    userId: biz?.userId,
    tombstoneBusinessId: biz?.tombstoneBusinessId,
  });
  const next = await nextWeeklyRun(businessId);

  return NextResponse.json({
    light: {
      status: light?.researchStatus ?? 'not_started',
      lastRunAt: light?.completedAt ?? light?.updatedAt ?? null,
    },
    deep: {
      status: deep?.researchStatus ?? 'not_started',
      lastRunAt: deep?.completedAt ?? deep?.updatedAt ?? null,
      canRun: gate.allowed,
      reason: gate.reason ?? null,
    },
    ongoing: {
      enabled: settings?.enabled ?? false,
      lastRunAt: lastRun?.completedAt ?? lastRun?.createdAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
      nextRunAt: next,
    },
  });
}
