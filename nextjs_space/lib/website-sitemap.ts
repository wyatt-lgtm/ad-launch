/**
 * Sitemap-first website generation — pure logic (Milestone 1).
 *
 * This module is intentionally DEPENDENCY-FREE and NETWORK-FREE. It contains no
 * imports of prisma, fetch, or any deploy/publish helper. Persistence lives in
 * `lib/website-sitemap-store.ts`.
 *
 * Responsibilities:
 *   - Classify discovered services (confirmed / likely / needs_user_confirmation / rejected).
 *   - Generate a hub-and-spoke `website_sitemap.json` from CONFIRMED services only.
 *   - Build + validate H1s (service detail, parent hub, home, location).
 *   - Handle user-requested pages (stored as `user_requested`, never a default).
 *   - Enforce the hard gate: copy generation is blocked until the sitemap exists
 *     AND its approvalStatus === 'approved'.
 *
 * SAFETY INVARIANTS (Milestone 1):
 *   - No Google scraping. No browser automation. No network calls whatsoever.
 *   - No publishing. No deployment. No image generation. No copy generation.
 *   - Example marketing pages (SEO, Paid Ads, GMB, Launch CRM, comparisons, …)
 *     are NEVER added by default — only confirmed services or explicit
 *     user-requested pages become pages.
 *   - Everything is business-scoped; this module never mixes businesses.
 */

// ── Enums / literal unions ──────────────────────────────────────────────────
export type ConfirmationStatus =
  | 'confirmed'
  | 'likely'
  | 'needs_user_confirmation'
  | 'rejected';

export type ServiceSource =
  | 'website'
  | 'google_business_profile'
  | 'industry_knowledge'
  | 'user'
  | 'uploaded_file'
  | 'agent_research'
  | 'search_intelligence'
  | 'business_settings';

export type PageType =
  | 'home'
  | 'service_hub'
  | 'service_detail'
  | 'location'
  | 'comparison'
  | 'custom'
  | 'other';

export type ApprovalStatus =
  | 'draft'
  | 'pending_user_review'
  | 'approved'
  | 'rejected';

// ── Service discovery ───────────────────────────────────────────────────────

/** Raw candidate service, before classification. */
export interface ServiceCandidate {
  serviceName: string;
  source: ServiceSource;
  evidence?: string;
  confidence?: number;
  // Explicit signals that drive deterministic classification:
  userSelected?: boolean;        // user checked "offered"
  userRejected?: boolean;        // user checked "not offered" / removed
  notOffered?: boolean;          // explicitly marked not offered
  previouslyApproved?: boolean;  // in a prior approved sitemap/discovery
  previouslyRemoved?: boolean;   // removed from a prior sitemap
  listedOnWebsite?: boolean;     // appears on customer's own service page
  storedInBusinessSettings?: boolean; // stored as an offered service
  statedInUploadedFile?: boolean;
  commonForIndustry?: boolean;   // industry-standard service
  appearsWeaklyInResearch?: boolean;
  inferredFromRelated?: boolean;
  fromCompetitorOnly?: boolean;  // seen only on competitor content
  broadIndustryInference?: boolean;
  ambiguous?: boolean;
}

/** A classified service. */
export interface DiscoveredService {
  serviceName: string;
  slug: string;
  confirmationStatus: ConfirmationStatus;
  source: ServiceSource;
  evidence: string;
  confidence: number;
}

// ── Sitemap artifact shapes ─────────────────────────────────────────────────
export interface PrimaryServiceArea {
  city?: string;
  state?: string;
  region?: string;
  county?: string;
}

export interface SitemapPage {
  title: string;
  slug: string;
  pageType: PageType;
  h1: string;
  purpose?: string;
  sections: string[];
  parentSlug?: string;
  childPages?: string[];
  serviceName?: string;
  confirmationStatus?: ConfirmationStatus;
  /** 'user_requested' for pages added by the user; undefined for generated pages. */
  source?: 'user_requested';
  status?: string;
  requestedByUserId?: string;
  requestedAt?: string;
  approvalStatus: ApprovalStatus;
  sortOrder: number;
  /**
   * Milestone 10 — backlink-preservation metadata attached when the existing
   * site's backlinked URLs are mapped against this sitemap. Additive/optional;
   * absent for sitemaps generated before backlink mapping runs.
   */
  backlinkPreservation?: {
    oldUrls: string[];
    backlinkPriority: 'critical' | 'high' | 'medium' | 'low' | null;
    preservationAction:
      | 'preserve_same_url'
      | 'redirect_301'
      | 'rebuild_page'
      | 'ignore_no_value'
      | 'needs_review'
      | null;
    redirectTarget: string | null;
    needsReview: boolean;
    reason: string | null;
  };
}

export interface UserRequestedPage {
  title: string;
  slug: string;
  pageType: PageType;
  status: 'added_by_user';
  source: 'user_requested';
  requestedAt: string;
  requestedByUserId?: string;
}

export interface WebsiteSitemapArtifact {
  businessName: string;
  industry: string;
  primaryServiceArea: PrimaryServiceArea;
  websiteGoal: string;
  serviceAreaMode: 'local' | 'regional' | 'national' | 'multi_location';
  sourceSummary: {
    website: boolean;
    businessSettings: boolean;
    uploadedFiles: boolean;
    searchIntelligence: boolean;
    agentResearch: boolean;
  };
  serviceDiscovery: DiscoveredService[];
  pages: SitemapPage[];
  userRequestedPages: UserRequestedPage[];
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
}

// ── Slug helpers ────────────────────────────────────────────────────────────
export function slugifyServiceName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'service';
}

export function serviceDetailSlug(serviceName: string): string {
  return `/services/${slugifyServiceName(serviceName)}`;
}

// ── Service area formatting ─────────────────────────────────────────────────
/**
 * Canonical human-facing service-area label. For local businesses we ALWAYS
 * prefer `City, State` (e.g. "Houston, Texas") even when a finer region is
 * known, matching the H1 spec. Region/county are only used as a fallback when
 * no city is available. Returns null for national (no local area).
 */
export function formatServiceArea(
  area: PrimaryServiceArea,
  mode: WebsiteSitemapArtifact['serviceAreaMode'] = 'local',
): string | null {
  if (mode === 'national') return null;
  const state = (area?.state || '').trim();
  const city = (area?.city || '').trim();
  const region = (area?.region || '').trim();
  const county = (area?.county || '').trim();
  if (city && state) return `${city}, ${state}`;
  if (region && state) return `${region}, ${state}`;
  if (county && state) return `${county}, ${state}`;
  if (city) return city;
  if (region) return region;
  if (county) return county;
  return state || null;
}

// ── H1 builders ─────────────────────────────────────────────────────────────
/** Service detail page H1: `{Service} in {City}, {State}` (or national variant). */
export function buildServiceDetailH1(
  serviceName: string,
  area: PrimaryServiceArea,
  opts?: { mode?: WebsiteSitemapArtifact['serviceAreaMode']; targetAudience?: string },
): string {
  const mode = opts?.mode || 'local';
  if (mode === 'national') {
    const audience = (opts?.targetAudience || '').trim();
    return audience ? `${serviceName} for ${audience}` : serviceName;
  }
  const label = formatServiceArea(area, mode);
  return label ? `${serviceName} in ${label}` : serviceName;
}

/** Parent services hub H1: `{Business Category} Services in {City}, {State}`. */
export function buildParentServicesH1(
  serviceCategory: string,
  area: PrimaryServiceArea,
  opts?: { mode?: WebsiteSitemapArtifact['serviceAreaMode'] },
): string {
  const mode = opts?.mode || 'local';
  const label = formatServiceArea(area, mode);
  const category = (serviceCategory || 'Our').trim();
  return label ? `${category} Services in ${label}` : `${category} Services`;
}

/** Home page H1: `Trusted {Business Type} in {City}, {State}`. */
export function buildHomeH1(
  businessType: string,
  area: PrimaryServiceArea,
  opts?: { mode?: WebsiteSitemapArtifact['serviceAreaMode'] },
): string {
  const mode = opts?.mode || 'local';
  const label = formatServiceArea(area, mode);
  const type = (businessType || 'Local Business').trim();
  return label ? `Trusted ${type} in ${label}` : `Trusted ${type}`;
}

/** Location page H1: `{Business Category} in {City}, {State}`. */
export function buildLocationH1(
  businessCategory: string,
  city: string,
  state: string,
): string {
  const cat = (businessCategory || 'Local Business').trim();
  if (city && state) return `${cat} in ${city}, ${state}`;
  if (city) return `${cat} in ${city}`;
  return cat;
}

// ── H1 validation ───────────────────────────────────────────────────────────
const INVALID_SERVICE_H1_PATTERNS: RegExp[] = [
  /^our services$/i,
  /^expert repairs$/i,
  /^reliable/i,
  /^quality service/i,
  /^professional/i,
];

export interface H1Issue {
  slug: string;
  pageType: PageType;
  h1: string;
  reason: string;
}

/**
 * Validate that a service-detail H1 follows the `{Service} in {Area}` (or
 * national `{Service} for {Audience}`) format and is not a generic slogan.
 */
export function isValidServiceDetailH1(
  h1: string,
  serviceName: string,
  area: PrimaryServiceArea,
  opts?: { mode?: WebsiteSitemapArtifact['serviceAreaMode']; targetAudience?: string },
): boolean {
  if (!h1 || !h1.trim()) return false;
  for (const pat of INVALID_SERVICE_H1_PATTERNS) {
    if (pat.test(h1.trim())) return false;
  }
  const mode = opts?.mode || 'local';
  // Must include the service name.
  if (!h1.toLowerCase().includes((serviceName || '').toLowerCase())) return false;
  if (mode === 'national') {
    return / for /i.test(h1);
  }
  const label = formatServiceArea(area, mode);
  if (!label) return / for /i.test(h1) || / in /i.test(h1);
  return h1.toLowerCase().includes(label.toLowerCase()) && / in /i.test(h1);
}

/** Full-sitemap H1 validation. Returns an empty array when all H1s are valid. */
export function validateSitemapH1s(sitemap: WebsiteSitemapArtifact): H1Issue[] {
  const issues: H1Issue[] = [];
  const mode = sitemap.serviceAreaMode;
  for (const page of sitemap.pages) {
    if (!page.h1 || !page.h1.trim()) {
      issues.push({ slug: page.slug, pageType: page.pageType, h1: page.h1 || '', reason: 'missing_h1' });
      continue;
    }
    if (page.pageType === 'service_detail') {
      const ok = isValidServiceDetailH1(page.h1, page.serviceName || '', sitemap.primaryServiceArea, { mode });
      if (!ok) {
        issues.push({ slug: page.slug, pageType: page.pageType, h1: page.h1, reason: 'service_h1_must_be_service_plus_area' });
      }
    } else if (page.pageType === 'service_hub') {
      // Parent hub H1 must include the service area (category + area).
      const label = formatServiceArea(sitemap.primaryServiceArea, mode);
      if (label && !page.h1.toLowerCase().includes(label.toLowerCase())) {
        issues.push({ slug: page.slug, pageType: page.pageType, h1: page.h1, reason: 'hub_h1_must_include_category_and_area' });
      }
    }
  }
  return issues;
}

// ── Service classification ──────────────────────────────────────────────────
const DEFAULT_CONFIDENCE: Record<ConfirmationStatus, number> = {
  confirmed: 0.95,
  likely: 0.7,
  needs_user_confirmation: 0.55,
  rejected: 0.1,
};

/**
 * Classify a single candidate service. Deterministic and driven by explicit
 * signals so behaviour is predictable and testable.
 *
 * Precedence: rejected → confirmed → needs_user_confirmation → likely →
 * (default) needs_user_confirmation.
 */
export function classifyService(candidate: ServiceCandidate): DiscoveredService {
  const slug = serviceDetailSlug(candidate.serviceName);
  const base = {
    serviceName: candidate.serviceName,
    slug,
    source: candidate.source,
    evidence: candidate.evidence || '',
  };

  // 1) Rejected — explicit negative signals win outright.
  if (candidate.userRejected || candidate.notOffered || candidate.previouslyRemoved) {
    return { ...base, confirmationStatus: 'rejected', confidence: candidate.confidence ?? DEFAULT_CONFIDENCE.rejected };
  }

  // 2) Confirmed — explicit positive signals.
  const isConfirmed =
    candidate.userSelected === true ||
    candidate.source === 'user' ||
    candidate.listedOnWebsite === true ||
    (candidate.source === 'website' && candidate.listedOnWebsite !== false) ||
    candidate.storedInBusinessSettings === true ||
    candidate.source === 'business_settings' ||
    candidate.previouslyApproved === true ||
    candidate.statedInUploadedFile === true;
  if (isConfirmed) {
    return { ...base, confirmationStatus: 'confirmed', confidence: candidate.confidence ?? DEFAULT_CONFIDENCE.confirmed };
  }

  // 3) Needs user confirmation — competitor-only / broad-inference / ambiguous.
  if (
    candidate.fromCompetitorOnly === true ||
    candidate.broadIndustryInference === true ||
    candidate.ambiguous === true ||
    (candidate.source === 'industry_knowledge' && !candidate.commonForIndustry)
  ) {
    return { ...base, confirmationStatus: 'needs_user_confirmation', confidence: candidate.confidence ?? DEFAULT_CONFIDENCE.needs_user_confirmation };
  }

  // 4) Likely — industry-common / weak research / inferred from related.
  if (
    candidate.commonForIndustry === true ||
    candidate.appearsWeaklyInResearch === true ||
    candidate.inferredFromRelated === true
  ) {
    return { ...base, confirmationStatus: 'likely', confidence: candidate.confidence ?? DEFAULT_CONFIDENCE.likely };
  }

  // 5) Default — anything unconfirmed needs user confirmation before pages.
  return { ...base, confirmationStatus: 'needs_user_confirmation', confidence: candidate.confidence ?? DEFAULT_CONFIDENCE.needs_user_confirmation };
}

export function classifyServices(candidates: ServiceCandidate[]): DiscoveredService[] {
  return (candidates || []).map(classifyService);
}

export function confirmedServices(services: DiscoveredService[]): DiscoveredService[] {
  return (services || []).filter((s) => s.confirmationStatus === 'confirmed');
}

export function serviceDiscoveryCounts(services: DiscoveredService[]) {
  return {
    confirmedCount: services.filter((s) => s.confirmationStatus === 'confirmed').length,
    likelyCount: services.filter((s) => s.confirmationStatus === 'likely').length,
    needsConfirmationCount: services.filter((s) => s.confirmationStatus === 'needs_user_confirmation').length,
    rejectedCount: services.filter((s) => s.confirmationStatus === 'rejected').length,
  };
}

// ── Section templates (generic, service-agnostic) ───────────────────────────
const HOME_SECTIONS = ['Hero', 'Services Overview', 'Why Choose Us', 'Reviews', 'Service Area', 'CTA'];
const SERVICE_HUB_SECTIONS = ['Hero', 'Service List', 'Why Choose Us', 'Service Area', 'Reviews', 'CTA'];
const SERVICE_DETAIL_SECTIONS = [
  'Hero',
  'Signs You Need This Service',
  'What We Do',
  'Why Choose This Business',
  'Service Area',
  'FAQ',
  'CTA',
];
const COMPARISON_SECTIONS = [
  'Hero',
  'Who Each Platform Is For',
  'Feature Comparison',
  'Workflow Comparison',
  'Pricing / Cost Structure',
  "Why It's Different",
  'FAQ',
  'CTA',
];

// ── Sitemap generation ──────────────────────────────────────────────────────
export interface SitemapGenerationInput {
  businessName: string;
  industry: string;
  /** Business-type label for the home H1 (e.g. "Auto Repair Shop"). Defaults to industry. */
  businessType?: string;
  /** Category label for the parent hub H1 (e.g. "Auto Repair"). Defaults to industry. */
  serviceCategoryLabel?: string;
  primaryServiceArea: PrimaryServiceArea;
  websiteGoal?: string;
  serviceAreaMode?: WebsiteSitemapArtifact['serviceAreaMode'];
  targetAudience?: string;
  /** Either classified services or raw candidates (raw are classified first). */
  services: DiscoveredService[];
  sourceSummary?: Partial<WebsiteSitemapArtifact['sourceSummary']>;
}

/**
 * Generate a hub-and-spoke sitemap from CONFIRMED services only.
 *
 * NEVER hardcodes example marketing pages (SEO, Paid Ads, GMB, Launch CRM,
 * comparisons, "Tombstone vs Tabloo", …). Only a Home page, a Services hub, and
 * one unique service-detail page per CONFIRMED service are produced. Likely /
 * needs_user_confirmation services are retained in `serviceDiscovery` for the
 * confirmation UI but do NOT become pages.
 */
export function generateSitemap(input: SitemapGenerationInput): WebsiteSitemapArtifact {
  const mode = input.serviceAreaMode || 'local';
  const businessType = input.businessType || input.industry;
  const serviceCategory = input.serviceCategoryLabel || input.industry;
  const area = input.primaryServiceArea || {};
  const services = input.services || [];
  const confirmed = confirmedServices(services);

  const pages: SitemapPage[] = [];

  // 1) Home
  pages.push({
    title: 'Home',
    slug: '/',
    pageType: 'home',
    h1: buildHomeH1(businessType, area, { mode }),
    purpose: 'Introduce the business, service area, proof points, and main conversion action.',
    sections: [...HOME_SECTIONS],
    approvalStatus: 'pending_user_review',
    sortOrder: 0,
  });

  // 2) Services hub (only when there is at least one confirmed service)
  if (confirmed.length > 0) {
    const childSlugs = confirmed.map((s) => s.slug);
    pages.push({
      title: `${serviceCategory} Services`,
      slug: '/services',
      pageType: 'service_hub',
      h1: buildParentServicesH1(serviceCategory, area, { mode }),
      purpose: `List all confirmed ${serviceCategory} services and route users to individual service pages.`,
      sections: [...SERVICE_HUB_SECTIONS],
      childPages: childSlugs,
      approvalStatus: 'pending_user_review',
      sortOrder: 1,
    });

    // 3) One unique service-detail page per confirmed service
    confirmed.forEach((svc, idx) => {
      pages.push({
        title: svc.serviceName,
        slug: svc.slug,
        pageType: 'service_detail',
        parentSlug: '/services',
        serviceName: svc.serviceName,
        confirmationStatus: 'confirmed',
        h1: buildServiceDetailH1(svc.serviceName, area, { mode, targetAudience: input.targetAudience }),
        purpose: `Explain ${svc.serviceName}, the customer problem, the process, local relevance, FAQs, related services, and the conversion action.`,
        sections: [...SERVICE_DETAIL_SECTIONS],
        approvalStatus: 'pending_user_review',
        sortOrder: 2 + idx,
      });
    });
  }

  return {
    businessName: input.businessName,
    industry: input.industry,
    primaryServiceArea: area,
    websiteGoal: input.websiteGoal || 'lead generation',
    serviceAreaMode: mode,
    sourceSummary: {
      website: input.sourceSummary?.website ?? false,
      businessSettings: input.sourceSummary?.businessSettings ?? false,
      uploadedFiles: input.sourceSummary?.uploadedFiles ?? false,
      searchIntelligence: input.sourceSummary?.searchIntelligence ?? false,
      agentResearch: input.sourceSummary?.agentResearch ?? false,
    },
    serviceDiscovery: services,
    pages,
    userRequestedPages: [],
    approvalStatus: 'pending_user_review',
    approvedAt: null,
    approvedBy: null,
  };
}

// ── User-requested pages ────────────────────────────────────────────────────
export interface AddUserPageRequest {
  title: string;
  requestedByUserId?: string;
  /** Optional explicit slug/type/sections; sensible defaults are inferred. */
  slug?: string;
  pageType?: PageType;
  sections?: string[];
  /** ISO timestamp; defaults to now. Injectable for deterministic tests. */
  requestedAt?: string;
}

export interface SitemapRevisionRecord {
  revisionId: string;
  action: 'add_page';
  page: SitemapPage;
  requestedByUserId?: string;
  requestedAt: string;
}

function looksLikeComparison(title: string): boolean {
  return /\b(vs\.?|versus|compare|comparison)\b/i.test(title || '');
}

function inferUserPageSlug(title: string, pageType: PageType): string {
  const base = slugifyServiceName(title);
  if (pageType === 'comparison') return `/compare/${base}`;
  if (pageType === 'location') return `/areas/${base}`;
  return `/${base}`;
}

/**
 * Add a user-requested page to the sitemap. The page is ALWAYS marked
 * `source: 'user_requested'` and is never treated as a default for any other
 * site. Adding a page resets the sitemap to `pending_user_review` (the revised
 * sitemap must be re-reviewed before copy).
 *
 * Returns the mutated sitemap plus an audit revision record.
 */
export function addUserRequestedPage(
  sitemap: WebsiteSitemapArtifact,
  req: AddUserPageRequest,
): { sitemap: WebsiteSitemapArtifact; revision: SitemapRevisionRecord } {
  const requestedAt = req.requestedAt || new Date().toISOString();
  const pageType: PageType = req.pageType || (looksLikeComparison(req.title) ? 'comparison' : 'custom');
  const slug = req.slug || inferUserPageSlug(req.title, pageType);
  const sections =
    req.sections ||
    (pageType === 'comparison' ? [...COMPARISON_SECTIONS] : ['Hero', 'Overview', 'Details', 'FAQ', 'CTA']);

  const maxSort = sitemap.pages.reduce((m, p) => Math.max(m, p.sortOrder), 0);

  const page: SitemapPage = {
    title: req.title,
    slug,
    pageType,
    h1: req.title,
    purpose: `User-requested ${pageType} page.`,
    sections,
    source: 'user_requested',
    status: 'added_by_user',
    requestedByUserId: req.requestedByUserId,
    requestedAt,
    approvalStatus: 'pending_user_review',
    sortOrder: maxSort + 1,
  };

  const userPage: UserRequestedPage = {
    title: req.title,
    slug,
    pageType,
    status: 'added_by_user',
    source: 'user_requested',
    requestedAt,
    requestedByUserId: req.requestedByUserId,
  };

  const next: WebsiteSitemapArtifact = {
    ...sitemap,
    pages: [...sitemap.pages, page],
    userRequestedPages: [...sitemap.userRequestedPages, userPage],
    // Revised sitemap must be re-reviewed before copy generation.
    approvalStatus: 'pending_user_review',
    approvedAt: null,
    approvedBy: null,
  };

  const revision: SitemapRevisionRecord = {
    revisionId: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    action: 'add_page',
    page,
    requestedByUserId: req.requestedByUserId,
    requestedAt,
  };

  return { sitemap: next, revision };
}

// ── Approval ────────────────────────────────────────────────────────────────
export function approveSitemap(
  sitemap: WebsiteSitemapArtifact,
  approvedByUserId: string,
  approvedAt?: string,
): WebsiteSitemapArtifact {
  const ts = approvedAt || new Date().toISOString();
  return {
    ...sitemap,
    approvalStatus: 'approved',
    approvedAt: ts,
    approvedBy: approvedByUserId,
    pages: sitemap.pages.map((p) => ({ ...p, approvalStatus: 'approved' as ApprovalStatus })),
  };
}

// ── Copy generation hard gate ───────────────────────────────────────────────
export type CopyGateCode =
  | 'ok'
  | 'sitemap_missing'
  | 'sitemap_not_approved'
  | 'invalid_h1';

export interface CopyGateResult {
  allowed: boolean;
  code: CopyGateCode;
  reason: string;
  h1Issues?: H1Issue[];
}

/**
 * The hard gate. Copy generation is blocked unless a sitemap exists, its
 * approvalStatus === 'approved', and all H1s are valid.
 */
export function canGenerateCopy(
  sitemap: WebsiteSitemapArtifact | null | undefined,
): CopyGateResult {
  if (!sitemap) {
    return { allowed: false, code: 'sitemap_missing', reason: 'No sitemap exists. Generate and approve a sitemap before copy generation.' };
  }
  if (sitemap.approvalStatus !== 'approved') {
    return {
      allowed: false,
      code: 'sitemap_not_approved',
      reason: `Sitemap approvalStatus is "${sitemap.approvalStatus}". Copy generation requires an approved sitemap.`,
    };
  }
  const h1Issues = validateSitemapH1s(sitemap);
  if (h1Issues.length > 0) {
    return {
      allowed: false,
      code: 'invalid_h1',
      reason: 'Sitemap has invalid or missing H1 values; fix them before copy generation.',
      h1Issues,
    };
  }
  return { allowed: true, code: 'ok', reason: 'Sitemap is approved; copy generation may proceed.' };
}

export class CopyGateError extends Error {
  code: CopyGateCode;
  h1Issues?: H1Issue[];
  constructor(result: CopyGateResult) {
    super(result.reason);
    this.name = 'CopyGateError';
    this.code = result.code;
    this.h1Issues = result.h1Issues;
  }
}

/** Throwing variant of the copy gate for call sites that guard imperatively. */
export function assertCanGenerateCopy(
  sitemap: WebsiteSitemapArtifact | null | undefined,
): void {
  const result = canGenerateCopy(sitemap);
  if (!result.allowed) throw new CopyGateError(result);
}
