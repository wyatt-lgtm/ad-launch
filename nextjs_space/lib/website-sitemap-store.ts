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
  serviceDiscoveryCounts,
  canGenerateCopy,
  CopyGateResult,
} from '@/lib/website-sitemap';

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
