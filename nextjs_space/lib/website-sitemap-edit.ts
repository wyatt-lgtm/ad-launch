/**
 * Sitemap-first website generation — pure editing + validation helpers (Milestone 2).
 *
 * This module is intentionally DEPENDENCY-FREE and NETWORK-FREE. It contains no
 * imports of prisma, fetch, or any deploy/publish/copy/image helper. It only
 * transforms in-memory sitemap artifacts and validates them.
 *
 * These helpers back the Milestone 2 UI/API actions:
 *   - add / remove / rename / reorder pages
 *   - add / remove sections
 *   - add comparison / location pages
 *   - convert a section into a page
 *   - convert a discovered service into a page (only when confirmed)
 *   - re-classify a discovered service (confirm / reject) and regenerate the
 *     confirmed service-detail pages accordingly
 *   - comprehensive pre-approval validation (structure + H1)
 *
 * SAFETY INVARIANTS (Milestone 2):
 *   - No network, no publishing, no deployment, no image generation, no copy
 *     generation. Editing artifacts only.
 *   - Never adds default marketing/example pages. Only user-driven pages or
 *     confirmed-service pages are created.
 *   - Any structural edit resets approval to `pending_user_review` (a revised
 *     sitemap must be re-reviewed before copy generation).
 */
import {
  WebsiteSitemapArtifact,
  SitemapPage,
  PageType,
  H1Issue,
  DiscoveredService,
  ConfirmationStatus,
  slugifyServiceName,
  serviceDetailSlug,
  buildServiceDetailH1,
  buildParentServicesH1,
  buildLocationH1,
  validateSitemapH1s,
  confirmedServices,
} from '@/lib/website-sitemap';

// ── Internal helpers ────────────────────────────────────────────────────────
function resetApproval(sitemap: WebsiteSitemapArtifact): WebsiteSitemapArtifact {
  return {
    ...sitemap,
    approvalStatus: 'pending_user_review',
    approvedAt: null,
    approvedBy: null,
  };
}

function nextSortOrder(sitemap: WebsiteSitemapArtifact): number {
  return sitemap.pages.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1;
}

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
const LOCATION_SECTIONS = ['Hero', 'Areas We Serve', 'Why Choose Us', 'Services', 'Reviews', 'CTA'];
const GENERIC_SECTIONS = ['Hero', 'Overview', 'Details', 'FAQ', 'CTA'];

// ── Page edits ──────────────────────────────────────────────────────────────

/** Rename a page's title (and optionally its H1). Resets approval. */
export function renamePage(
  sitemap: WebsiteSitemapArtifact,
  slug: string,
  newTitle: string,
  opts?: { newH1?: string },
): WebsiteSitemapArtifact {
  const pages = sitemap.pages.map((p) =>
    p.slug === slug
      ? { ...p, title: newTitle, h1: opts?.newH1 !== undefined ? opts.newH1 : p.h1 }
      : p,
  );
  return resetApproval({ ...sitemap, pages });
}

/** Remove a page by slug. Also detaches it from any parent's childPages. Resets approval. */
export function removePage(sitemap: WebsiteSitemapArtifact, slug: string): WebsiteSitemapArtifact {
  const pages = sitemap.pages
    .filter((p) => p.slug !== slug)
    .map((p) =>
      p.childPages && p.childPages.includes(slug)
        ? { ...p, childPages: p.childPages.filter((c) => c !== slug) }
        : p,
    );
  const userRequestedPages = sitemap.userRequestedPages.filter((u) => u.slug !== slug);
  return resetApproval({ ...sitemap, pages, userRequestedPages });
}

/**
 * Reorder pages given an explicit ordered list of slugs. Any pages not named in
 * `orderedSlugs` keep their relative order and are appended after. Resets approval.
 */
export function reorderPages(
  sitemap: WebsiteSitemapArtifact,
  orderedSlugs: string[],
): WebsiteSitemapArtifact {
  const bySlug = new Map(sitemap.pages.map((p) => [p.slug, p]));
  const ordered: SitemapPage[] = [];
  for (const slug of orderedSlugs) {
    const page = bySlug.get(slug);
    if (page) {
      ordered.push(page);
      bySlug.delete(slug);
    }
  }
  // Remaining (not listed) preserve their existing order.
  for (const page of sitemap.pages) {
    if (bySlug.has(page.slug)) ordered.push(page);
  }
  const pages = ordered.map((p, idx) => ({ ...p, sortOrder: idx }));
  return resetApproval({ ...sitemap, pages });
}

/** Add a section to a page (no duplicates). Resets approval. */
export function addSection(
  sitemap: WebsiteSitemapArtifact,
  slug: string,
  sectionName: string,
): WebsiteSitemapArtifact {
  const name = (sectionName || '').trim();
  if (!name) return sitemap;
  const pages = sitemap.pages.map((p) =>
    p.slug === slug && !p.sections.includes(name)
      ? { ...p, sections: [...p.sections, name] }
      : p,
  );
  return resetApproval({ ...sitemap, pages });
}

/** Remove a section from a page. Resets approval. */
export function removeSection(
  sitemap: WebsiteSitemapArtifact,
  slug: string,
  sectionName: string,
): WebsiteSitemapArtifact {
  const pages = sitemap.pages.map((p) =>
    p.slug === slug ? { ...p, sections: p.sections.filter((s) => s !== sectionName) } : p,
  );
  return resetApproval({ ...sitemap, pages });
}

/**
 * Add a comparison page (e.g. "Tombstone vs Tabloo"). Always marked
 * `source: 'user_requested'`. Slug is `/compare/<slug>`. Resets approval.
 */
export function addComparisonPage(
  sitemap: WebsiteSitemapArtifact,
  title: string,
  opts?: { requestedByUserId?: string; requestedAt?: string },
): WebsiteSitemapArtifact {
  const requestedAt = opts?.requestedAt || new Date().toISOString();
  const slug = `/compare/${slugifyServiceName(title)}`;
  const page: SitemapPage = {
    title,
    slug,
    pageType: 'comparison',
    h1: title,
    purpose: 'User-requested comparison page.',
    sections: [...COMPARISON_SECTIONS],
    source: 'user_requested',
    status: 'added_by_user',
    requestedByUserId: opts?.requestedByUserId,
    requestedAt,
    approvalStatus: 'pending_user_review',
    sortOrder: nextSortOrder(sitemap),
  };
  return resetApproval({
    ...sitemap,
    pages: [...sitemap.pages, page],
    userRequestedPages: [
      ...sitemap.userRequestedPages,
      { title, slug, pageType: 'comparison', status: 'added_by_user', source: 'user_requested', requestedAt, requestedByUserId: opts?.requestedByUserId },
    ],
  });
}

/**
 * Add a location/area page. Marked `source: 'user_requested'`. Slug `/areas/<slug>`.
 * H1 uses `{Business Category} in {City}, {State}`. Resets approval.
 */
export function addLocationPage(
  sitemap: WebsiteSitemapArtifact,
  params: { city: string; state?: string; businessCategory?: string; requestedByUserId?: string; requestedAt?: string },
): WebsiteSitemapArtifact {
  const requestedAt = params.requestedAt || new Date().toISOString();
  const state = params.state || sitemap.primaryServiceArea?.state || '';
  const category = params.businessCategory || sitemap.industry || 'Local Business';
  const title = state ? `${params.city}, ${state}` : params.city;
  const slug = `/areas/${slugifyServiceName(title)}`;
  const page: SitemapPage = {
    title,
    slug,
    pageType: 'location',
    h1: buildLocationH1(category, params.city, state),
    purpose: 'User-requested location page.',
    sections: [...LOCATION_SECTIONS],
    source: 'user_requested',
    status: 'added_by_user',
    requestedByUserId: params.requestedByUserId,
    requestedAt,
    approvalStatus: 'pending_user_review',
    sortOrder: nextSortOrder(sitemap),
  };
  return resetApproval({
    ...sitemap,
    pages: [...sitemap.pages, page],
    userRequestedPages: [
      ...sitemap.userRequestedPages,
      { title, slug, pageType: 'location', status: 'added_by_user', source: 'user_requested', requestedAt, requestedByUserId: params.requestedByUserId },
    ],
  });
}

/**
 * Convert a section of a page into its own child page. The section is removed
 * from the parent and a new `custom` page is created (user_requested). Resets approval.
 */
export function convertSectionToPage(
  sitemap: WebsiteSitemapArtifact,
  parentSlug: string,
  sectionName: string,
  opts?: { requestedByUserId?: string; requestedAt?: string },
): WebsiteSitemapArtifact {
  const parent = sitemap.pages.find((p) => p.slug === parentSlug);
  if (!parent || !parent.sections.includes(sectionName)) return sitemap;
  const requestedAt = opts?.requestedAt || new Date().toISOString();
  const slug = `${parentSlug === '/' ? '' : parentSlug}/${slugifyServiceName(sectionName)}`.replace(/^\/+/, '/');
  const newPage: SitemapPage = {
    title: sectionName,
    slug,
    pageType: 'custom',
    parentSlug,
    h1: sectionName,
    purpose: `Converted from the "${sectionName}" section of ${parent.title}.`,
    sections: [...GENERIC_SECTIONS],
    source: 'user_requested',
    status: 'added_by_user',
    requestedByUserId: opts?.requestedByUserId,
    requestedAt,
    approvalStatus: 'pending_user_review',
    sortOrder: nextSortOrder(sitemap),
  };
  const pages = sitemap.pages.map((p) =>
    p.slug === parentSlug
      ? { ...p, sections: p.sections.filter((s) => s !== sectionName), childPages: [...(p.childPages || []), slug] }
      : p,
  );
  return resetApproval({
    ...sitemap,
    pages: [...pages, newPage],
    userRequestedPages: [
      ...sitemap.userRequestedPages,
      { title: sectionName, slug, pageType: 'custom', status: 'added_by_user', source: 'user_requested', requestedAt, requestedByUserId: opts?.requestedByUserId },
    ],
  });
}

// ── Service (re)classification + confirmed-page regeneration ─────────────────

/**
 * Rebuild the confirmed service-detail pages + hub from the current
 * `serviceDiscovery`, preserving all non-service pages (home, user-requested,
 * comparison, location, custom). Called after a service is confirmed/rejected.
 *
 * - Confirmed services => one service_detail page each, parented to /services.
 * - The /services hub exists only when >= 1 confirmed service.
 * - Rejected / likely / needs_user_confirmation services never become pages.
 */
export function rebuildServicePages(sitemap: WebsiteSitemapArtifact): WebsiteSitemapArtifact {
  const mode = sitemap.serviceAreaMode;
  const area = sitemap.primaryServiceArea || {};
  const category = sitemap.industry || 'Our';
  const confirmed = confirmedServices(sitemap.serviceDiscovery);

  // Keep every page that is NOT a generated service hub/detail page.
  const kept = sitemap.pages.filter(
    (p) => p.pageType !== 'service_hub' && p.pageType !== 'service_detail',
  );

  const rebuilt: SitemapPage[] = [];
  const home = kept.find((p) => p.pageType === 'home');
  const nonHomeKept = kept.filter((p) => p.pageType !== 'home');

  let sort = 0;
  if (home) rebuilt.push({ ...home, sortOrder: sort++ });

  if (confirmed.length > 0) {
    const childSlugs = confirmed.map((s) => s.slug);
    rebuilt.push({
      title: `${category} Services`,
      slug: '/services',
      pageType: 'service_hub',
      h1: buildParentServicesH1(category, area, { mode }),
      purpose: `List all confirmed ${category} services and route users to individual service pages.`,
      sections: ['Hero', 'Service List', 'Why Choose Us', 'Service Area', 'Reviews', 'CTA'],
      childPages: childSlugs,
      approvalStatus: 'pending_user_review',
      sortOrder: sort++,
    });
    confirmed.forEach((svc) => {
      rebuilt.push({
        title: svc.serviceName,
        slug: svc.slug,
        pageType: 'service_detail',
        parentSlug: '/services',
        serviceName: svc.serviceName,
        confirmationStatus: 'confirmed',
        h1: buildServiceDetailH1(svc.serviceName, area, { mode }),
        purpose: `Explain ${svc.serviceName}, the customer problem, the process, local relevance, FAQs, related services, and the conversion action.`,
        sections: ['Hero', 'Signs You Need This Service', 'What We Do', 'Why Choose This Business', 'Service Area', 'FAQ', 'CTA'],
        approvalStatus: 'pending_user_review',
        sortOrder: sort++,
      });
    });
  }

  // Re-append the non-home, non-service kept pages (user-requested, etc.).
  for (const p of nonHomeKept) rebuilt.push({ ...p, sortOrder: sort++ });

  return resetApproval({ ...sitemap, pages: rebuilt });
}

/**
 * Set a discovered service's confirmation status by name, then rebuild the
 * confirmed service pages. If the service is not present and a status of
 * `confirmed` is requested, it is added to the discovery list. Resets approval.
 */
export function setServiceConfirmation(
  sitemap: WebsiteSitemapArtifact,
  serviceName: string,
  status: ConfirmationStatus,
  opts?: { source?: DiscoveredService['source']; evidence?: string },
): WebsiteSitemapArtifact {
  const slug = serviceDetailSlug(serviceName);
  let found = false;
  let discovery = sitemap.serviceDiscovery.map((s) => {
    if (s.slug === slug || s.serviceName.toLowerCase() === serviceName.toLowerCase()) {
      found = true;
      return { ...s, confirmationStatus: status };
    }
    return s;
  });
  if (!found) {
    discovery = [
      ...discovery,
      {
        serviceName,
        slug,
        confirmationStatus: status,
        source: opts?.source || 'user',
        evidence: opts?.evidence || 'Added by user',
        confidence: status === 'confirmed' ? 0.95 : 0.5,
      },
    ];
  }
  return rebuildServicePages({ ...sitemap, serviceDiscovery: discovery });
}

/** Convenience: confirm a discovered service and (re)build its page. */
export function convertServiceToPage(
  sitemap: WebsiteSitemapArtifact,
  serviceName: string,
): WebsiteSitemapArtifact {
  return setServiceConfirmation(sitemap, serviceName, 'confirmed');
}

/** Replace the whole discovery list (e.g. after a bulk service-confirmation save) and rebuild pages. */
export function applyServiceDiscovery(
  sitemap: WebsiteSitemapArtifact,
  services: DiscoveredService[],
): WebsiteSitemapArtifact {
  return rebuildServicePages({ ...sitemap, serviceDiscovery: services });
}

// ── Comprehensive pre-approval validation ────────────────────────────────────
export type SitemapIssueKind =
  | 'missing_h1'
  | 'service_h1_missing_city_state'
  | 'hub_h1_missing_category_area'
  | 'duplicate_slug'
  | 'unconfirmed_service_page'
  | 'missing_service_hub'
  | 'service_page_missing_parent';

export interface SitemapIssue {
  slug: string;
  pageType: PageType | 'sitemap';
  kind: SitemapIssueKind;
  reason: string;
}

/**
 * Structural validation (beyond H1 wording). Detects duplicate slugs,
 * unconfirmed service pages, a missing service hub when detail pages exist, and
 * service pages missing a parentSlug.
 */
export function validateSitemapStructure(sitemap: WebsiteSitemapArtifact): SitemapIssue[] {
  const issues: SitemapIssue[] = [];

  // Duplicate slugs.
  const seen = new Map<string, number>();
  for (const p of sitemap.pages) {
    seen.set(p.slug, (seen.get(p.slug) || 0) + 1);
  }
  for (const [slug, count] of Array.from(seen.entries())) {
    if (count > 1) {
      issues.push({ slug, pageType: 'sitemap', kind: 'duplicate_slug', reason: `Slug "${slug}" is used by ${count} pages.` });
    }
  }

  const detailPages = sitemap.pages.filter((p) => p.pageType === 'service_detail');
  const hasHub = sitemap.pages.some((p) => p.pageType === 'service_hub');

  // Missing hub when detail pages exist.
  if (detailPages.length > 0 && !hasHub) {
    issues.push({ slug: '/services', pageType: 'sitemap', kind: 'missing_service_hub', reason: 'Service detail pages exist but there is no /services hub page.' });
  }

  const confirmedSlugs = new Set(confirmedServices(sitemap.serviceDiscovery).map((s) => s.slug));
  for (const p of detailPages) {
    // Service page must be confirmed.
    const isConfirmed = p.confirmationStatus === 'confirmed' && confirmedSlugs.has(p.slug);
    if (!isConfirmed) {
      issues.push({ slug: p.slug, pageType: p.pageType, kind: 'unconfirmed_service_page', reason: `Service page "${p.title}" is not backed by a confirmed service.` });
    }
    // Service page must have a parent hub.
    if (!p.parentSlug) {
      issues.push({ slug: p.slug, pageType: p.pageType, kind: 'service_page_missing_parent', reason: `Service page "${p.title}" is missing a parentSlug.` });
    }
  }

  return issues;
}

/** Convert an H1Issue into the unified SitemapIssue shape. */
function h1IssueToSitemapIssue(issue: H1Issue): SitemapIssue {
  let kind: SitemapIssueKind = 'missing_h1';
  if (issue.reason === 'service_h1_must_be_service_plus_area') kind = 'service_h1_missing_city_state';
  else if (issue.reason === 'hub_h1_must_include_category_and_area') kind = 'hub_h1_missing_category_area';
  else if (issue.reason === 'missing_h1') kind = 'missing_h1';
  return { slug: issue.slug, pageType: issue.pageType, kind, reason: h1IssueReason(kind, issue) };
}

function h1IssueReason(kind: SitemapIssueKind, issue: H1Issue): string {
  switch (kind) {
    case 'service_h1_missing_city_state':
      return `Service detail H1 "${issue.h1}" must be "{Service} in {City}, {State}".`;
    case 'hub_h1_missing_category_area':
      return `Parent services H1 "${issue.h1}" must include the service category and area.`;
    case 'missing_h1':
      return `Page "${issue.slug}" is missing an H1.`;
    default:
      return issue.reason;
  }
}

/**
 * Full pre-approval validation = structural issues + H1 issues. Returns an
 * empty array when the sitemap is safe to approve.
 */
export function validateSitemapForApproval(sitemap: WebsiteSitemapArtifact): SitemapIssue[] {
  const structure = validateSitemapStructure(sitemap);
  const h1 = validateSitemapH1s(sitemap).map(h1IssueToSitemapIssue);
  return [...structure, ...h1];
}

/** True when the sitemap has no blocking validation issues. */
export function canApproveSitemap(sitemap: WebsiteSitemapArtifact): boolean {
  return validateSitemapForApproval(sitemap).length === 0;
}

// ── Copy-gate display status (Milestone 2, display-only) ─────────────────────
export type CopyGateDisplayStatus =
  | 'blocked_missing_sitemap'
  | 'blocked_sitemap_not_approved'
  | 'blocked_invalid_sitemap'
  | 'allowed_after_sitemap_approval';

/**
 * Map the internal copy-gate code to the Milestone 2 display status vocabulary.
 * This is purely a label transformation; the gate itself remains the source of
 * truth and copy generation is NOT implemented in Milestone 2.
 */
export function mapCopyGateStatus(
  code: 'ok' | 'sitemap_missing' | 'sitemap_not_approved' | 'invalid_h1',
): CopyGateDisplayStatus {
  switch (code) {
    case 'ok':
      return 'allowed_after_sitemap_approval';
    case 'sitemap_missing':
      return 'blocked_missing_sitemap';
    case 'sitemap_not_approved':
      return 'blocked_sitemap_not_approved';
    case 'invalid_h1':
      return 'blocked_invalid_sitemap';
    default:
      return 'blocked_missing_sitemap';
  }
}
