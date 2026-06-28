/**
 * Search Intelligence (Tier 3) data helpers — business-scoped.
 *
 * Provides default settings, keyword normalization, run execution (using the
 * provider abstraction), observation normalization into history tables, and
 * competitor-movement detection. All reads/writes are scoped by businessId by
 * the calling API routes; helpers here always require an explicit businessId.
 */

import { prisma } from '@/lib/db';
import {
  getSearchIntelligenceProvider,
  resolveProviderType,
  type NormalizedObservation,
  type ProviderRequestOptions,
} from '@/lib/search-intelligence-provider';

export function normalizeKeyword(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

export function organicRankBucket(position: number | null | undefined): string {
  if (position == null) return 'not_found';
  if (position <= 1) return 'top_1';
  if (position <= 3) return 'top_3';
  if (position <= 10) return 'top_10';
  if (position <= 20) return 'page_2';
  return 'not_found';
}

/** Ensure a settings row exists for the business (lazy default, disabled). */
export async function ensureSearchIntelSettings(businessId: string) {
  const existing = await prisma.searchIntelligenceSettings.findUnique({ where: { businessId } });
  if (existing) return existing;
  return prisma.searchIntelligenceSettings.create({ data: { businessId } });
}

/**
 * Seed initial priority keywords / service lines / locations from Deep Research
 * output. Idempotent: skips keywords/locations that already exist. Never runs
 * during the preview flow — only callable after deep research seeds exist.
 */
export async function seedFromDeepResearch(
  businessId: string,
  seed: {
    keywords?: Array<{ keyword: string; serviceLine?: string; marketOrientation?: string; intent?: string; priority?: string }>;
    locations?: Array<{ city?: string; county?: string; state?: string; zip?: string; locationType?: string }>;
    competitors?: Array<{ name?: string; domain?: string }>;
  },
): Promise<{ keywords: number; locations: number; competitors: number }> {
  let kw = 0;
  let loc = 0;
  let comp = 0;

  for (const k of seed.keywords ?? []) {
    const normalized = normalizeKeyword(k.keyword);
    if (!normalized) continue;
    const exists = await prisma.searchIntelligenceKeyword.findFirst({
      where: { businessId, normalizedKeyword: normalized },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.searchIntelligenceKeyword.create({
      data: {
        businessId,
        keyword: k.keyword,
        normalizedKeyword: normalized,
        serviceLine: k.serviceLine ?? null,
        marketOrientation: k.marketOrientation ?? 'unknown',
        keywordIntent: k.intent ?? null,
        priority: k.priority ?? 'medium',
        source: 'deep_research',
      } as any,
    });
    kw++;
  }

  for (const l of seed.locations ?? []) {
    const exists = await prisma.searchIntelligenceLocation.findFirst({
      where: {
        businessId,
        city: l.city ?? null,
        county: l.county ?? null,
        zip: l.zip ?? null,
      },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.searchIntelligenceLocation.create({
      data: {
        businessId,
        locationType: l.locationType ?? (l.zip ? 'zip' : l.county ? 'county' : 'city'),
        zip: l.zip ?? null,
        city: l.city ?? null,
        county: l.county ?? null,
        state: l.state ?? null,
      } as any,
    });
    loc++;
  }

  for (const c of seed.competitors ?? []) {
    if (!c.domain && !c.name) continue;
    const exists = await prisma.searchCompetitor.findFirst({
      where: { businessId, domain: c.domain ?? undefined },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.searchCompetitor.create({
      data: {
        businessId,
        competitorName: c.name ?? null,
        domain: c.domain ?? null,
        source: 'deep_research',
      } as any,
    });
    comp++;
  }

  return { keywords: kw, locations: loc, competitors: comp };
}

/**
 * Queue a Search Intelligence run. We create the run row in `queued` status and
 * (best-effort, synchronously) execute it against the configured provider. If
 * the provider is unconfigured (e.g. missing Ahrefs key) the run completes as
 * `partial` with zero observations rather than failing the request.
 */
export async function queueSearchIntelligenceRun(
  businessId: string,
  opts: { runType?: string; createdByTaskId?: string | null } = {},
): Promise<{ runId: string }> {
  const settings = await ensureSearchIntelSettings(businessId);
  const run = await prisma.searchIntelligenceRun.create({
    data: {
      businessId,
      runType: opts.runType ?? 'weekly_search_intelligence',
      dataSource: settings.defaultProvider,
      status: 'queued',
      createdByTaskId: opts.createdByTaskId ?? null,
    } as any,
  });
  // Fire-and-forget execution; errors are captured onto the run row.
  void executeSearchIntelligenceRun(businessId, run.id).catch((err) => {
    console.warn('[search-intelligence] run execution failed', run.id, err);
  });
  return { runId: run.id };
}

export async function executeSearchIntelligenceRun(businessId: string, runId: string): Promise<void> {
  const settings = await ensureSearchIntelSettings(businessId);
  const run = await prisma.searchIntelligenceRun.findFirst({ where: { id: runId, businessId } });
  if (!run) return;

  await prisma.searchIntelligenceRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date() } as any,
  });

  try {
    const [keywords, locations, competitors] = await Promise.all([
      prisma.searchIntelligenceKeyword.findMany({
        where: { businessId, status: 'active' },
        take: settings.maxKeywordsPerRun,
      }),
      prisma.searchIntelligenceLocation.findMany({
        where: { businessId, status: 'active' },
        take: settings.maxLocationsPerRun,
      }),
      prisma.searchCompetitor.findMany({ where: { businessId, status: 'active' } }),
    ]);

    const providerType = resolveProviderType(settings.defaultProvider);
    const provider = getSearchIntelligenceProvider(providerType);
    const health = await provider.fetchProviderHealth();

    const options: ProviderRequestOptions = {
      device: (settings.device as any) ?? 'desktop',
      includePaid: settings.includePaidAds,
      includeOrganic: settings.includeOrganic,
      includeLocalPack: settings.includeLocalPack,
    };

    const keywordStrings = keywords.map((k) => k.keyword);
    const locationStrings = locations.map(
      (l) => l.marketLabel || [l.city, l.state].filter(Boolean).join(', ') || l.zip || 'national',
    );
    const competitorDomains = competitors.map((c) => c.domain || c.competitorName || '').filter(Boolean);

    const result = await provider.fetchKeywordRankings(
      businessId,
      keywordStrings,
      locationStrings,
      options,
    );

    let observationCount = 0;
    if (result.observations.length > 0) {
      observationCount = await persistObservations(businessId, runId, result.observations, {
        keywords,
        locations,
        dataSource: `${providerType}:fetchKeywordRankings`,
      });
    }

    await prisma.searchIntelligenceRun.update({
      where: { id: runId },
      data: {
        status: health.configured && observationCount > 0 ? 'complete' : 'partial',
        completedAt: new Date(),
        keywordCount: keywords.length,
        locationCount: locations.length,
        competitorCount: competitors.length,
        observationCount,
        rawSnapshotRef: result.rawSnapshotRef ?? null,
        errorMessage: health.configured
          ? null
          : `Provider ${providerType} not configured — ${health.message}`,
      } as any,
    });
  } catch (err: any) {
    await prisma.searchIntelligenceRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: String(err?.message || err).slice(0, 1000),
      } as any,
    });
  }
}

async function persistObservations(
  businessId: string,
  runId: string,
  observations: NormalizedObservation[],
  ctx: {
    keywords: Array<{ id: string; keyword: string; normalizedKeyword: string }>;
    locations: Array<{ id: string; marketLabel: string | null; city: string | null; zip: string | null }>;
    dataSource: string;
  },
): Promise<number> {
  const kwByNorm = new Map(ctx.keywords.map((k) => [k.normalizedKeyword, k.id]));
  let count = 0;
  for (const obs of observations) {
    const keywordId = obs.keyword ? kwByNorm.get(normalizeKeyword(obs.keyword)) ?? null : null;
    await prisma.searchVisibilityObservation.create({
      data: {
        businessId,
        runId,
        keywordId,
        searchEngine: obs.searchEngine ?? 'google',
        device: obs.device ?? 'desktop',
        resultType: obs.resultType ?? 'organic',
        position: obs.position ?? null,
        pageNumber: obs.pageNumber ?? null,
        domain: obs.domain ?? null,
        url: obs.url ?? null,
        title: obs.title ?? null,
        snippet: obs.snippet ?? null,
        isSelf: obs.isSelf ?? false,
        confidenceScore: obs.confidenceScore ?? 0,
        dataSource: obs.dataSource ?? ctx.dataSource,
      } as any,
    });
    count++;
  }
  return count;
}

export async function nextWeeklyRun(businessId: string): Promise<Date | null> {
  const settings = await prisma.searchIntelligenceSettings.findUnique({ where: { businessId } });
  if (!settings || !settings.enabled) return null;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDow = Math.max(0, days.indexOf((settings.weeklyRunDay || 'monday').toLowerCase()));
  const [hh, mm] = (settings.weeklyRunTime || '09:00').split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const next = new Date(now);
  next.setHours(isNaN(hh) ? 9 : hh, isNaN(mm) ? 0 : mm, 0, 0);
  let delta = (targetDow - now.getDay() + 7) % 7;
  if (delta === 0 && next <= now) delta = 7;
  next.setDate(now.getDate() + delta);
  return next;
}
