/**
 * Milestone 10 — backlink preservation persistence (business-scoped).
 *
 * All reads/writes are scoped to a businessId. Never stores secrets, tokens, or
 * signed URLs. Never deploys/publishes. Redirect plan artifacts are computed
 * from the durable preservation-map rows.
 */

import { prisma } from '@/lib/db';
import { loadLatestSitemap, loadSitemapById, updateSitemapArtifact } from '@/lib/website-sitemap-store';
import type { WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { mapInventory, contentIntentSimilarity } from '@/lib/site-backlinks/mapping';
import { buildRedirectPlan, buildPagePreservationMap } from '@/lib/site-backlinks/redirect-plan';
import { normalizePath } from '@/lib/site-backlinks/url-normalize';
import type {
  BacklinkInventory,
  BacklinkUrlRecord,
  PreservationMapping,
  WebsiteRedirectPlan,
} from '@/lib/site-backlinks/types';

export interface SaveInventoryArgs {
  businessId: string;
  websiteProjectId?: string | null;
  inventory: BacklinkInventory;
}

/** Persist an inventory snapshot + its URL rows. Returns the inventory id. */
export async function saveInventory(args: SaveInventoryArgs): Promise<{ id: string }> {
  const { businessId, inventory } = args;
  const row = await prisma.websiteBacklinkInventory.create({
    data: {
      businessId,
      websiteProjectId: args.websiteProjectId || null,
      source: inventory.source,
      status: inventory.status,
      liveDomain: inventory.liveDomain,
      crawledAt: inventory.crawledAt ? new Date(inventory.crawledAt) : null,
      providerCheckedAt: inventory.providerCheckedAt ? new Date(inventory.providerCheckedAt) : null,
      totalBacklinkUrls: inventory.totalBacklinkUrls,
      highValueUrlCount: inventory.highValueUrlCount,
      inventoryJson: inventory as any,
      warningsJson: inventory.warnings as any,
    },
    select: { id: true },
  });

  if (inventory.urls.length) {
    await prisma.websiteBacklinkUrl.createMany({
      data: inventory.urls.slice(0, 500).map((u) => ({
        businessId,
        inventoryId: row.id,
        sourceUrl: u.sourceUrl,
        targetUrl: u.targetUrl,
        normalizedTargetPath: u.normalizedTargetPath,
        referringDomain: u.referringDomain || null,
        anchorText: u.anchorText || null,
        linkType: u.linkType || null,
        authorityScore: u.authorityScore ?? null,
        backlinkCount: u.backlinkCount ?? null,
        firstSeenAt: u.firstSeenAt ? new Date(u.firstSeenAt) : null,
        lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt) : null,
        status: u.status,
      })),
    });
  }
  return row;
}

export interface LoadedInventory {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  source: string;
  status: string;
  liveDomain: string | null;
  crawledAt: Date | null;
  providerCheckedAt: Date | null;
  totalBacklinkUrls: number;
  highValueUrlCount: number;
  inventory: BacklinkInventory | null;
  urls: BacklinkUrlRecord[];
  createdAt: Date;
}

/** Load the latest inventory for a business (+ its URL rows). */
export async function loadLatestInventory(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<LoadedInventory | null> {
  const row = await prisma.websiteBacklinkInventory.findFirst({
    where: { businessId, ...(websiteProjectId ? { websiteProjectId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  const urlRows = await prisma.websiteBacklinkUrl.findMany({
    where: { businessId, inventoryId: row.id },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  const inventory = (row.inventoryJson as unknown as BacklinkInventory) || null;
  return {
    id: row.id,
    businessId: row.businessId,
    websiteProjectId: row.websiteProjectId,
    source: row.source,
    status: row.status,
    liveDomain: row.liveDomain,
    crawledAt: row.crawledAt,
    providerCheckedAt: row.providerCheckedAt,
    totalBacklinkUrls: row.totalBacklinkUrls,
    highValueUrlCount: row.highValueUrlCount,
    inventory,
    urls: urlRows.map((u) => ({
      sourceUrl: u.sourceUrl,
      targetUrl: u.targetUrl,
      normalizedTargetPath: u.normalizedTargetPath,
      referringDomain: u.referringDomain,
      anchorText: u.anchorText,
      linkType: u.linkType,
      authorityScore: u.authorityScore,
      backlinkCount: u.backlinkCount,
      firstSeenAt: u.firstSeenAt ? u.firstSeenAt.toISOString() : null,
      lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
      status: u.status as BacklinkUrlRecord['status'],
    })),
    createdAt: row.createdAt,
  };
}

/**
 * Generate + persist preservation mappings for the latest (or given) sitemap.
 * Replaces any prior proposed maps for the same sitemap+inventory. Returns the
 * mappings + the sitemap id used.
 */
export async function generateAndSaveMappings(args: {
  businessId: string;
  websiteProjectId?: string | null;
  sitemapId?: string | null;
  newSiteBaseUrl?: string | null;
}): Promise<{ mappings: PreservationMapping[]; sitemapId: string | null; inventoryId: string | null }> {
  const inv = await loadLatestInventory(args.businessId, args.websiteProjectId);
  const sitemapRow = args.sitemapId
    ? await loadSitemapById(args.businessId, args.sitemapId)
    : await loadLatestSitemap(args.businessId, args.websiteProjectId);
  if (!sitemapRow || !inv) {
    return { mappings: [], sitemapId: sitemapRow?.id || null, inventoryId: inv?.id || null };
  }
  const sitemap = sitemapRow.sitemapJson as unknown as WebsiteSitemapArtifact;
  const mappings = mapInventory(inv.urls.map((u) => ({ ...u })), sitemap, {
    newSiteBaseUrl: args.newSiteBaseUrl || null,
  });

  // Persist: clear prior proposed/needs_review rows for this sitemap, re-create.
  await prisma.websiteUrlPreservationMap.deleteMany({
    where: {
      businessId: args.businessId,
      sitemapId: sitemapRow.id,
      status: { in: ['proposed', 'needs_review'] },
    },
  });
  if (mappings.length) {
    await prisma.websiteUrlPreservationMap.createMany({
      data: mappings.map((m) => ({
        businessId: args.businessId,
        websiteProjectId: args.websiteProjectId || sitemapRow.websiteProjectId || null,
        sitemapId: sitemapRow.id,
        inventoryId: inv.id,
        oldUrl: m.oldUrl,
        oldPath: m.oldPath,
        newUrl: m.newUrl,
        newPath: m.newPath,
        action: m.action,
        confidence: m.confidence,
        reason: m.reason,
        contentIntent: m.contentIntent,
        matchedPageType: m.matchedPageType,
        matchedServiceName: m.matchedServiceName,
        status: m.status,
      })),
    });
  }

  // Merge per-page backlinkPreservation metadata into the sitemap artifact so
  // the Sitemap Review UI can show backlink impact per page. Additive only.
  try {
    const pageMeta = buildPagePreservationMap(mappings);
    if (pageMeta.size) {
      const pages = sitemap.pages.map((p) => {
        const meta = pageMeta.get(normalizePath(p.slug));
        return meta ? { ...p, backlinkPreservation: meta } : p;
      });
      await updateSitemapArtifact({
        businessId: args.businessId,
        sitemapId: sitemapRow.id,
        sitemap: { ...sitemap, pages },
      });
    }
  } catch {
    // Non-fatal: durable mapping rows are the source of truth.
  }

  return { mappings, sitemapId: sitemapRow.id, inventoryId: inv.id };
}

export interface LoadedMapping extends PreservationMapping {
  id: string;
  sitemapId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
}

/** Load persisted preservation mappings for a business (latest sitemap). */
export async function loadMappings(
  businessId: string,
  sitemapId?: string | null,
): Promise<LoadedMapping[]> {
  const rows = await prisma.websiteUrlPreservationMap.findMany({
    where: { businessId, ...(sitemapId ? { sitemapId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    sitemapId: r.sitemapId,
    oldUrl: r.oldUrl,
    oldPath: r.oldPath,
    newUrl: r.newUrl,
    newPath: r.newPath,
    action: r.action as PreservationMapping['action'],
    confidence: r.confidence,
    reason: r.reason || '',
    contentIntent: r.contentIntent,
    matchedPageType: r.matchedPageType,
    matchedServiceName: r.matchedServiceName,
    status: r.status as PreservationMapping['status'],
    priority: 'medium',
    backlinkCount: 0,
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt,
  }));
}

/**
 * Load mappings enriched with priority + backlink count from the latest
 * inventory. Used by the static-build gate and readiness gate so high-value
 * classification is accurate (loadMappings alone defaults priority to medium).
 */
export async function loadEnrichedMappings(
  businessId: string,
  websiteProjectId?: string | null,
  sitemapId?: string | null,
): Promise<PreservationMapping[]> {
  const inv = await loadLatestInventory(businessId, websiteProjectId);
  const resolvedSitemapId =
    sitemapId || (await loadLatestSitemap(businessId, websiteProjectId))?.id || null;
  const maps = await loadMappings(businessId, resolvedSitemapId);
  const byPath = new Map<string, BacklinkUrlRecord>();
  if (inv) for (const u of inv.urls) byPath.set(u.normalizedTargetPath, u);
  return maps.map((m) => {
    const u = byPath.get(m.oldPath);
    return {
      ...m,
      priority: (u?.priority as PreservationMapping['priority']) || m.priority,
      backlinkCount: u?.backlinkCount ?? 0,
    };
  });
}

/** Update a single mapping (edit target / action / mark ignored w/ reason). */
export async function updateMapping(args: {
  businessId: string;
  mappingId: string;
  action?: PreservationMapping['action'];
  newPath?: string | null;
  newUrl?: string | null;
  reason?: string | null;
  status?: PreservationMapping['status'];
}): Promise<{ ok: boolean; notFound?: boolean }> {
  const existing = await prisma.websiteUrlPreservationMap.findFirst({
    where: { id: args.mappingId, businessId: args.businessId },
    select: { id: true },
  });
  if (!existing) return { ok: false, notFound: true };
  await prisma.websiteUrlPreservationMap.update({
    where: { id: existing.id },
    data: {
      ...(args.action ? { action: args.action } : {}),
      ...(args.newPath !== undefined ? { newPath: args.newPath } : {}),
      ...(args.newUrl !== undefined ? { newUrl: args.newUrl } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      ...(args.status ? { status: args.status } : {}),
    },
  });
  return { ok: true };
}

/**
 * Approve the redirect plan: mark all non-rejected mappings approved. This is a
 * READINESS decision only — it does NOT deploy redirects or mutate live DNS.
 */
export async function approveRedirectPlan(args: {
  businessId: string;
  sitemapId?: string | null;
  approvedByUserId: string;
}): Promise<{ approved: number }> {
  const now = new Date();
  const res = await prisma.websiteUrlPreservationMap.updateMany({
    where: {
      businessId: args.businessId,
      ...(args.sitemapId ? { sitemapId: args.sitemapId } : {}),
      status: { in: ['proposed'] },
    },
    data: { status: 'approved', approvedByUserId: args.approvedByUserId, approvedAt: now },
  });
  return { approved: res.count };
}

/** Compute the durable redirect-plan artifact from persisted mappings. */
export async function loadRedirectPlan(
  businessId: string,
  websiteProjectId?: string | null,
  sitemapId?: string | null,
): Promise<WebsiteRedirectPlan | null> {
  const inv = await loadLatestInventory(businessId, websiteProjectId);
  const resolvedSitemapId =
    sitemapId || (await loadLatestSitemap(businessId, websiteProjectId))?.id || null;
  const maps = await loadMappings(businessId, resolvedSitemapId);
  if (!maps.length) return null;

  // Enrich mappings with priority + backlink count from the inventory.
  const byPath = new Map<string, BacklinkUrlRecord>();
  if (inv) for (const u of inv.urls) byPath.set(u.normalizedTargetPath, u);
  const enriched: PreservationMapping[] = maps.map((m) => {
    const u = byPath.get(m.oldPath);
    return {
      ...m,
      priority: (u?.priority as PreservationMapping['priority']) || m.priority,
      backlinkCount: u?.backlinkCount ?? 0,
    };
  });

  const approvedPaths = new Set(maps.filter((m) => m.status === 'approved').map((m) => m.oldPath));
  const anyApproved = approvedPaths.size > 0;
  const anyNeedsReview = maps.some((m) => m.status === 'needs_review');
  const status: WebsiteRedirectPlan['status'] = anyApproved
    ? 'approved'
    : anyNeedsReview
      ? 'needs_review'
      : 'proposed';

  return buildRedirectPlan({
    businessId,
    websiteProjectId: websiteProjectId || inv?.websiteProjectId || null,
    sitemapId: resolvedSitemapId,
    inventoryId: inv?.id || null,
    mappings: enriched,
    approvedPaths,
    status,
  });
}

export { contentIntentSimilarity };
