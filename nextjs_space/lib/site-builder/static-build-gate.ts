/**
 * Milestone 6 — static-build gate.
 *
 * Validates that every prerequisite is in place BEFORE a static build runs.
 * The gate is pure/read-only: it never generates, uploads, publishes or
 * deploys, and it never returns secret values or signed URLs.
 *
 * On failure it returns a structured blocking response; the orchestrator must
 * NOT create a successful SiteBuild when the gate blocks (a `build_failed` row
 * is only recorded when an actual build attempt was started).
 */

import {
  validateSitemapH1s,
  type WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';
import {
  resolveSitemapBuildInputs,
  pageRequiresHero,
  type ResolvedBuildInputs,
} from '@/lib/site-builder/sitemap-build-inputs';
import { isSignedUrl } from '@/lib/website-image-generation';
import type { PreservationMapping } from '@/lib/site-backlinks/types';
import { unmappedHighValue, needsReviewMedium } from '@/lib/site-backlinks/redirect-plan';

export type StaticBuildGateCode =
  | 'business_missing'
  | 'sitemap_missing'
  | 'sitemap_not_approved'
  | 'copy_missing'
  | 'copy_sitemap_mismatch'
  | 'copy_invalid_status'
  | 'brief_set_missing'
  | 'required_images_missing'
  | 'image_business_mismatch'
  | 'image_reference_mismatch'
  | 'image_not_durable'
  | 'signed_url_stored'
  | 'page_missing_copy'
  | 'duplicate_routes'
  | 'rejected_service_page'
  | 'invalid_h1'
  | 'backlink_url_would_404'
  | 'deploy_requested'
  | 'ok';

export interface GateIssue {
  code: StaticBuildGateCode;
  message: string;
  slugs?: string[];
}

export interface StaticBuildGateResult {
  ok: boolean;
  blocking: GateIssue[];
  warnings: string[];
  refs: {
    businessId: string;
    websiteProjectId: string | null;
    sitemapId: string | null;
    sitemapApproved: boolean;
    copyArtifactIds: string[];
    representativeCopyStatus: string | null;
    briefSetId: string | null;
    briefSetStatus: string | null;
    approvedImageCount: number;
    usableImageCount: number;
    missingRequiredImageCount: number;
    routes: string[];
    pages: {
      slug: string;
      pageType: string;
      h1: string;
      hasCopy: boolean;
      copyStatus: string | null;
      requiresHero: boolean;
      hasHero: boolean;
      heroStatus: string | null;
    }[];
  };
}

const ALLOWED_COPY_STATUSES = new Set(['draft', 'ready_for_review', 'approved']);

export interface EvaluateGateOptions {
  /** When true, the caller requested a deploy/publish — always blocked in M6. */
  deployRequested?: boolean;
  /** Pre-resolved inputs (avoids a second DB round-trip). */
  inputs?: ResolvedBuildInputs;
  /**
   * Milestone 10 — backlink preservation mappings for this sitemap. When
   * provided, the gate BLOCKS the build if any critical/high-value backlinked
   * URL would become a 404 (no preserved page + no redirect), and WARNS for
   * medium-value URLs still needing review. Absent = backlink layer not run.
   */
  backlink?: { mappings: PreservationMapping[] };
}

export async function evaluateStaticBuildGate(
  businessId: string,
  websiteProjectId?: string | null,
  opts?: EvaluateGateOptions,
): Promise<StaticBuildGateResult> {
  const inputs =
    opts?.inputs || (await resolveSitemapBuildInputs(businessId, websiteProjectId));
  return evaluateGateFromInputs(businessId, inputs, opts);
}

/** Pure gate evaluation over already-resolved inputs (unit-testable). */
export function evaluateGateFromInputs(
  businessId: string,
  inputs: ResolvedBuildInputs,
  opts?: EvaluateGateOptions,
): StaticBuildGateResult {
  const blocking: GateIssue[] = [];
  const warnings: string[] = [];

  const sitemap = inputs.sitemap;
  const buildablePages = inputs.buildablePages;

  // 0) Deploy/publish is never allowed in this milestone.
  if (opts?.deployRequested) {
    blocking.push({
      code: 'deploy_requested',
      message: 'Deploy/publish is disabled. This build is a static preview only.',
    });
  }

  // 1) Business must exist.
  if (!inputs.business) {
    blocking.push({ code: 'business_missing', message: `Business ${businessId} not found.` });
  }

  // 2) Approved sitemap must exist + belong to the business.
  if (!inputs.sitemapId || !sitemap) {
    blocking.push({ code: 'sitemap_missing', message: 'No sitemap found for this business.' });
  } else if (!inputs.sitemapApproved) {
    blocking.push({
      code: 'sitemap_not_approved',
      message: 'The latest sitemap is not approved. Approve the sitemap before building.',
    });
  }

  // 3) Copy artifact must exist, reference the approved sitemap, valid status.
  const copyRows = inputs.copyRows;
  if (copyRows.length === 0) {
    blocking.push({
      code: 'copy_missing',
      message: 'No page copy found for the approved sitemap. Generate copy before building.',
    });
  } else {
    const badStatus = copyRows.filter((c) => !ALLOWED_COPY_STATUSES.has(c.status));
    if (badStatus.length) {
      blocking.push({
        code: 'copy_invalid_status',
        message: `Copy for some pages has an unsupported status: ${badStatus
          .map((c) => `${c.slug} (${c.status})`)
          .join(', ')}.`,
        slugs: badStatus.map((c) => c.slug),
      });
    }
  }

  // 4) Image brief set must exist.
  if (!inputs.briefSet) {
    blocking.push({
      code: 'brief_set_missing',
      message: 'No image brief set found for the approved sitemap.',
    });
  } else {
    if (inputs.briefSet.sitemapId !== inputs.sitemapId) {
      blocking.push({
        code: 'image_reference_mismatch',
        message: 'The image brief set does not reference the approved sitemap.',
      });
    }
    if (inputs.briefSet.status !== 'approved') {
      warnings.push(
        `Image brief set is not approved (status: ${inputs.briefSet.status}).`,
      );
    }
  }

  // 5) Every buildable page must have copy.
  const missingCopy = buildablePages.filter((p) => !inputs.copyBySlug.has(p.slug));
  if (missingCopy.length) {
    blocking.push({
      code: 'page_missing_copy',
      message: `Pages are missing copy: ${missingCopy.map((p) => p.slug).join(', ')}.`,
      slugs: missingCopy.map((p) => p.slug),
    });
  }

  // 6) Generated images must belong to the business + reference sitemap/brief.
  for (const img of inputs.images) {
    if (img.sitemapId && inputs.sitemapId && img.sitemapId !== inputs.sitemapId) {
      blocking.push({
        code: 'image_reference_mismatch',
        message: `Image ${img.id} references a different sitemap.`,
      });
      break;
    }
  }
  // Signed-URL-as-durable-ref guard (never ship a signed URL).
  const signed = inputs.images.filter(
    (i) => (USABLE(i.status)) && i.r2Key && isSignedUrl(i.r2Key),
  );
  if (signed.length) {
    blocking.push({
      code: 'signed_url_stored',
      message: `Some image assets store a signed URL instead of a durable R2 key: ${signed
        .map((i) => i.id)
        .join(', ')}.`,
    });
  }

  // 7) Required hero images must exist (durable) for every buildable page.
  const missingHero = buildablePages.filter(
    (p) => pageRequiresHero(p) && !inputs.heroBySlug.get(p.slug),
  );
  if (missingHero.length) {
    blocking.push({
      code: 'required_images_missing',
      message: `Pages are missing a usable hero image: ${missingHero
        .map((p) => p.slug)
        .join(', ')}.`,
      slugs: missingHero.map((p) => p.slug),
    });
  }
  // Warn when a selected hero is not yet approved.
  for (const p of buildablePages) {
    const hero = inputs.heroBySlug.get(p.slug);
    if (hero && hero.status !== 'approved') {
      warnings.push(`Hero image for ${p.slug} is not yet approved (status: ${hero.status}).`);
    }
  }

  // 8) No rejected-service page should be built.
  const rejected = sitemap
    ? sitemap.pages.filter((p) => p.confirmationStatus === 'rejected')
    : [];
  const rejectedBuilt = rejected.filter((r) => buildablePages.some((b) => b.slug === r.slug));
  if (rejectedBuilt.length) {
    blocking.push({
      code: 'rejected_service_page',
      message: `Rejected services must not become pages: ${rejectedBuilt
        .map((p) => p.slug)
        .join(', ')}.`,
      slugs: rejectedBuilt.map((p) => p.slug),
    });
  }

  // 9) Routes/slugs must be unique.
  const seen = new Map<string, number>();
  for (const p of buildablePages) seen.set(p.slug, (seen.get(p.slug) || 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);
  if (dups.length) {
    blocking.push({
      code: 'duplicate_routes',
      message: `Duplicate routes/slugs detected: ${dups.join(', ')}.`,
      slugs: dups,
    });
  }

  // 10) H1 validation must pass for the built pages.
  if (sitemap) {
    const builtSlugs = new Set(buildablePages.map((p) => p.slug));
    const h1Issues = validateSitemapH1s({
      ...sitemap,
      pages: sitemap.pages.filter((p) => builtSlugs.has(p.slug)),
    } as WebsiteSitemapArtifact);
    if (h1Issues.length) {
      blocking.push({
        code: 'invalid_h1',
        message: `H1 validation failed: ${h1Issues
          .map((i) => `${i.slug} (${i.reason})`)
          .join(', ')}.`,
        slugs: h1Issues.map((i) => i.slug),
      });
    }
  }

  // 11) Backlink preservation (Milestone 10) — never let a critical/high-value
  //     backlinked URL become a 404. Safe = preserved page path OR redirect.
  //     Unmapped/needs-review high-value URLs BLOCK; medium WARN.
  if (opts?.backlink?.mappings) {
    const highUnmapped = unmappedHighValue(opts.backlink.mappings);
    if (highUnmapped.length) {
      blocking.push({
        code: 'backlink_url_would_404',
        message: `High-value backlinked URL(s) would become a 404 (no preserved page + no redirect): ${highUnmapped
          .map((m) => m.oldPath)
          .join(', ')}. Map or redirect them before building.`,
        slugs: highUnmapped.map((m) => m.oldPath),
      });
    }
    const medReview = needsReviewMedium(opts.backlink.mappings);
    if (medReview.length) {
      warnings.push(
        `${medReview.length} medium-value backlinked URL(s) need review before build: ${medReview
          .map((m) => m.oldPath)
          .join(', ')}.`,
      );
    }
  }

  const approvedImageCount = inputs.images.filter((i) => i.status === 'approved').length;
  const usableImageCount = inputs.images.filter((i) => i.durable).length;

  const refs: StaticBuildGateResult['refs'] = {
    businessId,
    websiteProjectId: inputs.websiteProjectId,
    sitemapId: inputs.sitemapId,
    sitemapApproved: inputs.sitemapApproved,
    copyArtifactIds: copyRows.map((c) => c.id),
    representativeCopyStatus: copyRows[0]?.status ?? null,
    briefSetId: inputs.briefSet?.id ?? null,
    briefSetStatus: inputs.briefSet?.status ?? null,
    approvedImageCount,
    usableImageCount,
    missingRequiredImageCount: missingHero.length,
    routes: buildablePages.map((p) => p.slug),
    pages: buildablePages.map((p) => {
      const copy = inputs.copyBySlug.get(p.slug);
      const hero = inputs.heroBySlug.get(p.slug);
      return {
        slug: p.slug,
        pageType: p.pageType,
        h1: p.h1,
        hasCopy: Boolean(copy),
        copyStatus: copy?.status ?? null,
        requiresHero: pageRequiresHero(p),
        hasHero: Boolean(hero),
        heroStatus: hero?.status ?? null,
      };
    }),
  };

  return { ok: blocking.length === 0, blocking, warnings, refs };
}

function USABLE(status: string): boolean {
  return status === 'approved' || status === 'ready_for_review' || status === 'generated';
}
