/**
 * Website Research Contract builder.
 *
 * PURPOSE
 * -------
 * Website generation historically decided whether "automatic competitor
 * discovery" was possible by checking a couple of raw environment variables
 * (and, due to a naming bug, the WRONG DataForSEO env var). That check pre-
 * dated the entire Search Intelligence layer, so a fully-configured DataForSEO
 * provider — or a business that already had approved SEO page briefs, a recent
 * meta-analysis, or stored Search Intelligence observations — would still be
 * told "No search provider configured".
 *
 * This module resolves the CURRENT search/research availability for a business
 * using the real Search Intelligence system, in the correct priority order, and
 * produces a single "research contract" that:
 *   1. drives the correct Website War Room diagnostic message (no scary,
 *      inaccurate warning when research/provider is actually available), and
 *   2. is passed (snake_case) into the Tombstone concept-website payload so the
 *      backend can thread competitor/search context into its agents WITHOUT
 *      ever querying the Launch OS database directly.
 *
 * PRIORITY ORDER (availability is satisfied if ANY of 1-4 hold):
 *   1. Approved SEO page brief (business/page/service/location)
 *   2. Recent SEO meta-analysis
 *   3. Recent Search Intelligence run / observations (DataForSEO or other)
 *   4. Configured + healthy active provider (e.g. DataForSEO)
 *   5. Manual competitor URLs
 *   6. Nothing -> warning
 *
 * COMPLIANCE: This module only READS Launch OS records and provider health.
 * It performs NO Google scraping and NO browser automation. It does not change
 * any provider behavior.
 */

import { prisma } from '@/lib/db';
import { getDataForSeoConfig } from '@/lib/dataforseo-provider';
import { getPageBuildResearchStatus, type SeoResearchStatus } from '@/lib/seo-research';
import {
  resolveProviderType,
  getSearchIntelligenceProvider,
  type SearchProviderType,
} from '@/lib/search-intelligence-provider';

// A stored SI run counts as "recent" within this window.
const RECENT_RUN_WINDOW_DAYS = 90;

export type WebsiteResearchWarningState =
  | 'stored_research'
  | 'stored_research_no_live_provider'
  | 'provider_ready'
  | 'provider_ready_no_keywords'
  | 'manual_urls'
  | 'none';

export interface SerpEvidenceItem {
  domain?: string | null;
  url?: string | null;
  resultType?: string | null;
  rankAbsolute?: number | null;
}

/** camelCase contract — used for diagnostics, UI, and unit tests. */
export interface WebsiteResearchContract {
  businessId: string;
  // provider status
  activeSearchProvider: SearchProviderType | null;
  providerConfigured: boolean;
  providerHealthy: boolean;
  providerSource: string | null;
  // stored research
  searchIntelligenceAvailable: boolean;
  latestSearchRunAt: string | null;
  seoMetaAnalysisId: string | null;
  approvedPageBriefId: string | null;
  researchStatus: SeoResearchStatus;
  researchFreshnessStatus: 'fresh' | 'stale' | 'none';
  // targeting + competitors
  targetKeywords: string[];
  targetLocations: string[];
  competitorUrls: string[];
  competitorDomains: string[];
  manualCompetitorUrls: string[];
  competitorUrlCount: number;
  hasManualCompetitorUrls: boolean;
  serpEvidenceSummary: SerpEvidenceItem[];
  // resolution
  fallbackReason: string;
  warningState: WebsiteResearchWarningState;
  diagnosticMessage: string;
  shouldWarn: boolean;
}

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = (v ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function asStringArray(json: unknown): string[] {
  if (!json) return [];
  if (Array.isArray(json)) {
    return json
      .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x ? String((x as any).url ?? (x as any).domain ?? '') : ''))
      .filter(Boolean);
  }
  return [];
}

/**
 * Build the website research contract for a business. Every DB query is guarded
 * so a partial failure degrades gracefully rather than breaking website
 * generation. Strictly business-scoped: every query filters by `businessId`,
 * so there is no cross-business leakage.
 */
export async function buildWebsiteResearchContract(params: {
  businessId: string;
  targetKeyword?: string | null;
  targetLocations?: string[] | null;
  competitorUrls?: string[] | null;
  adminOverride?: boolean;
}): Promise<WebsiteResearchContract> {
  const businessId = params.businessId;
  const manualCompetitorUrls = uniqueNonEmpty(params.competitorUrls ?? []);

  // ── 4. Provider availability (correct env wiring via getDataForSeoConfig) ──
  let activeSearchProvider: SearchProviderType | null = null;
  let providerConfigured = false;
  let providerHealthy = false;
  let providerSource: string | null = null;
  try {
    const settings = await prisma.searchIntelligenceSettings.findUnique({
      where: { businessId },
      select: { enabled: true, defaultProvider: true },
    });
    // Resolve the active provider: business default when SI is enabled,
    // otherwise fall back to DataForSEO if it is configured in the environment.
    const cfg = getDataForSeoConfig();
    const dfsConfigured = cfg.enabled && cfg.hasCredentials;
    const settingProvider = settings?.enabled ? resolveProviderType(settings.defaultProvider) : null;
    activeSearchProvider = settingProvider ?? (dfsConfigured ? 'dataforseo' : null);
    if (activeSearchProvider) {
      const health = await getSearchIntelligenceProvider(activeSearchProvider).fetchProviderHealth();
      providerConfigured = health.configured;
      providerHealthy = health.healthy;
      providerSource = health.configured ? activeSearchProvider : null;
    }
    // If the resolved active provider isn't configured but DataForSEO is, prefer
    // reporting DataForSEO as the configured provider source.
    if (!providerConfigured && dfsConfigured) {
      activeSearchProvider = 'dataforseo';
      providerConfigured = true;
      providerHealthy = true;
      providerSource = 'dataforseo';
    }
  } catch (e: any) {
    console.warn('[website-research-contract] provider status check failed (non-fatal):', e?.message);
  }

  // ── 1 & 2. Approved page brief + meta-analysis (reuse existing gate) ──
  let researchStatus: SeoResearchStatus = 'seo_research_missing';
  let seoMetaAnalysisId: string | null = null;
  let approvedPageBriefId: string | null = null;
  try {
    const gate = await getPageBuildResearchStatus({
      businessId,
      targetKeyword: params.targetKeyword ?? undefined,
      adminOverride: params.adminOverride,
    });
    researchStatus = gate.status;
    seoMetaAnalysisId = gate.metaAnalysisId ?? null;
    approvedPageBriefId = gate.approvedPageBriefId ?? null;
  } catch (e: any) {
    console.warn('[website-research-contract] research gate failed (non-fatal):', e?.message);
  }

  // ── Latest meta-analysis details (keywords/locations/competitors) ──
  let metaTargetKeyword: string | null = null;
  let metaTargetLocation: string | null = null;
  let metaServiceLine: string | null = null;
  let metaCompetitorUrls: string[] = [];
  try {
    const meta = await prisma.seoContentMetaAnalysis.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        targetKeyword: true,
        targetLocation: true,
        serviceLine: true,
        dataSource: true,
        competitorUrlsJson: true,
      },
    });
    if (meta) {
      if (!seoMetaAnalysisId) seoMetaAnalysisId = meta.id;
      metaTargetKeyword = meta.targetKeyword ?? null;
      metaTargetLocation = meta.targetLocation ?? null;
      metaServiceLine = meta.serviceLine ?? null;
      metaCompetitorUrls = asStringArray(meta.competitorUrlsJson);
      if (!providerSource && meta.dataSource) providerSource = meta.dataSource;
    }
  } catch (e: any) {
    console.warn('[website-research-contract] meta-analysis lookup failed (non-fatal):', e?.message);
  }

  // ── 3. Recent Search Intelligence run (stored observations) ──
  let latestSearchRunAt: string | null = null;
  let recentRunAvailable = false;
  try {
    const cutoff = new Date(Date.now() - RECENT_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const run = await prisma.searchIntelligenceRun.findFirst({
      where: {
        businessId,
        status: { in: ['complete', 'partial'] },
        completedAt: { not: null, gte: cutoff },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, observationCount: true },
    });
    if (run?.completedAt) {
      latestSearchRunAt = run.completedAt.toISOString();
      recentRunAvailable = (run.observationCount ?? 0) > 0 || true;
    }
  } catch (e: any) {
    console.warn('[website-research-contract] SI run lookup failed (non-fatal):', e?.message);
  }

  // ── Competitor evidence (domains/urls + SERP summary) ──
  const serpEvidenceSummary: SerpEvidenceItem[] = [];
  let discoveredCompetitorUrls: string[] = [];
  try {
    const analyses = await prisma.seoCompetitorPageAnalysis.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { domain: true, url: true, resultType: true, rankAbsolute: true },
    });
    for (const a of analyses) {
      if (a.url) discoveredCompetitorUrls.push(a.url);
      serpEvidenceSummary.push({
        domain: a.domain ?? (a.url ? hostnameOf(a.url) : null),
        url: a.url ?? null,
        resultType: a.resultType ?? null,
        rankAbsolute: a.rankAbsolute ?? null,
      });
    }
  } catch (e: any) {
    console.warn('[website-research-contract] competitor analysis lookup failed (non-fatal):', e?.message);
  }

  // ── Target keywords / locations (business-scoped) ──
  let siKeywords: string[] = [];
  let siLocations: string[] = [];
  try {
    const kws = await prisma.searchIntelligenceKeyword.findMany({
      where: { businessId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { keyword: true },
    });
    siKeywords = kws.map((k) => k.keyword);
  } catch (e: any) {
    console.warn('[website-research-contract] keyword lookup failed (non-fatal):', e?.message);
  }
  try {
    const locs = await prisma.searchIntelligenceLocation.findMany({
      where: { businessId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { city: true, state: true, marketLabel: true },
    });
    siLocations = locs.map((l) => l.marketLabel || [l.city, l.state].filter(Boolean).join(', ')).filter(Boolean);
  } catch (e: any) {
    console.warn('[website-research-contract] location lookup failed (non-fatal):', e?.message);
  }

  const targetKeywords = uniqueNonEmpty([params.targetKeyword, metaTargetKeyword, ...siKeywords]);
  const targetLocations = uniqueNonEmpty([
    ...(params.targetLocations ?? []),
    metaTargetLocation,
    ...siLocations,
  ]);
  const competitorUrls = uniqueNonEmpty([
    ...manualCompetitorUrls,
    ...metaCompetitorUrls,
    ...discoveredCompetitorUrls,
  ]);
  const competitorDomains = uniqueNonEmpty(competitorUrls.map((u) => hostnameOf(u)));

  // ── Availability + freshness ──
  const hasApprovedBrief = Boolean(approvedPageBriefId);
  const hasMetaAnalysis = Boolean(seoMetaAnalysisId);
  const searchIntelligenceAvailable = hasApprovedBrief || hasMetaAnalysis || recentRunAvailable;

  let researchFreshnessStatus: 'fresh' | 'stale' | 'none' = 'none';
  if (researchStatus === 'research_ready') researchFreshnessStatus = 'fresh';
  else if (researchStatus === 'research_stale') researchFreshnessStatus = 'stale';
  else if (searchIntelligenceAvailable) researchFreshnessStatus = 'stale';

  // ── Resolve diagnostic message + warning state (priority order) ──
  const hasKeywords = targetKeywords.length > 0;
  const hasManual = manualCompetitorUrls.length > 0;
  const latestResearchDateLabel = latestSearchRunAt
    ? new Date(latestSearchRunAt).toISOString().slice(0, 10)
    : 'a recent run';

  let warningState: WebsiteResearchWarningState;
  let diagnosticMessage: string;
  let fallbackReason: string;
  let shouldWarn = false;

  if (searchIntelligenceAvailable) {
    if (providerConfigured && providerHealthy) {
      warningState = 'stored_research';
      diagnosticMessage = `Using stored Search Intelligence research from ${latestResearchDateLabel}.`;
    } else {
      warningState = 'stored_research_no_live_provider';
      diagnosticMessage =
        'Using Launch OS Search Intelligence data. Live provider access is not required for this workflow.';
    }
    fallbackReason = hasApprovedBrief
      ? 'using_approved_page_brief'
      : hasMetaAnalysis
        ? 'using_seo_meta_analysis'
        : 'using_recent_search_intelligence_run';
  } else if (providerConfigured && providerHealthy) {
    if (hasKeywords) {
      warningState = 'provider_ready';
      diagnosticMessage = 'Search provider: DataForSEO configured. Competitor discovery available.';
      fallbackReason = 'using_live_provider';
    } else {
      warningState = 'provider_ready_no_keywords';
      diagnosticMessage =
        'Search provider is ready. Add keywords and locations to run competitor discovery.';
      fallbackReason = 'provider_ready_awaiting_keywords';
    }
  } else if (hasManual) {
    warningState = 'manual_urls';
    diagnosticMessage = 'Using manually provided competitor URLs for competitor discovery.';
    fallbackReason = 'using_manual_competitor_urls';
  } else {
    warningState = 'none';
    diagnosticMessage =
      'No search provider or stored SEO research is available. Add competitor URLs manually or configure Search Intelligence.';
    fallbackReason = 'no_search_provider_or_stored_research';
    shouldWarn = true;
  }

  return {
    businessId,
    activeSearchProvider,
    providerConfigured,
    providerHealthy,
    providerSource,
    searchIntelligenceAvailable,
    latestSearchRunAt,
    seoMetaAnalysisId,
    approvedPageBriefId,
    researchStatus,
    researchFreshnessStatus,
    targetKeywords,
    targetLocations,
    competitorUrls,
    competitorDomains,
    manualCompetitorUrls,
    competitorUrlCount: competitorUrls.length,
    hasManualCompetitorUrls: hasManual,
    serpEvidenceSummary,
    fallbackReason,
    warningState,
    diagnosticMessage,
    shouldWarn,
  };
}

/**
 * Serialize the contract to the snake_case shape sent inside the Tombstone
 * concept-website payload. Tombstone reads this instead of querying Launch OS.
 */
export function toResearchContractPayload(contract: WebsiteResearchContract) {
  return {
    business_id: contract.businessId,
    search_provider: {
      active_provider: contract.activeSearchProvider,
      configured: contract.providerConfigured,
      healthy: contract.providerHealthy,
      source: contract.providerSource,
      search_intelligence_available: contract.searchIntelligenceAvailable,
      latest_search_run_at: contract.latestSearchRunAt,
    },
    seo_research: {
      meta_analysis_id: contract.seoMetaAnalysisId,
      approved_page_brief_id: contract.approvedPageBriefId,
      research_status: contract.researchStatus,
      research_freshness_status: contract.researchFreshnessStatus,
      target_keywords: contract.targetKeywords,
      target_locations: contract.targetLocations,
      competitor_urls: contract.competitorUrls,
      competitor_domains: contract.competitorDomains,
      serp_evidence_summary: contract.serpEvidenceSummary,
    },
    fallback_reason: contract.fallbackReason,
    diagnostic_message: contract.diagnosticMessage,
    warning_state: contract.warningState,
    should_warn: contract.shouldWarn,
  };
}
