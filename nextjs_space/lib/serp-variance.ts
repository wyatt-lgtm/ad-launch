/**
 * SERP variance analysis.
 *
 * DataForSEO (and any SERP provider) returns ONE observation of a SERP at a
 * point in time. Google personalizes and localizes results, so a single run is
 * not absolute truth. This module aggregates MULTIPLE observations of the same
 * keyword + location over a period to separate stable signals from noise:
 *
 *   - stable competitor  = a domain that appears in MULTIPLE observations
 *   - volatile competitor = a domain that appears only ONCE
 *   - strong signal       = a competitor whose repeated result is a service or
 *                           local/business page (the kind of page we model)
 *   - weak signal         = forum / video / informational results, unless the
 *                           keyword intent itself is informational
 *
 * IMPORTANT: This module only READS already-stored observations. It performs no
 * network calls and does NOT schedule or trigger any repeated runs — repeated
 * observations accumulate only from manual/test runs the user chooses to make.
 */

import { prisma } from '@/lib/db';

export interface DomainVarianceStat {
  domain: string;
  observationsSeen: number; // how many distinct observation-times included it
  bestRankGroup: number | null;
  bestRankAbsolute: number | null;
  resultTypes: string[];
  signalStrength: 'strong' | 'weak';
}

export interface SerpVarianceResult {
  businessId: string;
  keywordId: string | null;
  locationId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  observationsCount: number; // distinct observation timestamps analyzed
  stableDomains: DomainVarianceStat[];
  volatileDomains: DomainVarianceStat[];
  selfSeenCount: number;
  topCompetitorDomains: string[];
  confidenceScore: number; // 0..1 — higher with more corroborating observations
}

// Result types that indicate a service / local / business page worth modelling.
const STRONG_TYPES = new Set(['organic', 'local_pack', 'map_result', 'shopping', 'featured_snippet']);
// Result types that are weak as a competitor model (customer-question signals).
const WEAK_TYPES = new Set(['people_also_ask', 'related_searches', 'video', 'image']);
// Domains that are weak as a "competitor service page" model even when organic.
const WEAK_DOMAIN_HINTS = ['reddit.com', 'quora.com', 'youtube.com', 'facebook.com', 'pinterest.com', 'tiktok.com', 'wikipedia.org'];

function isWeakDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return WEAK_DOMAIN_HINTS.some((h) => d === h || d.endsWith(`.${h}`) || d.includes(h));
}

export interface ComputeVarianceOptions {
  businessId: string;
  keywordId?: string | null;
  locationId?: string | null;
  /** Keyword search intent. When 'informational', forum/PAA signals are not down-weighted. */
  intent?: 'commercial' | 'local' | 'informational' | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

/**
 * Compute variance over the stored SearchVisibilityObservation rows for a
 * keyword + location. Pure read; safe to call any time.
 */
export async function computeSerpVariance(opts: ComputeVarianceOptions): Promise<SerpVarianceResult> {
  const { businessId, keywordId = null, locationId = null, intent = null } = opts;

  const where: any = { businessId };
  if (keywordId) where.keywordId = keywordId;
  if (locationId) where.locationId = locationId;
  if (opts.periodStart || opts.periodEnd) {
    where.observedAt = {};
    if (opts.periodStart) where.observedAt.gte = opts.periodStart;
    if (opts.periodEnd) where.observedAt.lte = opts.periodEnd;
  }

  const rows = await prisma.searchVisibilityObservation.findMany({
    where,
    select: {
      observedAt: true, domain: true, isSelf: true, resultType: true,
      rankGroup: true, rankAbsolute: true, position: true,
    },
    orderBy: { observedAt: 'asc' },
    take: 5000,
  });

  // Bucket rows by distinct observation timestamp (one SERP capture = one run).
  const obsTimes = new Set<string>();
  let periodStart: Date | null = opts.periodStart ?? null;
  let periodEnd: Date | null = opts.periodEnd ?? null;
  let selfSeenObsTimes = new Set<string>();

  // domain -> { obsTimes set, bestGroup, bestAbs, types set }
  const byDomain = new Map<string, {
    obs: Set<string>; bestGroup: number | null; bestAbs: number | null; types: Set<string>;
  }>();

  for (const r of rows) {
    const t = r.observedAt ? r.observedAt.toISOString() : 'unknown';
    obsTimes.add(t);
    if (r.observedAt) {
      if (!periodStart || r.observedAt < periodStart) periodStart = r.observedAt;
      if (!periodEnd || r.observedAt > periodEnd) periodEnd = r.observedAt;
    }
    if (r.isSelf) { selfSeenObsTimes.add(t); continue; }
    const domain = (r.domain || '').toLowerCase();
    if (!domain) continue;
    let agg = byDomain.get(domain);
    if (!agg) { agg = { obs: new Set(), bestGroup: null, bestAbs: null, types: new Set() }; byDomain.set(domain, agg); }
    agg.obs.add(t);
    if (r.resultType) agg.types.add(r.resultType);
    const grp = typeof r.rankGroup === 'number' ? r.rankGroup : null;
    const abs = typeof r.rankAbsolute === 'number' ? r.rankAbsolute : (typeof r.position === 'number' ? r.position : null);
    if (grp != null && (agg.bestGroup == null || grp < agg.bestGroup)) agg.bestGroup = grp;
    if (abs != null && (agg.bestAbs == null || abs < agg.bestAbs)) agg.bestAbs = abs;
  }

  const observationsCount = obsTimes.size;

  const toStat = (domain: string, agg: { obs: Set<string>; bestGroup: number | null; bestAbs: number | null; types: Set<string> }): DomainVarianceStat => {
    const types = Array.from(agg.types);
    const hasStrongType = types.some((t) => STRONG_TYPES.has(t));
    const onlyWeakType = types.length > 0 && types.every((t) => WEAK_TYPES.has(t));
    // Strong signal = repeated service/local/business page on a non-forum domain,
    // unless intent is informational (then forum/PAA is acceptable corroboration).
    let signalStrength: 'strong' | 'weak' = 'weak';
    if (intent === 'informational') {
      signalStrength = agg.obs.size >= 2 ? 'strong' : 'weak';
    } else if (hasStrongType && !onlyWeakType && !isWeakDomain(domain)) {
      signalStrength = agg.obs.size >= 2 ? 'strong' : 'weak';
    }
    return {
      domain,
      observationsSeen: agg.obs.size,
      bestRankGroup: agg.bestGroup,
      bestRankAbsolute: agg.bestAbs,
      resultTypes: types,
      signalStrength,
    };
  };

  const stableDomains: DomainVarianceStat[] = [];
  const volatileDomains: DomainVarianceStat[] = [];
  for (const [domain, agg] of Array.from(byDomain.entries())) {
    const stat = toStat(domain, agg);
    if (agg.obs.size >= 2) stableDomains.push(stat);
    else volatileDomains.push(stat);
  }

  // Sort stable by frequency then best rank; volatile by best rank.
  stableDomains.sort((a, b) => (b.observationsSeen - a.observationsSeen) || ((a.bestRankAbsolute ?? 999) - (b.bestRankAbsolute ?? 999)));
  volatileDomains.sort((a, b) => (a.bestRankAbsolute ?? 999) - (b.bestRankAbsolute ?? 999));

  // Top competitors = stable + strong-signal domains, best-ranked first.
  const topCompetitorDomains = stableDomains
    .filter((d) => d.signalStrength === 'strong')
    .slice(0, 10)
    .map((d) => d.domain);

  // Confidence rises with the number of corroborating observations (caps at 1).
  const confidenceScore = observationsCount <= 0
    ? 0
    : Math.min(1, 0.4 + 0.2 * (observationsCount - 1));

  return {
    businessId,
    keywordId,
    locationId,
    periodStart,
    periodEnd,
    observationsCount,
    stableDomains,
    volatileDomains,
    selfSeenCount: selfSeenObsTimes.size,
    topCompetitorDomains,
    confidenceScore,
  };
}

/**
 * Compute variance and persist a SearchSerpVarianceSummary row for later use
 * (e.g. website brief generation). Returns the persisted summary id. Pure read
 * of observations + single write of the summary; NO network, NO scheduling.
 */
export async function computeAndStoreSerpVariance(opts: ComputeVarianceOptions): Promise<{ id: string; result: SerpVarianceResult }> {
  const result = await computeSerpVariance(opts);
  const summary = await prisma.searchSerpVarianceSummary.create({
    data: {
      businessId: result.businessId,
      keywordId: result.keywordId,
      locationId: result.locationId,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      observationsCount: result.observationsCount,
      stableDomainsJson: result.stableDomains as any,
      volatileDomainsJson: result.volatileDomains as any,
      selfSeenCount: result.selfSeenCount,
      topCompetitorDomainsJson: result.topCompetitorDomains as any,
      confidenceScore: result.confidenceScore,
    } as any,
  });
  return { id: summary.id, result };
}
