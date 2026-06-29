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
  type NormalizedResult,
  type ProviderRequestOptions,
} from '@/lib/search-intelligence-provider';
import {
  getDataForSeoConfig,
  normalizeDomain,
  type ProviderUsageDescriptor,
} from '@/lib/dataforseo-provider';
import { logProviderUsage } from '@/lib/provider-usage';

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

function computeLocationLabel(l: {
  marketLabel?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  return (
    l.marketLabel ||
    [l.city, l.state].filter(Boolean).join(', ') ||
    l.zip ||
    'national'
  );
}

/** Resolve the business self-domain (host only) from its website URL. */
async function getSelfDomain(businessId: string): Promise<string | null> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { websiteUrl: true },
  });
  return biz?.websiteUrl ? normalizeDomain(biz.websiteUrl) || null : null;
}

export async function executeSearchIntelligenceRun(businessId: string, runId: string): Promise<void> {
  const settings = await ensureSearchIntelSettings(businessId);
  const run = await prisma.searchIntelligenceRun.findFirst({ where: { id: runId, businessId } });
  if (!run) return;

  await prisma.searchIntelligenceRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date() } as any,
  });

  const providerType = resolveProviderType(settings.defaultProvider);
  const cfg = getDataForSeoConfig();
  const isSandbox = providerType === 'dataforseo' ? cfg.useSandbox : false;

  try {
    const [keywords, locations, competitors, selfDomain] = await Promise.all([
      prisma.searchIntelligenceKeyword.findMany({
        where: { businessId, status: 'active' },
        take: settings.maxKeywordsPerRun,
      }),
      prisma.searchIntelligenceLocation.findMany({
        where: { businessId, status: 'active' },
        take: settings.maxLocationsPerRun,
      }),
      prisma.searchCompetitor.findMany({ where: { businessId, status: 'active' } }),
      getSelfDomain(businessId),
    ]);

    const provider = getSearchIntelligenceProvider(providerType);
    const health = await provider.fetchProviderHealth();

    const options: ProviderRequestOptions = {
      device: (settings.device as any) ?? 'desktop',
      includePaid: settings.includePaidAds,
      includeOrganic: settings.includeOrganic,
      includeLocalPack: settings.includeLocalPack,
      selfDomain,
    };

    const keywordStrings = keywords.map((k) => k.keyword);
    const locationStrings = locations.map((l) => computeLocationLabel(l));
    const competitorDomains = competitors
      .map((c) => c.domain || c.competitorName || '')
      .filter(Boolean);

    const result =
      competitorDomains.length > 0
        ? await provider.fetchCompetitorRankings(
            businessId,
            keywordStrings,
            locationStrings,
            competitorDomains,
            options,
          )
        : await provider.fetchKeywordRankings(businessId, keywordStrings, locationStrings, options);

    // Persist provider usage events (business-scoped, no credentials).
    const usage = (provider as any).usage as ProviderUsageDescriptor[] | undefined;
    if (Array.isArray(usage) && usage.length > 0) {
      await logProviderUsage(businessId, providerType, usage, runId);
    }

    let persisted = { observationCount: 0, paidCount: 0, competitorCount: competitors.length };
    if (result.observations.length > 0) {
      persisted = await persistResult(businessId, runId, result.observations, {
        keywords,
        locations,
        dataSource: `${providerType}:fetchKeywordRankings`,
        isSandbox,
        selfDomain,
        existingCompetitorCount: competitors.length,
      });
    }

    await prisma.searchIntelligenceRun.update({
      where: { id: runId },
      data: {
        status: health.configured && persisted.observationCount > 0 ? 'complete' : 'partial',
        completedAt: new Date(),
        keywordCount: keywords.length,
        locationCount: locations.length,
        competitorCount: persisted.competitorCount,
        observationCount: persisted.observationCount,
        rawSnapshotRef: result.rawSnapshotRef ?? null,
        isSandbox,
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
        isSandbox,
        errorMessage: String(err?.message || err).slice(0, 1000),
      } as any,
    });
  }
}

interface PersistCtx {
  keywords: Array<{ id: string; keyword: string; normalizedKeyword: string }>;
  locations: Array<{
    id: string;
    marketLabel: string | null;
    city: string | null;
    state?: string | null;
    zip: string | null;
  }>;
  dataSource: string;
  isSandbox: boolean;
  selfDomain: string | null;
  existingCompetitorCount: number;
}

/**
 * Normalize provider observations into the storage tables:
 *  - SearchVisibilityObservation (organic / local pack / etc.)
 *  - PaidAdObservation (paid ads)
 *  - SearchCompetitor (upsert discovered non-self domains, source='observed')
 *  - OrganicPositionHistory (per keyword + location summary row)
 * All rows carry businessId, runId, dataSource, observedAt and the sandbox flag.
 */
async function persistResult(
  businessId: string,
  runId: string,
  observations: NormalizedObservation[],
  ctx: PersistCtx,
): Promise<{ observationCount: number; paidCount: number; competitorCount: number }> {
  const kwByNorm = new Map(ctx.keywords.map((k) => [k.normalizedKeyword, k.id]));
  const locByLabel = new Map(ctx.locations.map((l) => [computeLocationLabel(l), l.id]));
  const observedAt = new Date();

  // Cache of domain -> competitorId discovered/upserted during this run.
  const competitorCache = new Map<string, string>();
  let newCompetitors = 0;

  async function resolveCompetitor(domain: string | undefined | null): Promise<string | null> {
    if (!domain) return null;
    const key = domain.toLowerCase();
    if (competitorCache.has(key)) return competitorCache.get(key)!;
    const existing = await prisma.searchCompetitor.findFirst({
      where: { businessId, domain: key },
      select: { id: true },
    });
    if (existing) {
      await prisma.searchCompetitor.update({
        where: { id: existing.id },
        data: { lastSeenAt: observedAt },
      });
      competitorCache.set(key, existing.id);
      return existing.id;
    }
    const created = await prisma.searchCompetitor.create({
      data: {
        businessId,
        domain: key,
        competitorName: key,
        source: 'observed',
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        status: 'active',
      },
    });
    competitorCache.set(key, created.id);
    newCompetitors++;
    return created.id;
  }

  // Aggregate organic-position-history per keyword+location.
  type HistAgg = {
    keywordId: string | null;
    locationId: string | null;
    selfPosition: number | null;
    selfUrl: string | null;
    bestCompetitorPosition: number | null;
    topCompetitorId: string | null;
    localPackPosition: number | null;
    paidAdPosition: number | null;
  };
  const histByKey = new Map<string, HistAgg>();

  let observationCount = 0;
  let paidCount = 0;

  for (const obs of observations) {
    const keywordId = obs.keyword ? kwByNorm.get(normalizeKeyword(obs.keyword)) ?? null : null;
    const locationId = obs.locationLabel ? locByLabel.get(obs.locationLabel) ?? null : null;
    const isSelf = obs.isSelf ?? false;
    const competitorId = !isSelf ? await resolveCompetitor(obs.domain) : null;
    const position = typeof obs.position === 'number' ? obs.position : null;
    const histKey = `${keywordId ?? '_'}|${locationId ?? '_'}`;
    let agg = histByKey.get(histKey);
    if (!agg) {
      agg = {
        keywordId,
        locationId,
        selfPosition: null,
        selfUrl: null,
        bestCompetitorPosition: null,
        topCompetitorId: null,
        localPackPosition: null,
        paidAdPosition: null,
      };
      histByKey.set(histKey, agg);
    }

    if (obs.resultType === 'paid_ad') {
      await prisma.paidAdObservation.create({
        data: {
          businessId,
          runId,
          observedAt,
          keywordId,
          locationId,
          advertiserName: obs.domain ?? null,
          displayUrl: obs.domain ?? null,
          finalUrl: obs.url ?? null,
          headlineText: obs.title ?? null,
          descriptionText: obs.snippet ?? null,
          position,
          adFormat: 'text',
          isSelf,
          competitorId,
          dataSource: obs.dataSource ?? ctx.dataSource,
          isSandbox: ctx.isSandbox,
        } as any,
      });
      paidCount++;
      if (position != null && (agg.paidAdPosition == null || position < agg.paidAdPosition)) {
        agg.paidAdPosition = position;
      }
      continue;
    }

    const businessMatchType = isSelf ? 'self' : obs.domain ? 'competitor' : 'unknown';
    await prisma.searchVisibilityObservation.create({
      data: {
        businessId,
        runId,
        observedAt,
        keywordId,
        locationId,
        searchEngine: obs.searchEngine ?? 'google',
        device: obs.device ?? 'desktop',
        resultType: obs.resultType ?? 'organic',
        position,
        pageNumber: obs.pageNumber ?? null,
        domain: obs.domain ?? null,
        url: obs.url ?? null,
        title: obs.title ?? null,
        snippet: obs.snippet ?? null,
        businessMatchType,
        isSelf,
        competitorId,
        confidenceScore: obs.confidenceScore ?? 0,
        dataSource: obs.dataSource ?? ctx.dataSource,
        isSandbox: ctx.isSandbox,
      } as any,
    });
    observationCount++;

    if (obs.resultType === 'organic') {
      if (isSelf && position != null && (agg.selfPosition == null || position < agg.selfPosition)) {
        agg.selfPosition = position;
        agg.selfUrl = obs.url ?? null;
      }
      if (!isSelf && position != null && (agg.bestCompetitorPosition == null || position < agg.bestCompetitorPosition)) {
        agg.bestCompetitorPosition = position;
        agg.topCompetitorId = competitorId;
      }
    } else if ((obs.resultType === 'local_pack' || obs.resultType === 'map_result') && position != null) {
      if (isSelf && (agg.localPackPosition == null || position < agg.localPackPosition)) {
        agg.localPackPosition = position;
      }
    }
  }

  // Write one OrganicPositionHistory summary per keyword+location.
  for (const agg of histByKey.values()) {
    await prisma.organicPositionHistory.create({
      data: {
        businessId,
        keywordId: agg.keywordId,
        locationId: agg.locationId,
        observedAt,
        selfPosition: agg.selfPosition,
        selfUrl: agg.selfUrl,
        bestCompetitorPosition: agg.bestCompetitorPosition,
        topCompetitorId: agg.topCompetitorId,
        localPackPosition: agg.localPackPosition,
        paidAdPosition: agg.paidAdPosition,
        organicRankBucket: organicRankBucket(agg.selfPosition),
        dataSource: ctx.dataSource,
      } as any,
    });
  }

  return {
    observationCount,
    paidCount,
    competitorCount: ctx.existingCompetitorCount + newCompetitors,
  };
}

/**
 * Manual single-keyword / single-location test search (Settings panel).
 * Creates a run, executes against the configured provider, persists results
 * (flagged with the current sandbox mode), logs usage, and returns the
 * normalized observations so the UI can render organic + paid results.
 */
export async function runSingleTestSearch(
  businessId: string,
  input: { keyword: string; location: string },
): Promise<{
  runId: string;
  providerType: string;
  isSandbox: boolean;
  health: { configured: boolean; healthy: boolean; message: string };
  observations: NormalizedObservation[];
  meta: Record<string, any>;
}> {
  const settings = await ensureSearchIntelSettings(businessId);
  const providerType = resolveProviderType(settings.defaultProvider);
  const cfg = getDataForSeoConfig();
  const isSandbox = providerType === 'dataforseo' ? cfg.useSandbox : false;

  const keyword = (input.keyword || '').trim();
  const location = (input.location || '').trim() || 'United States';

  const run = await prisma.searchIntelligenceRun.create({
    data: {
      businessId,
      runType: 'manual_test_search',
      dataSource: providerType,
      status: 'running',
      startedAt: new Date(),
      keywordCount: 1,
      locationCount: 1,
      isSandbox,
    } as any,
  });

  try {
    const selfDomain = await getSelfDomain(businessId);
    const provider = getSearchIntelligenceProvider(providerType);
    const health = await provider.fetchProviderHealth();

    const options: ProviderRequestOptions = {
      device: (settings.device as any) ?? 'desktop',
      includePaid: settings.includePaidAds,
      includeOrganic: settings.includeOrganic,
      includeLocalPack: settings.includeLocalPack,
      maxResults: 1,
      selfDomain,
    };

    const result: NormalizedResult = await provider.fetchKeywordRankings(
      businessId,
      [keyword],
      [location],
      options,
    );

    const usage = (provider as any).usage as ProviderUsageDescriptor[] | undefined;
    if (Array.isArray(usage) && usage.length > 0) {
      await logProviderUsage(businessId, providerType, usage, run.id);
    }

    let observationCount = 0;
    if (result.observations.length > 0) {
      const persisted = await persistResult(businessId, run.id, result.observations, {
        keywords: [],
        locations: [],
        dataSource: `${providerType}:manual_test_search`,
        isSandbox,
        selfDomain,
        existingCompetitorCount: 0,
      });
      observationCount = persisted.observationCount + persisted.paidCount;
    }

    await prisma.searchIntelligenceRun.update({
      where: { id: run.id },
      data: {
        status: health.configured ? 'complete' : 'partial',
        completedAt: new Date(),
        observationCount,
        rawSnapshotRef: result.rawSnapshotRef ?? null,
        isSandbox,
        errorMessage: health.configured ? null : health.message,
      } as any,
    });

    return {
      runId: run.id,
      providerType,
      isSandbox,
      health: { configured: health.configured, healthy: health.healthy, message: health.message },
      observations: result.observations,
      meta: result.meta ?? {},
    };
  } catch (err: any) {
    await prisma.searchIntelligenceRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        isSandbox,
        errorMessage: String(err?.message || err).slice(0, 1000),
      } as any,
    });
    throw err;
  }
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