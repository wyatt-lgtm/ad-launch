/**
 * Milestone 10 — shared backlink-preservation types (pure).
 */

import type { SitemapPage } from '@/lib/website-sitemap';

export type BacklinkSource =
  | 'gsc'
  | 'provider'
  | 'seo_research'
  | 'site_crawl'
  | 'uploaded_file'
  | 'manual';

export type InventoryStatus =
  | 'pending'
  | 'complete'
  | 'incomplete_provider_missing'
  | 'failed'
  | 'stale';

export type BacklinkUrlStatus = 'active' | 'stale' | 'unknown' | 'ignored';

export type PreservationAction =
  | 'preserve_same_url'
  | 'redirect_301'
  | 'rebuild_page'
  | 'ignore_no_value'
  | 'needs_review';

export type PreservationStatus = 'proposed' | 'approved' | 'rejected' | 'needs_review';

export type BacklinkPriority = 'critical' | 'high' | 'medium' | 'low';

/** A single inventoried existing-site URL that may carry backlink value. */
export interface BacklinkUrlRecord {
  sourceUrl: string;
  targetUrl: string;
  normalizedTargetPath: string;
  referringDomain?: string | null;
  anchorText?: string | null;
  linkType?: string | null;
  authorityScore?: number | null;
  backlinkCount?: number | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  status: BacklinkUrlStatus;
  /** Classified priority (computed, not persisted on the URL row). */
  priority?: BacklinkPriority;
}

/** Full inventory snapshot (safe metadata only — never secrets/signed URLs). */
export interface BacklinkInventory {
  source: BacklinkSource;
  status: InventoryStatus;
  liveDomain: string | null;
  crawledAt: string | null;
  providerCheckedAt: string | null;
  totalBacklinkUrls: number;
  highValueUrlCount: number;
  urls: BacklinkUrlRecord[];
  warnings: string[];
  /** True when external backlink coverage may be incomplete (crawl-only). */
  providerMissing: boolean;
}

/** One URL preservation-mapping decision against a proposed sitemap. */
export interface PreservationMapping {
  oldUrl: string;
  oldPath: string;
  newUrl: string | null;
  newPath: string | null;
  action: PreservationAction;
  confidence: number;
  reason: string;
  contentIntent: string | null;
  matchedPageType: string | null;
  matchedServiceName: string | null;
  status: PreservationStatus;
  priority: BacklinkPriority;
  /** Backlink count carried by the old URL (0 when unknown). */
  backlinkCount: number;
}

/** Per-page metadata attached to a SitemapPage.backlinkPreservation. */
export interface SitemapPageBacklinkPreservation {
  oldUrls: string[];
  backlinkPriority: BacklinkPriority | null;
  preservationAction: PreservationAction | null;
  redirectTarget: string | null;
  needsReview: boolean;
  reason: string | null;
}

/** website_redirect_plan.json shape (durable artifact). */
export interface WebsiteRedirectPlan {
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string | null;
  inventoryId: string | null;
  status: 'draft' | 'proposed' | 'approved' | 'needs_review';
  redirects: {
    from: string;
    to: string;
    statusCode: 301;
    reason: string;
    priority: BacklinkPriority;
    approved: boolean;
  }[];
  preservedUrls: { path: string; reason: string }[];
  ignoredUrls: { path: string; reason: string; priority: BacklinkPriority }[];
  unmappedUrls: { path: string; priority: BacklinkPriority; backlinkCount: number }[];
  summary: {
    totalBacklinkUrls: number;
    preserved: number;
    redirected: number;
    ignored: number;
    unmapped: number;
  };
}

/** A minimal candidate view of a proposed sitemap page for matching. */
export interface SitemapPageCandidate {
  page: SitemapPage;
  path: string;
}
