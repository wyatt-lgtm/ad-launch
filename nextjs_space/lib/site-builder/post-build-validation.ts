/**
 * Milestone 6 — post-build validation for sitemap-first static packages.
 *
 * Pure, deterministic checks run AFTER the package is rendered/materialized but
 * BEFORE the SiteBuild is marked ready_for_preview. It verifies the emitted
 * package faithfully represents the approved sitemap + copy + approved images
 * and that no forbidden content leaked into the package.
 *
 * Severity model:
 *  - `error`  : a true invariant break (signed URL leak, secret leak, missing
 *               route for an approved page). The orchestrator treats any error
 *               as a build failure.
 *  - `warning`: a soft issue recorded on the artifact manifest (e.g. missing
 *               metadata, hero not yet fully approved).
 *
 * READ-ONLY: never mutates inputs, never touches the network, never deploys.
 */

import type { SiteBlueprint } from '@/lib/site-blueprint';
import type { RenderManifest, RenderedFile } from '@/lib/site-renderer';
import type { MaterializationResult } from '@/lib/site-renderer/assets';
import type { WebsiteSitemapArtifact, SitemapPage } from '@/lib/website-sitemap';
import {
  looksLikeSecretValue,
  SECRET_VALUE_PATTERNS,
} from '@/lib/site-builder/env-validation';
import { isValidServiceDetailH1 } from '@/lib/website-sitemap';

export type PostBuildSeverity = 'error' | 'warning';

export interface PostBuildIssue {
  code: string;
  severity: PostBuildSeverity;
  message: string;
}

export interface PostBuildValidationResult {
  ok: boolean;
  issues: PostBuildIssue[];
  errors: PostBuildIssue[];
  warnings: PostBuildIssue[];
}

export interface PostBuildValidationInput {
  blueprint: SiteBlueprint;
  renderManifest: RenderManifest;
  materialization: MaterializationResult;
  /** The approved sitemap the build consumed. */
  sitemap: WebsiteSitemapArtifact;
  /** The rendered file map (in-memory), used for content leak scans. */
  files: RenderedFile[];
}

/** A signed-URL looking string (query-signed S3/R2 URL). */
function looksLikeSignedUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /[?&]X-Amz-(Signature|Credential|Security-Token|Expires)=/i.test(s) ||
    /[?&](Signature|Expires|AWSAccessKeyId)=/.test(s);
}

/** Absolute local / hosting paths that must never appear in a portable package. */
const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /\/home\/[a-z0-9_-]+\//i,
  /\/var\/www\//i,
  /\/public_html\//i,
  /\/usr\/local\//i,
  /\bcpanel\b/i,
  /\bhostgator\b/i,
  /:\\\\?[Uu]sers\\/, // windows-style
];

function normalizeSlug(slug: string): string {
  if (!slug) return '/';
  let s = slug.trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

function isRejected(page: SitemapPage): boolean {
  return (page.approvalStatus || '').toLowerCase() === 'rejected';
}

/**
 * Run all post-build invariants and return a structured result.
 */
export function validateStaticPackage(
  input: PostBuildValidationInput,
): PostBuildValidationResult {
  const { blueprint, renderManifest, materialization, sitemap, files } = input;
  const issues: PostBuildIssue[] = [];
  const add = (code: string, severity: PostBuildSeverity, message: string) =>
    issues.push({ code, severity, message });

  // Map of emitted routes for quick lookup.
  const routePaths = new Set(renderManifest.pageRoutes.map((r) => normalizeSlug(r.path)));
  const blueprintByPath = new Map(
    blueprint.pages.map((p) => [normalizeSlug(p.path), p]),
  );

  // The set of sitemap pages that SHOULD be built (eligible, non-rejected).
  const expectedPages = (sitemap.pages || []).filter((p) => !isRejected(p));
  const rejectedPages = (sitemap.pages || []).filter(isRejected);

  // 1) Every expected sitemap page has a route.
  for (const page of expectedPages) {
    const slug = normalizeSlug(page.slug);
    if (!routePaths.has(slug)) {
      // service_detail pages are only built when confirmed — don't hard-fail
      // an unconfirmed service detail, but flag anything else as an error.
      if (page.pageType === 'service_detail' && page.confirmationStatus !== 'confirmed') {
        add(
          'unconfirmed_service_detail_skipped',
          'warning',
          `Service detail "${page.title || slug}" is not confirmed and was not built.`,
        );
      } else {
        add(
          'missing_route_for_page',
          'error',
          `Approved sitemap page "${page.title || slug}" (${slug}) has no generated route.`,
        );
      }
    }
  }

  // 2) No rejected sitemap page may appear as a route.
  for (const page of rejectedPages) {
    const slug = normalizeSlug(page.slug);
    if (routePaths.has(slug)) {
      add(
        'rejected_page_built',
        'error',
        `Rejected sitemap page "${page.title || slug}" (${slug}) must not be built.`,
      );
    }
  }

  // 3) service_detail H1 preserved from the sitemap into the blueprint page.
  for (const page of expectedPages) {
    if (page.pageType !== 'service_detail') continue;
    const slug = normalizeSlug(page.slug);
    const bp = blueprintByPath.get(slug);
    if (!bp) continue; // covered by (1)
    if ((bp.h1 || '').trim() !== (page.h1 || '').trim()) {
      add(
        'h1_not_preserved',
        'error',
        `Service detail H1 mismatch for ${slug}: sitemap "${page.h1}" vs built "${bp.h1}".`,
      );
    }
    if (
      page.h1 &&
      !isValidServiceDetailH1(
        page.h1,
        page.serviceName || '',
        sitemap.primaryServiceArea,
        { mode: sitemap.serviceAreaMode },
      )
    ) {
      add(
        'invalid_service_detail_h1',
        'warning',
        `Service detail H1 "${page.h1}" may not follow the service-detail H1 convention.`,
      );
    }
  }

  // 4) Services hub links to every built service detail page; home links to hub.
  const hub = expectedPages.find((p) => p.pageType === 'service_hub');
  const serviceDetails = expectedPages.filter(
    (p) => p.pageType === 'service_detail' && routePaths.has(normalizeSlug(p.slug)),
  );
  if (hub) {
    const hubSlug = normalizeSlug(hub.slug);
    const hubBp = blueprintByPath.get(hubSlug);
    const hubLinks = new Set((hubBp?.internalLinks || []).map((l) => normalizeSlug(l.path)));
    for (const sd of serviceDetails) {
      if (!hubLinks.has(normalizeSlug(sd.slug))) {
        add(
          'hub_missing_service_link',
          'error',
          `Services hub does not link to service page ${normalizeSlug(sd.slug)}.`,
        );
      }
    }
    const home = expectedPages.find((p) => p.pageType === 'home');
    if (home) {
      const homeBp = blueprintByPath.get(normalizeSlug(home.slug));
      const homeLinks = new Set(
        (homeBp?.internalLinks || []).map((l) => normalizeSlug(l.path)),
      );
      if (!homeLinks.has(hubSlug)) {
        add(
          'home_missing_hub_link',
          'warning',
          'Home page does not link to the services hub.',
        );
      }
    }
  }

  // 5) Metadata present per built page.
  for (const bp of blueprint.pages) {
    if (!bp.metaTitle || !bp.metaTitle.trim()) {
      add('missing_meta_title', 'warning', `Page ${bp.path} is missing a meta title.`);
    }
    if (!bp.metaDescription || !bp.metaDescription.trim()) {
      add(
        'missing_meta_description',
        'warning',
        `Page ${bp.path} is missing a meta description.`,
      );
    }
  }

  // 6) sitemap.ts + robots generated.
  const filePaths = new Set(files.map((f) => f.path));
  if (!filePaths.has('app/sitemap.ts')) {
    add('missing_sitemap_route', 'warning', 'Package is missing app/sitemap.ts.');
  }
  if (!filePaths.has('app/robots.ts') && !filePaths.has('public/robots.txt')) {
    add('missing_robots', 'warning', 'Package is missing robots (app/robots.ts or public/robots.txt).');
  }

  // 7) Asset manifest: no signed URLs; local /images refs; durable sources.
  for (const entry of blueprint.assetManifest) {
    if (entry.sourceKind === 'r2_signed' || looksLikeSignedUrl(entry.source)) {
      add(
        'signed_url_in_manifest',
        'error',
        `Asset ${entry.assetId} references a signed URL; only durable keys are allowed.`,
      );
    }
    const local = (entry.intendedLocalPath || '').replace(/^\/+/, '');
    if (!local.startsWith('public/images/')) {
      add(
        'non_local_image_path',
        'warning',
        `Asset ${entry.assetId} intended path "${entry.intendedLocalPath}" is not under public/images/.`,
      );
    }
  }

  // 8) Materialized assets must reference local web paths, never signed URLs.
  for (const a of materialization.assets) {
    if (looksLikeSignedUrl(a.webPath)) {
      add('signed_url_web_path', 'error', `Materialized asset ${a.assetId} has a signed web path.`);
    }
    if (a.webPath && !a.webPath.startsWith('/images/')) {
      add(
        'non_local_web_path',
        'warning',
        `Materialized asset ${a.assetId} web path "${a.webPath}" is not under /images/.`,
      );
    }
  }

  // 9) Emitted file content scan: no secrets, no signed URLs, no hardcoded paths.
  for (const f of files) {
    const content = f.content || '';
    if (looksLikeSecretValue(content) || SECRET_VALUE_PATTERNS.some((re) => re.test(content))) {
      add('secret_in_package', 'error', `Emitted file ${f.path} appears to contain a secret value.`);
    }
    if (looksLikeSignedUrl(content)) {
      add('signed_url_in_package', 'error', `Emitted file ${f.path} appears to contain a signed URL.`);
    }
    for (const re of FORBIDDEN_PATH_PATTERNS) {
      if (re.test(content)) {
        add(
          'hardcoded_path_in_package',
          'warning',
          `Emitted file ${f.path} contains a non-portable absolute/hosting path.`,
        );
        break;
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, issues, errors, warnings };
}
