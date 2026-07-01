/**
 * Milestone 6 — resolve the sitemap-first build inputs for a business.
 *
 * A static build consumes the sitemap-first artifacts produced in M1-M5:
 *   1. an APPROVED WebsiteSitemap        (the page tree + authoritative H1s)
 *   2. WebsitePageCopy rows              (draft/approved per-page copy)
 *   3. a WebsiteImageBrief set           (the image specifications)
 *   4. WebsiteGeneratedImageAsset rows   (approved/generated hero/section imgs)
 *
 * This module is READ-ONLY: it loads + parses those records and resolves the
 * "best" image per (page, section). It performs NO generation, NO upload, NO
 * publish and NO deploy. It never returns a signed URL or any credential.
 */

import { prisma } from '@/lib/db';
import { loadLatestSitemap } from '@/lib/website-sitemap-store';
import {
  type WebsiteSitemapArtifact,
  type SitemapPage,
  isValidServiceDetailH1,
} from '@/lib/website-sitemap';
import { isPageEligibleForCopy } from '@/lib/website-copy';
import type { PageCopy } from '@/lib/website-copy';
import { isDurableR2Reference, isSignedUrl } from '@/lib/website-image-generation';

/** Image asset statuses that are usable in a static build. */
export const USABLE_IMAGE_STATUSES = ['approved', 'ready_for_review', 'generated'] as const;
/** Image asset statuses that must NEVER be shipped. */
export const BLOCKED_IMAGE_STATUSES = ['failed', 'qa_failed', 'rejected', 'archived'] as const;

const IMAGE_STATUS_RANK: Record<string, number> = {
  approved: 3,
  ready_for_review: 2,
  generated: 1,
};

export interface ResolvedImageAsset {
  id: string;
  pageSlug: string;
  sectionName: string;
  sectionType: string;
  assetRole: string;
  status: string;
  r2Bucket: string | null;
  r2Key: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  imageBriefSetId: string | null;
  sitemapId: string | null;
  copyArtifactId: string | null;
  /** True only for a usable status + durable (non-signed) R2 bucket+key. */
  durable: boolean;
}

export interface ResolvedCopyRow {
  id: string;
  slug: string;
  pageType: string;
  status: string;
  h1: string | null;
  copy: PageCopy | null;
}

export interface ResolvedBusiness {
  id: string;
  businessName: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  businessPhone: string | null;
  serviceAreaMode: string | null;
  primaryMarketCity: string | null;
  primaryMarketState: string | null;
  defaultGhlUserEmail: string | null;
  forbiddenBrandTerms: string[];
}

export interface ResolvedBuildInputs {
  business: ResolvedBusiness | null;
  websiteProjectId: string | null;
  sitemapId: string | null;
  sitemapApproved: boolean;
  sitemap: WebsiteSitemapArtifact | null;
  /** Pages that should be built (eligible, non-rejected), in sitemap order. */
  buildablePages: SitemapPage[];
  copyRows: ResolvedCopyRow[];
  copyBySlug: Map<string, ResolvedCopyRow>;
  briefSet: { id: string; status: string; sitemapId: string; copyArtifactId: string } | null;
  images: ResolvedImageAsset[];
  /** Best usable hero asset per page slug. */
  heroBySlug: Map<string, ResolvedImageAsset>;
  /** Best usable section asset per `${slug}::${sectionNameLower}`. */
  sectionAssetByKey: Map<string, ResolvedImageAsset>;
}

export function sectionAssetKey(slug: string, sectionName: string): string {
  return `${slug}::${(sectionName || '').trim().toLowerCase()}`;
}

/** A page requires a hero image when it is a content page (all eligible pages). */
export function pageRequiresHero(page: SitemapPage): boolean {
  return isPageEligibleForCopy(page) && page.confirmationStatus !== 'rejected';
}

function rankStatus(status: string): number {
  return IMAGE_STATUS_RANK[status] ?? 0;
}

/**
 * Load + resolve every artifact needed to build (or gate) a static site.
 */
export async function resolveSitemapBuildInputs(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<ResolvedBuildInputs> {
  const business = (await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      businessName: true,
      businessCity: true,
      businessState: true,
      businessZip: true,
      businessPhone: true,
      serviceAreaMode: true,
      primaryMarketCity: true,
      primaryMarketState: true,
      defaultGhlUserEmail: true,
      forbiddenBrandTerms: true,
    },
  })) as ResolvedBusiness | null;

  const sitemapRow = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const sitemapApproved = sitemapRow?.approvalStatus === 'approved';
  const resolvedProjectId =
    websiteProjectId || sitemapRow?.websiteProjectId || null;

  const buildablePages: SitemapPage[] = sitemap
    ? [...sitemap.pages]
        .filter((p) => pageRequiresHero(p) || isPageEligibleForCopy(p))
        .filter((p) => p.confirmationStatus !== 'rejected')
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    : [];

  // Copy rows (latest per slug) scoped to the approved sitemap.
  const copyRowsRaw = sitemapRow
    ? await prisma.websitePageCopy.findMany({
        where: { businessId, sitemapId: sitemapRow.id },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  const copyBySlug = new Map<string, ResolvedCopyRow>();
  for (const row of copyRowsRaw) {
    if (copyBySlug.has(row.slug)) continue;
    copyBySlug.set(row.slug, {
      id: row.id,
      slug: row.slug,
      pageType: row.pageType,
      status: row.status,
      h1: row.h1,
      copy: (row.copyJson as unknown as PageCopy) || null,
    });
  }
  const copyRows = [...copyBySlug.values()];

  // Latest brief set for this sitemap.
  const briefRow = sitemapRow
    ? await prisma.websiteImageBrief.findFirst({
        where: { businessId, sitemapId: sitemapRow.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, sitemapId: true, copyArtifactId: true },
      })
    : null;

  // Generated image assets for this sitemap.
  const imageRows = sitemapRow
    ? await prisma.websiteGeneratedImageAsset.findMany({
        where: { businessId, sitemapId: sitemapRow.id },
        orderBy: { createdAt: 'desc' },
        take: 500,
      })
    : [];

  const images: ResolvedImageAsset[] = imageRows.map((r) => {
    const usableStatus = (USABLE_IMAGE_STATUSES as readonly string[]).includes(r.status);
    const durable =
      usableStatus &&
      isDurableR2Reference(r.r2Bucket, r.r2Key) &&
      !isSignedUrl(r.r2Key);
    return {
      id: r.id,
      pageSlug: r.pageSlug,
      sectionName: r.sectionName,
      sectionType: r.sectionType,
      assetRole: r.assetRole,
      status: r.status,
      r2Bucket: r.r2Bucket,
      r2Key: r.r2Key,
      mimeType: r.mimeType,
      width: r.width,
      height: r.height,
      altText: r.altText,
      imageBriefSetId: r.imageBriefSetId,
      sitemapId: r.sitemapId,
      copyArtifactId: r.copyArtifactId,
      durable,
    };
  });

  // Best usable hero per slug + best usable section asset per (slug, section).
  const heroBySlug = new Map<string, ResolvedImageAsset>();
  const sectionAssetByKey = new Map<string, ResolvedImageAsset>();
  for (const img of images) {
    if (!img.durable) continue;
    if (img.assetRole === 'hero_image' || img.sectionType === 'hero') {
      const cur = heroBySlug.get(img.pageSlug);
      if (!cur || rankStatus(img.status) > rankStatus(cur.status)) {
        heroBySlug.set(img.pageSlug, img);
      }
    } else {
      const key = sectionAssetKey(img.pageSlug, img.sectionName);
      const cur = sectionAssetByKey.get(key);
      if (!cur || rankStatus(img.status) > rankStatus(cur.status)) {
        sectionAssetByKey.set(key, img);
      }
    }
  }

  return {
    business,
    websiteProjectId: resolvedProjectId,
    sitemapId: sitemapRow?.id ?? null,
    sitemapApproved,
    sitemap,
    buildablePages,
    copyRows,
    copyBySlug,
    briefSet: briefRow
      ? {
          id: briefRow.id,
          status: briefRow.status,
          sitemapId: briefRow.sitemapId,
          copyArtifactId: briefRow.copyArtifactId,
        }
      : null,
    images,
    heroBySlug,
    sectionAssetByKey,
  };
}

/** Re-export for gate/validation modules. */
export { isValidServiceDetailH1 };
