/**
 * Sitemap-first website generation — persistence layer (Milestone 1).
 *
 * Thin, business-scoped CRUD over the additive models:
 *   WebsiteServiceDiscovery, WebsiteSitemap, WebsiteSitemapRevision.
 *
 * EVERY query is scoped by businessId to prevent cross-business leakage. This
 * module performs NO publishing, NO deployment, NO copy/image generation — it
 * only stores/reads the sitemap-first artifacts.
 */
import { prisma } from '@/lib/db';
import {
  WebsiteSitemapArtifact,
  DiscoveredService,
  SitemapRevisionRecord,
  ServiceCandidate,
  serviceDiscoveryCounts,
  canGenerateCopy,
  CopyGateResult,
} from '@/lib/website-sitemap';
import { offeringDisplayName } from '@/lib/industry-services';

// ── Service discovery ──────────────────────────────────────────────────────
export async function saveServiceDiscovery(params: {
  businessId: string;
  websiteProjectId?: string | null;
  services: DiscoveredService[];
  source?: string;
}) {
  const counts = serviceDiscoveryCounts(params.services);
  return prisma.websiteServiceDiscovery.create({
    data: {
      businessId: params.businessId,
      websiteProjectId: params.websiteProjectId ?? null,
      discoveryJson: { services: params.services } as any,
      confirmedCount: counts.confirmedCount,
      likelyCount: counts.likelyCount,
      needsConfirmationCount: counts.needsConfirmationCount,
      rejectedCount: counts.rejectedCount,
      source: params.source || 'agent_research',
    },
  });
}

/**
 * Seed service CANDIDATES (pre-classification) from the business's existing
 * confirmed/suggested service offerings. READ-ONLY: this never mutates the
 * BusinessServiceOffering records or any other system. Confirmed/owner-confirmed
 * offerings map to explicit positive signals; suggested/needs_review map to
 * industry inference (so they classify as likely/needs_user_confirmation).
 */
export async function seedServiceCandidatesFromOfferings(
  businessId: string,
): Promise<ServiceCandidate[]> {
  const offerings = await prisma.businessServiceOffering.findMany({
    where: { businessId, status: { in: ['confirmed', 'suggested', 'needs_review'] } },
    include: { industryService: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  return offerings.map((o) => {
    const name = offeringDisplayName(o as any);
    const isConfirmed = o.status === 'confirmed' || o.ownerConfirmed === true;
    const fromWebsite = o.source === 'website' || o.source === 'owner_confirmed';
    return {
      serviceName: name,
      source: fromWebsite ? 'website' : 'industry_knowledge',
      evidence: `From service settings (status: ${o.status}, source: ${o.source}).`,
      confidence: o.confidence === 'high' ? 0.9 : o.confidence === 'medium' ? 0.6 : 0.4,
      previouslyApproved: isConfirmed,
      listedOnWebsite: fromWebsite ? true : undefined,
      storedInBusinessSettings: isConfirmed,
      commonForIndustry: !isConfirmed,
      ambiguous: o.status === 'needs_review',
    } as ServiceCandidate;
  });
}

export async function loadLatestServiceDiscovery(businessId: string, websiteProjectId?: string | null) {
  return prisma.websiteServiceDiscovery.findFirst({
    where: { businessId, ...(websiteProjectId ? { websiteProjectId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Sitemap ─────────────────────────────────────────────────────────────
export async function saveSitemap(params: {
  businessId: string;
  websiteProjectId?: string | null;
  sitemap: WebsiteSitemapArtifact;
}) {
  const { businessId, websiteProjectId, sitemap } = params;
  return prisma.websiteSitemap.create({
    data: {
      businessId,
      websiteProjectId: websiteProjectId ?? null,
      approvalStatus: sitemap.approvalStatus,
      businessName: sitemap.businessName,
      industry: sitemap.industry,
      websiteGoal: sitemap.websiteGoal,
      sitemapJson: sitemap as any,
      approvedByUserId: sitemap.approvedBy,
      approvedAt: sitemap.approvedAt ? new Date(sitemap.approvedAt) : null,
    },
  });
}

export async function loadLatestSitemap(businessId: string, websiteProjectId?: string | null) {
  return prisma.websiteSitemap.findFirst({
    where: { businessId, ...(websiteProjectId ? { websiteProjectId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Load a sitemap by id, scoped to the business. Returns null when the sitemap
 * does not belong to the business (prevents cross-business access).
 */
export async function loadSitemapById(businessId: string, sitemapId: string) {
  return prisma.websiteSitemap.findFirst({ where: { id: sitemapId, businessId } });
}

export async function updateSitemapArtifact(params: {
  businessId: string;
  sitemapId: string;
  sitemap: WebsiteSitemapArtifact;
}) {
  // updateMany keeps the businessId scope in the WHERE clause (no cross-business writes).
  return prisma.websiteSitemap.updateMany({
    where: { id: params.sitemapId, businessId: params.businessId },
    data: {
      approvalStatus: params.sitemap.approvalStatus,
      sitemapJson: params.sitemap as any,
      approvedByUserId: params.sitemap.approvedBy,
      approvedAt: params.sitemap.approvedAt ? new Date(params.sitemap.approvedAt) : null,
    },
  });
}

// ── Revisions ─────────────────────────────────────────────────────────
export async function saveSitemapRevision(params: {
  businessId: string;
  sitemapId: string;
  revision: SitemapRevisionRecord;
}) {
  const { businessId, sitemapId, revision } = params;
  // Guard: only write a revision when the sitemap belongs to this business.
  const owned = await prisma.websiteSitemap.findFirst({ where: { id: sitemapId, businessId }, select: { id: true } });
  if (!owned) return null;
  return prisma.websiteSitemapRevision.create({
    data: {
      businessId,
      sitemapId,
      action: revision.action,
      detailJson: revision as any,
      pageTitle: revision.page?.title,
      pageSlug: revision.page?.slug,
      pageType: revision.page?.pageType,
      pageSource: revision.page?.source ?? null,
      requestedByUserId: revision.requestedByUserId ?? null,
    },
  });
}

export async function listSitemapRevisions(businessId: string, sitemapId: string) {
  return prisma.websiteSitemapRevision.findMany({
    where: { businessId, sitemapId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Generic, business-scoped revision recorder for actions beyond `add_page`
 * (rename_page, remove_page, reorder_page, add_section, remove_section,
 * confirm_services, approve, other). Guards ownership before writing so a
 * revision can never be attached to another business's sitemap.
 */
export async function recordRevision(params: {
  businessId: string;
  sitemapId: string;
  action: string;
  detail?: any;
  page?: { title?: string; slug?: string; pageType?: string; source?: string | null };
  requestedByUserId?: string | null;
}) {
  const { businessId, sitemapId, action, detail, page, requestedByUserId } = params;
  const owned = await prisma.websiteSitemap.findFirst({
    where: { id: sitemapId, businessId },
    select: { id: true },
  });
  if (!owned) return null;
  return prisma.websiteSitemapRevision.create({
    data: {
      businessId,
      sitemapId,
      action,
      detailJson: (detail ?? null) as any,
      pageTitle: page?.title ?? null,
      pageSlug: page?.slug ?? null,
      pageType: page?.pageType ?? null,
      pageSource: page?.source ?? null,
      requestedByUserId: requestedByUserId ?? null,
    },
  });
}

// ── Copy gate (persistence-aware) ────────────────────────────────────────
/**
 * Resolve the copy gate from stored state for a business/project. Loads the
 * latest sitemap and runs the pure gate against its artifact.
 */
export async function resolveCopyGate(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<CopyGateResult> {
  const row = await loadLatestSitemap(businessId, websiteProjectId);
  if (!row) return canGenerateCopy(null);
  const artifact = row.sitemapJson as unknown as WebsiteSitemapArtifact;
  return canGenerateCopy(artifact);
}

// ── Sitemap generation input (business-scoped, read-only) ────────────────
/**
 * Assemble a SitemapGenerationInput from stored business identity + the latest
 * service discovery. READ-ONLY: reads Business, Industry, and the latest
 * WebsiteServiceDiscovery. Performs NO network calls, NO copy/image work.
 *
 * Returns null when the business does not exist.
 */
export async function buildSitemapGenerationInput(
  businessId: string,
): Promise<import('@/lib/website-sitemap').SitemapGenerationInput | null> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return null;

  let industryName = '';
  if (business.matchedIndustryId) {
    const ind = await prisma.industry.findUnique({ where: { id: business.matchedIndustryId } });
    industryName = ind?.name || '';
  }

  const city =
    business.businessCity || business.primaryMarketCity || business.hqCity || '';
  const state =
    business.businessState || business.primaryMarketState || business.hqState || '';

  const mode = (['local', 'regional', 'national', 'multi_location'].includes(
    business.serviceAreaMode || '',
  )
    ? business.serviceAreaMode
    : 'local') as WebsiteSitemapArtifact['serviceAreaMode'];

  const discovery = await loadLatestServiceDiscovery(businessId);
  const services: DiscoveredService[] =
    (discovery?.discoveryJson as any)?.services ?? [];

  return {
    businessName: business.businessName || 'Your Business',
    industry: industryName || 'Local Business',
    primaryServiceArea: { city, state },
    serviceAreaMode: mode,
    services,
    sourceSummary: {
      website: Boolean(business.websiteUrl),
      businessSettings: true,
      agentResearch: Boolean(discovery),
    },
  };
}
