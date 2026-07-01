/**
 * Milestone 7 — Mobile QA gate.
 *
 * Validates that every prerequisite is satisfied BEFORE the mobile QA analyzer
 * runs against a generated static preview package. The gate is pure/read-only:
 * it never generates, uploads, publishes or deploys, and it never returns
 * secret values or signed URLs.
 *
 * When the gate blocks, the orchestrator must NOT produce a passing QA report.
 * It may persist a `blocked` WebsiteMobileQa row (passed=false) for audit.
 */

import type { RenderedFile } from '@/lib/site-renderer';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { containsSignedUrl } from '@/lib/site-qa/mobile-qa';

export type MobileQaGateCode =
  | 'business_missing'
  | 'build_missing'
  | 'build_wrong_business'
  | 'build_not_ready'
  | 'source_ref_missing'
  | 'manifest_missing'
  | 'no_routes'
  | 'no_page_files'
  | 'images_not_materialized'
  | 'signed_url_embedded'
  | 'deploy_requested'
  | 'ok';

export interface MobileQaGateIssue {
  code: MobileQaGateCode;
  message: string;
}

export interface MobileQaBuildLike {
  id: string;
  businessId: string;
  buildStatus: string;
  sourceRef: string | null;
  artifactManifestJson: ArtifactManifest | null;
}

export interface MobileQaGateContext {
  businessId: string;
  /** Whether the business row exists + is accessible (resolved by caller). */
  businessExists: boolean;
  build: MobileQaBuildLike | null;
  /** Re-rendered static package files (may be empty when render failed). */
  files: RenderedFile[];
  /** Caller must pass true only if a live deploy/publish was requested. */
  deployRequested?: boolean;
}

export interface MobileQaGateResult {
  ok: boolean;
  blocking: MobileQaGateIssue[];
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
  };
}

const READY_FOR_PREVIEW = 'ready_for_preview';

export function evaluateMobileQaGate(ctx: MobileQaGateContext): MobileQaGateResult {
  const blocking: MobileQaGateIssue[] = [];
  const warnings: string[] = [];
  const build = ctx.build;
  const manifest = build?.artifactManifestJson || null;

  // 0) Live deploy / publish is never allowed here.
  if (ctx.deployRequested) {
    blocking.push({
      code: 'deploy_requested',
      message: 'Deploy/publish is disabled. Mobile QA is a dry-run inspection only.',
    });
  }

  // 1) Business must exist + be accessible.
  if (!ctx.businessExists) {
    blocking.push({ code: 'business_missing', message: `Business ${ctx.businessId} not found or not accessible.` });
  }

  // 2) SiteBuild must exist.
  if (!build) {
    blocking.push({ code: 'build_missing', message: 'No static preview build found to QA.' });
  } else {
    // 3) SiteBuild must belong to the selected business.
    if (build.businessId !== ctx.businessId) {
      blocking.push({
        code: 'build_wrong_business',
        message: 'The selected build does not belong to this business.',
      });
    }
    // 4) SiteBuild status must be ready_for_preview.
    if (build.buildStatus !== READY_FOR_PREVIEW) {
      blocking.push({
        code: 'build_not_ready',
        message: `Build status is "${build.buildStatus}"; mobile QA requires "${READY_FOR_PREVIEW}".`,
      });
    }
    // 5) Static package sourceRef must exist.
    if (!build.sourceRef) {
      blocking.push({
        code: 'source_ref_missing',
        message: 'The build has no static package sourceRef.',
      });
    }
    // 6) Artifact manifest must exist.
    if (!manifest) {
      blocking.push({
        code: 'manifest_missing',
        message: 'The build has no artifact manifest to inspect.',
      });
    }
  }

  // 7) Package must have routes.
  const routeCount = manifest?.routes?.length || manifest?.pages?.length || 0;
  if (manifest && routeCount === 0) {
    blocking.push({ code: 'no_routes', message: 'The package manifest declares no routes.' });
  }

  // 8) Package must contain app/*/page route files (re-rendered).
  const pageFiles = ctx.files.filter((f) => /^app\/(.*\/)?page\.tsx$/.test(f.path));
  if (build && ctx.files.length > 0 && pageFiles.length === 0) {
    blocking.push({
      code: 'no_page_files',
      message: 'The re-rendered package contains no app route/page files.',
    });
  }

  // 9) Local image assets must be materialized (when the package needs images).
  const copied = manifest?.assets?.copied?.length || 0;
  const missing = manifest?.assets?.missing || [];
  const failed = manifest?.assets?.failed || [];
  if (manifest && missing.length > 0) {
    // Missing required images is a hard block — the site would show broken heroes.
    blocking.push({
      code: 'images_not_materialized',
      message: `${missing.length} image asset(s) were not materialized into the package.`,
    });
  }
  if (manifest && failed.length > 0) {
    warnings.push(`${failed.length} image asset(s) failed to download during the build.`);
  }

  // 10) No signed URLs embedded in the re-rendered package.
  const signedFile = ctx.files.find((f) => containsSignedUrl(f.content));
  if (signedFile) {
    blocking.push({
      code: 'signed_url_embedded',
      message: `A signed URL is embedded in ${signedFile.path}.`,
    });
  }
  // 10b) Manifest asset stored a signed source.
  const allAssets = [
    ...(manifest?.assets?.copied || []),
    ...(manifest?.assets?.missing || []),
    ...(manifest?.assets?.failed || []),
  ];
  if (allAssets.some((a) => a.sourceKind === 'r2_signed')) {
    blocking.push({
      code: 'signed_url_embedded',
      message: 'An image asset stored a signed URL source instead of a durable key.',
    });
  }

  return {
    ok: blocking.length === 0,
    blocking,
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
    },
  };
}
