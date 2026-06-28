export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { nextWeeklyRun } from '@/lib/search-intelligence';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const [keywordCount, locationCount, lastRun, settings, latestOrganic, movements] = await Promise.all([
    prisma.searchIntelligenceKeyword.count({ where: { businessId, status: 'active' } }),
    prisma.searchIntelligenceLocation.count({ where: { businessId, status: 'active' } }),
    prisma.searchIntelligenceRun.findFirst({ where: { businessId }, orderBy: { createdAt: 'desc' } }),
    prisma.searchIntelligenceSettings.findUnique({ where: { businessId } }),
    prisma.organicPositionHistory.findMany({
      where: { businessId },
      orderBy: { observedAt: 'desc' },
      take: 200,
      include: { keyword: { select: { keyword: true } } },
    }),
    prisma.competitorSearchMovement.findMany({
      where: { businessId, movementType: { not: 'no_change' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { competitor: { select: { competitorName: true, domain: true } } },
    }),
  ]);

  // Aggregate latest position per keyword for gain/loss summary.
  const seen = new Set<string>();
  const latestPerKeyword: typeof latestOrganic = [];
  for (const row of latestOrganic) {
    const key = row.keywordId || row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    latestPerKeyword.push(row);
  }
  const visibilityScore =
    latestPerKeyword.length > 0
      ? Math.round(
          (latestPerKeyword.reduce((s, x) => s + (x.visibilityScore ?? 0), 0) /
            latestPerKeyword.length) * 100,
        ) / 100
      : 0;

  const next = await nextWeeklyRun(businessId);

  return NextResponse.json({
    visibilityScore,
    trackedKeywordCount: keywordCount,
    trackedLocationCount: locationCount,
    competitorMovementAlerts: movements,
    lastRunAt: lastRun?.completedAt ?? lastRun?.createdAt ?? null,
    lastRunStatus: lastRun?.status ?? null,
    nextRunAt: next,
    enabled: settings?.enabled ?? false,
  });
}
