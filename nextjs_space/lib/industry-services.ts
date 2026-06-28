/**
 * Industry Service Taxonomy engine.
 *
 * Responsibilities:
 *  - Match a business to one or more industries using Jim Bridger research.
 *  - Prepopulate a business's service offerings from the matched industry list.
 *  - Expose confirmed services to the SEO agent.
 *
 * Owner-confirmed data always wins over research. Rejected services stay
 * rejected unless explicitly re-added.
 *
 * Searchable log prefixes:
 *   INDUSTRY_MATCH_RESULT
 *   INDUSTRY_SERVICES_PREPOPULATED
 */
import { prisma } from '@/lib/db';

export type Confidence = 'high' | 'medium' | 'low';

export interface IndustryMatchResult {
  industryId: string;
  industryName: string;
  industrySlug: string;
  confidence: Confidence;
  evidence: string[];
}

export interface EvidenceSource {
  type: 'website' | 'page_title' | 'gbp_category' | 'business_name' | 'business_description' | 'directory' | 'owner';
  url?: string;
  snippet: string;
}

export function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'service';
}

/**
 * Build a single searchable text blob + structured fields from Bridger research.
 */
function extractResearchSignals(bridgerResearch: any, business?: any): {
  text: string;
  gbpCategory: string;
  businessName: string;
  websiteUrl: string;
  pages: { url?: string; text: string }[];
} {
  const recon = bridgerResearch?.rawRecon || bridgerResearch || {};
  const parts: string[] = [];

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = recon[k] ?? bridgerResearch?.[k];
      if (v) return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return '';
  };

  const businessName = pick('business_name', 'businessName') || business?.businessName || '';
  const websiteUrl = pick('website_url', 'websiteUrl', 'target_url') || business?.websiteUrl || '';
  const gbpCategory = pick('google_category', 'gbp_category', 'business_category', 'category', 'primary_category');
  const services = pick('services_offered', 'services', 'products_services');
  const description = pick('summary', 'business_summary', 'overview', 'description', 'about');
  const pageTitlesRaw = recon.page_titles || recon.pageTitles || bridgerResearch?.page_titles;
  const websiteText = pick('website_text', 'scraped_text', 'homepage_text', 'content');

  parts.push(businessName, gbpCategory, services, description, websiteText);
  if (Array.isArray(pageTitlesRaw)) parts.push(pageTitlesRaw.join(' '));
  else if (typeof pageTitlesRaw === 'string') parts.push(pageTitlesRaw);

  // Collect page-level snippets when available for evidence
  const pages: { url?: string; text: string }[] = [];
  const rawPages = recon.pages || recon.scraped_pages || bridgerResearch?.pages;
  if (Array.isArray(rawPages)) {
    for (const p of rawPages) {
      if (typeof p === 'string') pages.push({ text: p });
      else if (p && typeof p === 'object') {
        pages.push({ url: p.url || p.link, text: [p.title, p.text, p.content, p.snippet].filter(Boolean).join(' ') });
      }
    }
  }
  if (services) pages.push({ url: websiteUrl, text: services });

  return {
    text: parts.filter(Boolean).join(' \n ').toLowerCase(),
    gbpCategory: (gbpCategory || '').toLowerCase(),
    businessName,
    websiteUrl,
    pages,
  };
}

/**
 * Match a business to the best industry using Jim Bridger research.
 * Owner-confirmed industry always wins and short-circuits.
 */
export async function matchBusinessToIndustry(
  businessId: string,
  bridgerResearch: any,
): Promise<IndustryMatchResult | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      businessName: true,
      websiteUrl: true,
      matchedIndustryId: true,
      ownerConfirmedIndustry: true,
    },
  });
  if (!business) return null;

  // Owner-confirmed industry wins — never overwrite via research.
  if (business.ownerConfirmedIndustry && business.matchedIndustryId) {
    const ind = await prisma.industry.findUnique({ where: { id: business.matchedIndustryId } });
    if (ind) {
      return {
        industryId: ind.id,
        industryName: ind.name,
        industrySlug: ind.slug,
        confidence: 'high',
        evidence: ['Owner-confirmed industry'],
      };
    }
  }

  const industries = await prisma.industry.findMany({ where: { enabled: true } });
  if (industries.length === 0) return null;

  const signals = extractResearchSignals(bridgerResearch, business);

  let best: { industry: typeof industries[number]; score: number; evidence: string[] } | null = null;

  for (const ind of industries) {
    let score = 0;
    const evidence: string[] = [];

    // GBP category is the strongest signal
    for (const cat of ind.gbpCategories) {
      if (signals.gbpCategory && signals.gbpCategory.includes(cat.toLowerCase())) {
        score += 6;
        evidence.push(`Google Business category matches "${cat}"`);
        break;
      }
    }

    // Keyword matches in combined research text
    let kwHits = 0;
    for (const kw of ind.matchKeywords) {
      const k = kw.toLowerCase();
      if (signals.text.includes(k)) {
        kwHits++;
        if (evidence.length < 5) evidence.push(`Found "${kw}" in website/research`);
      }
    }
    score += Math.min(kwHits, 8) * 1.5;

    // Business name signal
    for (const kw of ind.matchKeywords) {
      if (signals.businessName.toLowerCase().includes(kw.toLowerCase())) {
        score += 2;
        evidence.push(`Business name references "${kw}"`);
        break;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { industry: ind, score, evidence };
    }
  }

  if (!best || best.score <= 0) {
    console.log(`INDUSTRY_MATCH_RESULT business_id=${businessId} matched=none`);
    return null;
  }

  let confidence: Confidence = 'low';
  if (best.score >= 8) confidence = 'high';
  else if (best.score >= 4) confidence = 'medium';

  console.log(
    `INDUSTRY_MATCH_RESULT business_id=${businessId} matched=${best.industry.slug} ` +
    `score=${best.score.toFixed(1)} confidence=${confidence}`,
  );

  return {
    industryId: best.industry.id,
    industryName: best.industry.name,
    industrySlug: best.industry.slug,
    confidence,
    evidence: best.evidence.slice(0, 6),
  };
}

/**
 * Detect per-service evidence from research signals for a given industry.
 * Returns a map of industryServiceId -> { confidence, evidence }.
 */
function detectServiceEvidence(
  services: { id: string; name: string; matchKeywords: string[] }[],
  signals: ReturnType<typeof extractResearchSignals>,
): Record<string, { confidence: Confidence; evidence: EvidenceSource[] }> {
  const out: Record<string, { confidence: Confidence; evidence: EvidenceSource[] }> = {};

  for (const svc of services) {
    const keywords = (svc.matchKeywords && svc.matchKeywords.length > 0)
      ? svc.matchKeywords
      : [svc.name.toLowerCase()];
    const evidence: EvidenceSource[] = [];
    let hits = 0;

    for (const kw of keywords) {
      const k = kw.toLowerCase();
      if (!k) continue;
      // GBP category match
      if (signals.gbpCategory.includes(k)) {
        evidence.push({ type: 'gbp_category', snippet: `Google Business category lists "${kw}"` });
        hits += 2;
      }
      // Page-level evidence (gives us URL + snippet)
      for (const page of signals.pages) {
        const t = (page.text || '').toLowerCase();
        if (t.includes(k)) {
          const idx = t.indexOf(k);
          const snippet = page.text.slice(Math.max(0, idx - 40), idx + 60).trim();
          evidence.push({ type: 'website', url: page.url, snippet: snippet || `Mentions ${kw}` });
          hits += 1;
          break;
        }
      }
      // Fallback: global text
      if (evidence.length === 0 && signals.text.includes(k)) {
        evidence.push({ type: 'website', url: signals.websiteUrl, snippet: `Mentions "${kw}"` });
        hits += 1;
      }
    }

    if (hits > 0) {
      // Dedupe evidence by snippet
      const seen = new Set<string>();
      const deduped = evidence.filter((e) => {
        const key = `${e.type}:${e.snippet}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 4);
      const confidence: Confidence = hits >= 3 ? 'high' : hits >= 2 ? 'medium' : 'low';
      out[svc.id] = { confidence, evidence: deduped };
    }
  }

  return out;
}

/**
 * Prepopulate BusinessServiceOffering rows from a matched industry.
 *
 * - Creates `suggested` rows for every enabled, non-conditional industry service
 *   (conditional "if applicable" services are only added when evidence exists).
 * - When Jim Bridger evidence is found, marks the row `confirmed` (high) or
 *   `needs_review` (medium/low) with source `jim_bridger` and evidence JSON.
 * - Never overwrites owner-confirmed or owner-rejected rows.
 */
export async function prepopulateServicesFromIndustry(
  businessId: string,
  industryId: string,
  bridgerResearch?: any,
): Promise<{ created: number; updated: number; total: number }> {
  const [business, industry, services, existing] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { businessName: true, websiteUrl: true } }),
    prisma.industry.findUnique({ where: { id: industryId } }),
    prisma.industryService.findMany({ where: { industryId, enabled: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.businessServiceOffering.findMany({ where: { businessId } }),
  ]);
  if (!business || !industry) return { created: 0, updated: 0, total: 0 };

  const signals = bridgerResearch ? extractResearchSignals(bridgerResearch, business) : null;
  const evidenceMap = signals
    ? detectServiceEvidence(services.map((s) => ({ id: s.id, name: s.name, matchKeywords: s.matchKeywords })), signals)
    : {};

  const existingByServiceId = new Map(existing.filter((e) => e.industryServiceId).map((e) => [e.industryServiceId!, e]));
  const existingSlugs = new Set(existing.map((e) => e.slug));

  let created = 0;
  let updated = 0;

  for (const svc of services) {
    const ev = evidenceMap[svc.id];
    const hasEvidence = !!ev;

    // Conditional services only seeded when there is evidence
    if (svc.conditional && !hasEvidence) continue;

    const prior = existingByServiceId.get(svc.id);

    // Never touch owner-confirmed or rejected rows
    if (prior && (prior.ownerConfirmed || prior.status === 'rejected' || prior.status === 'hidden')) {
      continue;
    }

    const status = hasEvidence
      ? (ev!.confidence === 'high' ? 'confirmed' : 'needs_review')
      : 'suggested';
    const source = hasEvidence ? 'jim_bridger' : 'ai_inferred';
    const confidence = hasEvidence ? ev!.confidence : 'low';
    const evidenceJson = hasEvidence ? ({ evidenceSources: ev!.evidence } as any) : undefined;

    if (prior) {
      // Only upgrade suggested/needs_review rows, never downgrade
      await prisma.businessServiceOffering.update({
        where: { id: prior.id },
        data: {
          status: prior.status === 'confirmed' ? 'confirmed' : status,
          source,
          confidence,
          industryId,
          ...(evidenceJson ? { bridgerEvidenceJson: evidenceJson } : {}),
        },
      });
      updated++;
    } else {
      let slug = slugify(svc.name);
      // Ensure unique slug per business
      let suffix = 1;
      while (existingSlugs.has(slug)) {
        slug = `${slugify(svc.name)}-${suffix++}`;
      }
      existingSlugs.add(slug);

      await prisma.businessServiceOffering.create({
        data: {
          businessId,
          industryServiceId: svc.id,
          industryId,
          slug,
          status,
          source,
          confidence,
          bridgerEvidenceJson: evidenceJson,
          priority: 'secondary',
          seoEnabled: true,
        },
      });
      created++;
    }
  }

  console.log(
    `INDUSTRY_SERVICES_PREPOPULATED business_id=${businessId} industry=${industry.slug} ` +
    `created=${created} updated=${updated}`,
  );

  return { created, updated, total: created + updated };
}

/**
 * High-level helper: match + persist match on business + prepopulate services.
 * Respects owner-confirmed industry. Used by the Jim Bridger completion flow
 * and the manual "re-match" action.
 */
export async function runIndustryMatchAndPrepopulate(
  businessId: string,
  bridgerResearch: any,
): Promise<IndustryMatchResult | null> {
  const match = await matchBusinessToIndustry(businessId, bridgerResearch);
  if (!match) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerConfirmedIndustry: true, matchedIndustryId: true },
  });

  // Persist the match unless owner has confirmed a (possibly different) industry
  if (!business?.ownerConfirmedIndustry) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        matchedIndustryId: match.industryId,
        matchedIndustryConfidence: match.confidence,
        industryMatchSource: 'jim_bridger',
        industryMatchEvidence: match.evidence as any,
        industryMatchedAt: new Date(),
      },
    });
  }

  // Prepopulate from the effective industry (owner-confirmed one if present)
  const effectiveIndustryId = business?.ownerConfirmedIndustry && business.matchedIndustryId
    ? business.matchedIndustryId
    : match.industryId;

  await prepopulateServicesFromIndustry(businessId, effectiveIndustryId, bridgerResearch);

  return match;
}

export interface SeoServiceRecord {
  businessId: string;
  offeringId: string;
  serviceName: string;
  slug: string;
  industry: string | null;
  status: string;
  priority: string;
  shortDescription: string;
  fullDescription: string;
  customerProblem: string;
  commonQuestions: string[];
  commonObjections: string[];
  relatedServices: string[];
  pageStatus: string;
  videoStatus: string;
  source: string;
  confidence: string;
  ownerConfirmed: boolean;
  seoEnabled: boolean;
  recommendedPageTitle: string;
  recommendedMetaDescription: string;
  recommendedH1: string;
  recommendedSchemaType: string;
}

/**
 * Return confirmed services for the SEO agent.
 *
 * By default returns only confirmed, seo-enabled, non do_not_promote services.
 * Pass includeSuggested=true to also surface suggestions (as recommendations).
 */
export async function getConfirmedServicesForSeo(
  businessId: string,
  opts: { includeSuggested?: boolean } = {},
): Promise<SeoServiceRecord[]> {
  const offerings = await prisma.businessServiceOffering.findMany({
    where: {
      businessId,
      status: opts.includeSuggested
        ? { in: ['confirmed', 'suggested', 'needs_review'] }
        : 'confirmed',
    },
    include: { industryService: true, industry: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  return offerings
    // Exclude do_not_promote unless explicitly suggested-mode
    .filter((o) => o.priority !== 'do_not_promote')
    // Exclude SEO-disabled
    .filter((o) => o.seoEnabled)
    .map((o) => {
      const tmpl = o.industryService;
      const name = o.overrideName || o.customServiceName || tmpl?.name || 'Service';
      return {
        businessId,
        offeringId: o.id,
        serviceName: name,
        slug: o.slug,
        industry: o.industry?.name || tmpl?.industryId ? (o.industry?.name ?? null) : null,
        status: o.status,
        priority: o.priority,
        shortDescription: o.overrideShortDescription || tmpl?.shortDescription || '',
        fullDescription: o.overrideFullDescription || tmpl?.fullDescriptionTemplate || '',
        customerProblem: tmpl?.customerProblem || '',
        commonQuestions: (tmpl?.commonQuestions as string[]) || [],
        commonObjections: (tmpl?.commonObjections as string[]) || [],
        relatedServices: (tmpl?.relatedServices as string[]) || [],
        pageStatus: o.pageStatus,
        videoStatus: o.videoStatus,
        source: o.source,
        confidence: o.confidence,
        ownerConfirmed: o.ownerConfirmed,
        seoEnabled: o.seoEnabled,
        recommendedPageTitle: tmpl?.recommendedPageTitle || '',
        recommendedMetaDescription: tmpl?.recommendedMetaDescription || '',
        recommendedH1: tmpl?.recommendedH1 || '',
        recommendedSchemaType: tmpl?.recommendedSchemaType || 'Service',
      };
    });
}

/**
 * Resolve the effective display name for an offering.
 */
export function offeringDisplayName(o: {
  overrideName?: string | null;
  customServiceName?: string | null;
  industryService?: { name?: string | null } | null;
}): string {
  return o.overrideName || o.customServiceName || o.industryService?.name || 'Service';
}
