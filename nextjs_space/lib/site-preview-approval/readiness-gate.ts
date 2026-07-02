/**
 * Milestone 8 — Preview approval + deployment-readiness gate (PURE).
 *
 * Evaluates whether an M6-generated static preview package (QA'd in M7) is
 * ready to be APPROVED for a FUTURE, separately-gated deployment milestone.
 * This module is pure/side-effect-free: it never generates content, rebuilds
 * the site, uploads, publishes, deploys, or changes DNS. It never returns or
 * embeds secret values or signed URLs.
 *
 * TWO SEPARATE readiness concepts are computed independently:
 *   1. Preview / content readiness  → preview_ready | preview_blocked | preview_rejected
 *   2. Deployment target readiness  → target_ready_for_future_deploy | target_incomplete | target_not_configured
 *
 * A genuinely good preview must NOT be blocked merely because hosting
 * credentials / a deployment target are not configured yet. Target
 * incompleteness only affects the OVERALL status (approved_preview_only_...),
 * never the preview readiness itself.
 */

import type { RenderedFile } from '@/lib/site-renderer';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import type { DryRunPlan, DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import { containsSignedUrl, containsSecret } from '@/lib/site-qa/mobile-qa';
import type { PreservationMapping } from '@/lib/site-backlinks/types';
import { unmappedHighValue, needsReviewMedium } from '@/lib/site-backlinks/redirect-plan';

const READY_FOR_PREVIEW = 'ready_for_preview';

/** Deployment-target types that require a deployBasePath for a future deploy. */
const BASE_PATH_REQUIRED_TYPES = new Set(['hostgator_static']);

/**
 * Hardcoded host-path patterns that must NOT appear in the portable package.
 * Precise enough to avoid false positives (targetType strings such as
 * "hostgator_static" live in the target config / dry-run plan, never in the
 * package files, and are not scanned here).
 */
export const HARDCODED_HOST_PATTERNS: RegExp[] = [
  /\/public_html\b/i,
  /\bcpanel\b/i,
  /\bhostgator\b/i,
  /\/home\/[^/\s"']+\/public_html/i,
];

export function containsHardcodedHostPath(text: string): boolean {
  return HARDCODED_HOST_PATTERNS.some((re) => re.test(text));
}

export type PreviewReadinessCode =
  | 'business_missing'
  | 'build_missing'
  | 'build_wrong_business'
  | 'build_not_ready'
  | 'source_ref_missing'
  | 'manifest_missing'
  | 'no_routes'
  | 'sitemap_not_approved'
  | 'copy_artifact_missing'
  | 'images_not_present'
  | 'mobile_qa_missing'
  | 'mobile_qa_not_passed'
  | 'mobile_qa_critical_failures'
  | 'signed_url_embedded'
  | 'secret_embedded'
  | 'hardcoded_host_path'
  | 'dry_run_plan_missing'
  | 'live_deploy_not_disabled'
  | 'deploy_requested'
  | 'backlink_high_value_unmapped'
  | 'backlink_low_value_missing_reason'
  | 'backlink_redirect_plan_missing'
  | 'backlink_redirects_artifact_missing';

export interface PreviewReadinessIssue {
  code: PreviewReadinessCode;
  message: string;
}

export interface PreviewBuildLike {
  id: string;
  businessId: string;
  buildStatus: string;
  sourceRef: string | null;
  artifactManifestJson: ArtifactManifest | null;
}

export interface PreviewMobileQaLike {
  id: string;
  siteBuildId: string;
  status: string;
  passed: boolean;
  score: number | null;
  checkedRoutesCount: number;
  failedRoutesCount: number;
  warningCount: number;
  /** Full QA report (used only to count critical route failures). */
  qaJson?: any;
}

export interface PreviewReadinessChecks {
  siteBuildReady: boolean;
  mobileQaPassed: boolean;
  routesGenerated: boolean;
  assetsPortable: boolean;
  noSignedUrls: boolean;
  noSecretsEmbedded: boolean;
  noHardcodedHostPaths: boolean;
  dryRunPlanAvailable: boolean;
  deploymentTargetConfigured: boolean;
  liveDeployDisabled: boolean;
  /**
   * Milestone 10 backlink-preservation readiness. These default to `true` when
   * the backlink layer was not evaluated (backlink context absent) so existing
   * M1–M9 flows are unaffected.
   */
  backlinkInventoryPresent: boolean;
  backlinkHighValueMapped: boolean;
  backlinkRedirectPlanReady: boolean;
}

export type PreviewStatus = 'preview_ready' | 'preview_blocked' | 'preview_rejected';
export type TargetStatus =
  | 'target_ready_for_future_deploy'
  | 'target_incomplete'
  | 'target_not_configured';
export type OverallReadinessStatus =
  | 'approved_for_deployment_readiness'
  | 'approved_preview_only_target_incomplete'
  | 'blocked'
  | 'rejected';

export interface PreviewReadinessContext {
  businessId: string;
  /** Whether the business row exists + is accessible (resolved by caller). */
  businessExists: boolean;
  build: PreviewBuildLike | null;
  /** Re-rendered static package files (may be empty when render failed). */
  files: RenderedFile[];
  mobileQa: PreviewMobileQaLike | null;
  /** Read-only sitemap approval state (resolved by caller). */
  sitemapApproved: boolean;
  /** Whether an approved/usable copy artifact exists (resolved by caller). */
  copyArtifactExists: boolean;
  /** Deployment target config (null when none configured). */
  target: DeployTargetConfig | null;
  /** Raw target row status (draft|configured|disabled|archived) when present. */
  targetStatusRaw?: string | null;
  dryRunPlan: DryRunPlan | null;
  /** Caller must pass true only if a live deploy/publish was requested. */
  deployRequested?: boolean;
  /**
   * Milestone 10 backlink-preservation context. Absent/undefined = the backlink
   * layer was not evaluated for this build (existing M1–M9 behaviour, no gating).
   * When present, high/critical unmapped backlinked URLs BLOCK readiness so the
   * site is never marked ready-for-future-deploy while high-value URLs would 404.
   */
  backlink?: BacklinkReadinessContext | null;
}

export interface BacklinkReadinessContext {
  /** True when a backlink inventory row exists for the business/project. */
  inventoryPresent: boolean;
  /** InventoryStatus value (e.g. complete | incomplete_provider_missing). */
  inventoryStatus: string | null;
  /** True when no external backlink provider contributed (crawl-only). */
  providerMissing: boolean;
  /** Enriched preservation mappings (priority + backlink counts resolved). */
  mappings: PreservationMapping[];
  /** True when a durable redirect-plan artifact could be computed. */
  redirectPlanPresent: boolean;
  /** True when the static package emitted a `_redirects` artifact. */
  redirectsArtifactPresent: boolean;
  /** True when the chosen deployment adapter natively supports 301 redirects. */
  adapterSupportsRedirects: boolean;
}

export interface PreviewReadinessResult {
  previewStatus: PreviewStatus;
  targetStatus: TargetStatus;
  /** The overall status this preview WOULD receive on approval. */
  recommendedStatus: OverallReadinessStatus;
  /** True when the preview passes every content/build gate (approvable). */
  approvable: boolean;
  checks: PreviewReadinessChecks;
  blockingReasons: PreviewReadinessIssue[];
  warnings: string[];
  refs: {
    businessId: string;
    siteBuildId: string | null;
    buildStatus: string | null;
    sourceRef: string | null;
    hasManifest: boolean;
    routeCount: number;
    pageFileCount: number;
    materializedImageCount: number;
    mobileQaId: string | null;
    mobileQaScore: number | null;
    targetType: string | null;
  };
}

/** Count critical route failures recorded in the QA report (best-effort). */
function countCriticalQaFailures(qa: PreviewMobileQaLike | null): number {
  if (!qa) return 0;
  if (qa.failedRoutesCount && qa.failedRoutesCount > 0) return qa.failedRoutesCount;
  const routes = qa.qaJson?.routes;
  if (!Array.isArray(routes)) return 0;
  let count = 0;
  for (const r of routes) {
    const checks = r?.checks;
    if (Array.isArray(checks)) {
      if (checks.some((c: any) => c?.status === 'fail' && c?.severity === 'critical')) count += 1;
    }
  }
  return count;
}

export function evaluatePreviewReadiness(ctx: PreviewReadinessContext): PreviewReadinessResult {
  const blocking: PreviewReadinessIssue[] = [];
  const warnings: string[] = [];
  const build = ctx.build;
  const manifest = build?.artifactManifestJson || null;

  // 0) A live deploy / publish is NEVER allowed here.
  if (ctx.deployRequested) {
    blocking.push({
      code: 'deploy_requested',
      message: 'Deploy/publish is disabled. Preview approval is a readiness gate only — it never deploys or publishes.',
    });
  }

  // 1) Business must exist + be accessible.
  if (!ctx.businessExists) {
    blocking.push({ code: 'business_missing', message: `Business ${ctx.businessId} not found or not accessible.` });
  }

  // 2) SiteBuild must exist.
  if (!build) {
    blocking.push({ code: 'build_missing', message: 'No static preview build found to review.' });
  } else {
    // 3) SiteBuild must belong to the selected business.
    if (build.businessId !== ctx.businessId) {
      blocking.push({ code: 'build_wrong_business', message: 'The selected build does not belong to this business.' });
    }
    // 4) SiteBuild status must be ready_for_preview.
    if (build.buildStatus !== READY_FOR_PREVIEW) {
      blocking.push({
        code: 'build_not_ready',
        message: `Build status is "${build.buildStatus}"; preview approval requires "${READY_FOR_PREVIEW}".`,
      });
    }
    // 5) Static package sourceRef must exist.
    if (!build.sourceRef) {
      blocking.push({ code: 'source_ref_missing', message: 'The build has no static package sourceRef.' });
    }
    // 6) Artifact manifest must exist.
    if (!manifest) {
      blocking.push({ code: 'manifest_missing', message: 'The build has no artifact manifest to inspect.' });
    }
  }

  // 7) Package must declare routes.
  const routeCount = manifest?.routes?.length || manifest?.pages?.length || 0;
  if (manifest && routeCount === 0) {
    blocking.push({ code: 'no_routes', message: 'The package manifest declares no routes.' });
  }

  // 8) Sitemap must be approved.
  if (!ctx.sitemapApproved) {
    blocking.push({ code: 'sitemap_not_approved', message: 'The sitemap for this build is not approved.' });
  }

  // 9) An approved copy artifact must exist.
  if (!ctx.copyArtifactExists) {
    blocking.push({ code: 'copy_artifact_missing', message: 'No approved copy artifact exists for this build.' });
  }

  // 10) Local image assets must be present where required.
  const copied = manifest?.assets?.copied?.length || 0;
  const missingAssets = manifest?.assets?.missing || [];
  const failedAssets = manifest?.assets?.failed || [];
  if (manifest && missingAssets.length > 0) {
    blocking.push({
      code: 'images_not_present',
      message: `${missingAssets.length} required image asset(s) are not present in the package.`,
    });
  }
  if (manifest && failedAssets.length > 0) {
    warnings.push(`${failedAssets.length} image asset(s) failed to download during the build.`);
  }

  // 11) Mobile QA must exist for THIS build.
  const qa = ctx.mobileQa;
  if (!qa) {
    blocking.push({ code: 'mobile_qa_missing', message: 'No mobile QA result exists for this build.' });
  } else {
    if (build && qa.siteBuildId !== build.id) {
      blocking.push({ code: 'mobile_qa_missing', message: 'The mobile QA result is not for this build.' });
    }
    // 12) Mobile QA must be passed.
    if (!(qa.passed && qa.status === 'passed')) {
      blocking.push({
        code: 'mobile_qa_not_passed',
        message: `Mobile QA status is "${qa.status}" (passed=${qa.passed}); it must be passed.`,
      });
    }
    // 13) No critical mobile QA failures.
    const critical = countCriticalQaFailures(qa);
    if (critical > 0) {
      blocking.push({
        code: 'mobile_qa_critical_failures',
        message: `Mobile QA reported ${critical} critical route failure(s).`,
      });
    }
  }

  // 14) No signed URLs in the re-rendered package.
  const signedFile = ctx.files.find((f) => containsSignedUrl(f.content));
  const manifestAssets = [
    ...(manifest?.assets?.copied || []),
    ...(manifest?.assets?.missing || []),
    ...(manifest?.assets?.failed || []),
  ];
  const signedInManifest = manifestAssets.some((a) => a.sourceKind === 'r2_signed');
  const noSignedUrls = !signedFile && !signedInManifest;
  if (signedFile) {
    blocking.push({ code: 'signed_url_embedded', message: `A signed URL is embedded in ${signedFile.path}.` });
  }
  if (signedInManifest) {
    blocking.push({
      code: 'signed_url_embedded',
      message: 'An image asset stored a signed URL source instead of a durable key.',
    });
  }

  // 15) No secrets in the re-rendered package.
  const secretFile = ctx.files.find((f) => containsSecret(f.content));
  const noSecretsEmbedded = !secretFile;
  if (secretFile) {
    blocking.push({ code: 'secret_embedded', message: `A secret-like value is embedded in ${secretFile.path}.` });
  }

  // 16) No hardcoded HostGator/cPanel host paths in the package.
  const hostPathFile = ctx.files.find((f) => containsHardcodedHostPath(f.content));
  const noHardcodedHostPaths = !hostPathFile;
  if (hostPathFile) {
    blocking.push({
      code: 'hardcoded_host_path',
      message: `A hardcoded host/cPanel path is embedded in ${hostPathFile.path}.`,
    });
  }

  // 17) Dry-run plan must be available and confirm live deploy is disabled.
  const dryRunPlanAvailable = Boolean(ctx.dryRunPlan);
  if (!ctx.dryRunPlan) {
    blocking.push({ code: 'dry_run_plan_missing', message: 'No dry-run deployment plan is available.' });
  }
  const liveDeployDisabled = !ctx.dryRunPlan || ctx.dryRunPlan.liveDeployEnabled === false;
  if (ctx.dryRunPlan && ctx.dryRunPlan.liveDeployEnabled !== false) {
    blocking.push({
      code: 'live_deploy_not_disabled',
      message: 'The dry-run plan does not confirm live deploy is disabled.',
    });
  }

  // ── Deployment target readiness (SEPARATE — never blocks preview) ──────────
  const target = ctx.target;
  const targetStatusRaw = (ctx.targetStatusRaw || '').toLowerCase();
  let targetStatus: TargetStatus;
  const targetWarnings: string[] = [];
  if (!target) {
    targetStatus = 'target_not_configured';
  } else {
    const missing: string[] = [];
    if (BASE_PATH_REQUIRED_TYPES.has(target.targetType) && !target.deployBasePath) {
      missing.push('deployBasePath');
    }
    if (!target.domain) missing.push('domain');
    if (!target.credentialsRef) missing.push('credentialsRef');
    if (targetStatusRaw && targetStatusRaw !== 'configured') {
      missing.push(`target status is "${targetStatusRaw}" (expected "configured")`);
    }
    if (missing.length > 0) {
      targetStatus = 'target_incomplete';
      targetWarnings.push(`Deployment target incomplete: missing ${missing.join(', ')}.`);
    } else {
      targetStatus = 'target_ready_for_future_deploy';
    }
  }
  warnings.push(...targetWarnings);

  // ── Backlink preservation readiness (Milestone 10) ─────────────────────────
  // Absent context = backlink layer not evaluated → defaults keep prior flows
  // unaffected. When present, high/critical unmapped URLs BLOCK readiness so a
  // site is never marked ready-for-future-deploy while high-value URLs would 404.
  const bl = ctx.backlink;
  let backlinkInventoryPresent = false;
  let backlinkHighValueMapped = true;
  let backlinkRedirectPlanReady = true;
  if (bl) {
    if (!bl.inventoryPresent) {
      // Evaluated but no inventory available → warn (never a silent pass).
      warnings.push(
        'incomplete_provider_missing: no backlink inventory is available for this site, so backlink preservation could not be verified. Run a backlink scan or upload a backlink export before deploying.',
      );
    } else {
      backlinkInventoryPresent = true;

      // Provider coverage warning (crawl-only inventory).
      if (bl.providerMissing || bl.inventoryStatus === 'incomplete_provider_missing') {
        warnings.push(
          'incomplete_provider_missing: backlink provider data is unavailable; inventory is crawl-only and external backlink coverage may be incomplete.',
        );
      }

      // High/critical unmapped backlinked URL → BLOCK (would 404 on the new site).
      const highUnmapped = unmappedHighValue(bl.mappings);
      if (highUnmapped.length > 0) {
        backlinkHighValueMapped = false;
        blocking.push({
          code: 'backlink_high_value_unmapped',
          message: `${highUnmapped.length} high-value backlinked URL(s) are unmapped and would become 404s: ${highUnmapped
            .map((m) => `${m.oldPath} (${m.priority})`)
            .join(', ')}. Preserve, 301-redirect, or explicitly review them before this site can be marked ready.`,
        });
      }

      // Medium unmapped / needs-review → warning (does not block).
      const medReview = needsReviewMedium(bl.mappings);
      if (medReview.length > 0) {
        warnings.push(
          `${medReview.length} medium-value backlinked URL(s) still need review: ${medReview
            .map((m) => m.oldPath)
            .join(', ')}.`,
        );
      }

      // Low-value ignored URLs MUST carry a reason.
      const lowIgnoredNoReason = bl.mappings.filter(
        (m) => m.action === 'ignore_no_value' && !(m.reason && m.reason.trim()),
      );
      if (lowIgnoredNoReason.length > 0) {
        blocking.push({
          code: 'backlink_low_value_missing_reason',
          message: `${lowIgnoredNoReason.length} ignored backlinked URL(s) are missing a required reason: ${lowIgnoredNoReason
            .map((m) => m.oldPath)
            .join(', ')}.`,
        });
      }

      // Redirect plan + `_redirects` artifact are required when any 301 exists.
      const redirectsRequired = bl.mappings.some(
        (m) => m.action === 'redirect_301' && Boolean(m.newPath),
      );
      if (redirectsRequired) {
        if (!bl.redirectPlanPresent) {
          backlinkRedirectPlanReady = false;
          blocking.push({
            code: 'backlink_redirect_plan_missing',
            message: 'Backlinked URLs require 301 redirects but no redirect plan exists. Generate the redirect plan before this site can be marked ready.',
          });
        } else if (!bl.redirectsArtifactPresent) {
          blocking.push({
            code: 'backlink_redirects_artifact_missing',
            message: 'A redirect plan exists but the static package has not emitted a `_redirects` artifact. Rebuild the static site so redirects are included.',
          });
        }
        if (!bl.adapterSupportsRedirects) {
          warnings.push(
            'The selected deployment adapter does not natively apply 301 redirects — a follow-up action will be required to configure redirects at deploy time.',
          );
        }
      }
    }
  }

  const checks: PreviewReadinessChecks = {
    siteBuildReady:
      Boolean(build) &&
      build!.businessId === ctx.businessId &&
      build!.buildStatus === READY_FOR_PREVIEW &&
      Boolean(build!.sourceRef) &&
      Boolean(manifest),
    mobileQaPassed: Boolean(qa && qa.passed && qa.status === 'passed' && countCriticalQaFailures(qa) === 0),
    routesGenerated: routeCount > 0,
    assetsPortable: Boolean(manifest) && missingAssets.length === 0,
    noSignedUrls,
    noSecretsEmbedded,
    noHardcodedHostPaths,
    dryRunPlanAvailable,
    deploymentTargetConfigured: targetStatus === 'target_ready_for_future_deploy',
    liveDeployDisabled,
    backlinkInventoryPresent,
    backlinkHighValueMapped,
    backlinkRedirectPlanReady,
  };

  const approvable = blocking.length === 0;
  const previewStatus: PreviewStatus = approvable ? 'preview_ready' : 'preview_blocked';

  let recommendedStatus: OverallReadinessStatus;
  if (!approvable) {
    recommendedStatus = 'blocked';
  } else if (targetStatus === 'target_ready_for_future_deploy') {
    recommendedStatus = 'approved_for_deployment_readiness';
  } else {
    recommendedStatus = 'approved_preview_only_target_incomplete';
  }

  const pageFiles = ctx.files.filter((f) => /^app\/(.*\/)?page\.tsx$/.test(f.path));

  return {
    previewStatus,
    targetStatus,
    recommendedStatus,
    approvable,
    checks,
    blockingReasons: blocking,
    warnings,
    refs: {
      businessId: ctx.businessId,
      siteBuildId: build?.id || null,
      buildStatus: build?.buildStatus || null,
      sourceRef: build?.sourceRef || null,
      hasManifest: Boolean(manifest),
      routeCount,
      pageFileCount: pageFiles.length,
      materializedImageCount: copied,
      mobileQaId: qa?.id || null,
      mobileQaScore: qa?.score ?? null,
      targetType: target?.targetType || null,
    },
  };
}

/** Durable readiness-report shape persisted to DB (`readinessJson`). */
export interface WebsitePreviewReadinessReport {
  businessId: string;
  siteBuildId: string | null;
  mobileQaId: string | null;
  deploymentTargetId: string | null;
  status: OverallReadinessStatus | 'pending_review';
  previewStatus: PreviewStatus;
  targetStatus: TargetStatus;
  readyForFutureDeploy: boolean;
  deploymentDisabled: true;
  checkedAt: string;
  checks: PreviewReadinessChecks;
  routes: { path: string; title: string | null; status: string }[];
  assets: { copied: number; missing: number; failed: number; warnings: string[] };
  mobileQa: { score: number | null; status: string; criticalFailures: number; warnings: number } | null;
  dryRunPlan: {
    targetType: string;
    mode: string;
    liveDeployEnabled: false;
    wouldUploadCount: number;
    wouldDeleteCount: number;
    warnings: string[];
  } | null;
  blockingReasons: PreviewReadinessIssue[];
  warnings: string[];
  approval: { approvedBy: string | null; approvedAt: string | null; notes: string | null } | null;
  /** Milestone 10 backlink-preservation snapshot (null when not evaluated). */
  backlink: {
    inventoryPresent: boolean;
    inventoryStatus: string | null;
    providerMissing: boolean;
    totalMapped: number;
    highValueUnmapped: number;
    mediumNeedsReview: number;
    redirectPlanPresent: boolean;
    redirectsArtifactPresent: boolean;
    adapterSupportsRedirects: boolean;
    highValueMapped: boolean;
    redirectPlanReady: boolean;
  } | null;
}

export function buildReadinessReport(args: {
  result: PreviewReadinessResult;
  status: OverallReadinessStatus | 'pending_review';
  manifest: ArtifactManifest | null;
  mobileQa: PreviewMobileQaLike | null;
  deploymentTargetId: string | null;
  dryRunPlan: DryRunPlan | null;
  checkedAt: string;
  approval?: { approvedBy: string | null; approvedAt: string | null; notes: string | null } | null;
  backlink?: BacklinkReadinessContext | null;
}): WebsitePreviewReadinessReport {
  const { result, manifest, mobileQa, dryRunPlan } = args;
  const bl = args.backlink || null;
  const backlink = bl
    ? {
        inventoryPresent: bl.inventoryPresent,
        inventoryStatus: bl.inventoryStatus,
        providerMissing: bl.providerMissing,
        totalMapped: bl.mappings.length,
        highValueUnmapped: unmappedHighValue(bl.mappings).length,
        mediumNeedsReview: needsReviewMedium(bl.mappings).length,
        redirectPlanPresent: bl.redirectPlanPresent,
        redirectsArtifactPresent: bl.redirectsArtifactPresent,
        adapterSupportsRedirects: bl.adapterSupportsRedirects,
        highValueMapped: result.checks.backlinkHighValueMapped,
        redirectPlanReady: result.checks.backlinkRedirectPlanReady,
      }
    : null;

  const routes: { path: string; title: string | null; status: string }[] = [];
  if (manifest?.pages?.length) {
    for (const p of manifest.pages) {
      routes.push({ path: p.path, title: p.title || null, status: 'generated' });
    }
  } else if (manifest?.routes?.length) {
    for (const r of manifest.routes) routes.push({ path: r, title: null, status: 'generated' });
  }

  const assetTotals = manifest?.assets?.totals;
  const assets = {
    copied: assetTotals?.copied ?? manifest?.assets?.copied?.length ?? 0,
    missing: assetTotals?.missing ?? manifest?.assets?.missing?.length ?? 0,
    failed: assetTotals?.failed ?? manifest?.assets?.failed?.length ?? 0,
    warnings: (manifest?.warnings || []).slice(),
  };

  const critical =
    mobileQa && mobileQa.failedRoutesCount ? mobileQa.failedRoutesCount : 0;

  return {
    businessId: result.refs.businessId,
    siteBuildId: result.refs.siteBuildId,
    mobileQaId: result.refs.mobileQaId,
    deploymentTargetId: args.deploymentTargetId,
    status: args.status,
    previewStatus: result.previewStatus,
    targetStatus: result.targetStatus,
    readyForFutureDeploy: result.approvable,
    deploymentDisabled: true,
    checkedAt: args.checkedAt,
    checks: result.checks,
    routes,
    assets,
    mobileQa: mobileQa
      ? {
          score: mobileQa.score ?? null,
          status: mobileQa.status,
          criticalFailures: critical,
          warnings: mobileQa.warningCount || 0,
        }
      : null,
    dryRunPlan: dryRunPlan
      ? {
          targetType: dryRunPlan.targetType,
          mode: dryRunPlan.mode,
          liveDeployEnabled: false,
          wouldUploadCount: dryRunPlan.wouldUpload?.length || 0,
          wouldDeleteCount: dryRunPlan.wouldDelete?.length || 0,
          warnings: dryRunPlan.warnings || [],
        }
      : null,
    blockingReasons: result.blockingReasons,
    warnings: result.warnings,
    approval: args.approval || null,
    backlink,
  };
}
