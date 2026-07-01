/**
 * Milestone 6 — sitemap-first static build orchestrator (artifact mode).
 *
 * Consumes ONLY the approved sitemap-first artifacts (WebsiteSitemap +
 * WebsitePageCopy + approved/generated WebsiteGeneratedImageAsset + business/
 * brand context) and produces a portable static package + artifact manifest +
 * a persisted SiteBuild record. It NEVER parses concept HTML as a source of
 * truth.
 *
 * Pipeline:
 *   1. Resolve inputs from the sitemap-first stores.
 *   2. Evaluate the static build gate. If it does not pass, return WITHOUT
 *      creating a SiteBuild row (nothing was built).
 *   3. Create a SiteBuild row (building) — a build attempt has now started.
 *   4. Assemble the Site Blueprint from sitemap-first data.
 *   5. Render + write the static package.
 *   6. Materialize approved/generated images from durable R2 keys into
 *      public/images (no signed URLs).
 *   7. Run post-build validation (errors -> build failure).
 *   8. Build a safe artifact manifest and persist ready_for_preview.
 *
 * HARD RULES: never generates images, never publishes, never deploys, never
 * advances past `ready_for_preview`, never logs/persists secrets or signed
 * URLs. Furthest status reachable here is `ready_for_preview`.
 */

import { prisma } from '@/lib/db';
import { ensureWebsiteProject } from '@/lib/website-workflow';
import { renderStaticSite, writeSitePackage } from '@/lib/site-renderer';
import {
  materializeAssets,
  type AssetFetcher,
  type MaterializationResult,
} from '@/lib/site-renderer/assets';
import { buildArtifactManifest, type ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import {
  resolveSitemapBuildInputs,
  type ResolvedBuildInputs,
} from '@/lib/site-builder/sitemap-build-inputs';
import {
  evaluateGateFromInputs,
  type StaticBuildGateResult,
} from '@/lib/site-builder/static-build-gate';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { createGeneratedAssetFetcher } from '@/lib/site-builder/generated-asset-fetcher';
import { validateStaticPackage } from '@/lib/site-builder/post-build-validation';
import { BUILD_STATUS, STATIC_BUILD_COMMAND } from '@/lib/site-builder';

export interface BuildFromSitemapOptions {
  businessId: string;
  websiteProjectId?: string;
  createdByUserId?: string | null;
  deploymentTargetId?: string | null;
  /** Inject a deterministic fetcher (tests / offline). */
  fetcher?: AssetFetcher;
  /** Base dir for generated packages. */
  outputRoot?: string;
  /** When false, skips writing files to disk (pure inspection). */
  writeFiles?: boolean;
  /** Must be false/undefined — deploy is never allowed in this milestone. */
  deployRequested?: boolean;
}

export interface BuildFromSitemapResult {
  ok: boolean;
  /** Gate result (always present). */
  gate: StaticBuildGateResult;
  /** Present only when a build attempt started (gate passed). */
  siteBuildId?: string;
  buildStatus?: string;
  buildNumber?: number;
  outputDir?: string;
  sourceRef?: string;
  outputRef?: string | null;
  artifactManifest?: ArtifactManifest;
  postBuildIssues?: { code: string; severity: string; message: string }[];
  errorMessage?: string;
}

async function nextBuildNumber(websiteProjectId: string): Promise<number> {
  const last = await prisma.siteBuild.findFirst({
    where: { websiteProjectId },
    orderBy: { buildNumber: 'desc' },
    select: { buildNumber: true },
  });
  return (last?.buildNumber || 0) + 1;
}

/**
 * Build a static site package from approved sitemap-first artifacts.
 */
export async function buildStaticSiteFromSitemap(
  opts: BuildFromSitemapOptions,
): Promise<BuildFromSitemapResult> {
  const { businessId } = opts;
  const writeFiles = opts.writeFiles !== false;

  // 1) Resolve sitemap-first inputs.
  const inputs: ResolvedBuildInputs = await resolveSitemapBuildInputs(
    businessId,
    opts.websiteProjectId,
  );

  // 2) Gate — no SiteBuild row is created if this does not pass.
  const gate = evaluateGateFromInputs(businessId, inputs, {
    deployRequested: opts.deployRequested === true,
  });
  if (!gate.ok) {
    return { ok: false, gate };
  }

  // 3) Resolve the required websiteProjectId and create the build row.
  let websiteProjectId = opts.websiteProjectId || inputs.websiteProjectId || null;
  if (!websiteProjectId) {
    const project = await ensureWebsiteProject(businessId);
    websiteProjectId = project.id;
  }

  const buildNumber = await nextBuildNumber(websiteProjectId);
  const build = await prisma.siteBuild.create({
    data: {
      businessId,
      websiteProjectId,
      websiteProductionId: null, // sitemap-first builds are not production-record based
      deploymentTargetId: opts.deploymentTargetId || null,
      buildStatus: BUILD_STATUS.BUILDING,
      buildNumber,
      startedAt: new Date(),
      createdByUserId: opts.createdByUserId || null,
    },
    select: { id: true },
  });

  try {
    // 4) Blueprint from sitemap-first artifacts.
    const { blueprint, assetSources } = assembleSitemapBlueprint(inputs);

    // 5) Render + write package.
    const pkg = renderStaticSite(blueprint, { outputRoot: opts.outputRoot });
    const outputDir = pkg.outputDir;
    if (writeFiles) writeSitePackage(pkg);
    const sourceRef = outputDir;

    // 6) Materialize approved/generated images from durable R2 keys.
    const fetcher = opts.fetcher || createGeneratedAssetFetcher(assetSources);
    const materialization: MaterializationResult = await materializeAssets(
      blueprint.assetManifest,
      outputDir,
      fetcher,
      { writeFiles },
    );

    // 7) Post-build validation (errors -> build failure).
    const validation = validateStaticPackage({
      blueprint,
      renderManifest: pkg.manifest,
      materialization,
      sitemap: inputs.sitemap!,
      files: pkg.files,
    });
    if (!validation.ok) {
      const summary = validation.errors
        .map((e) => `${e.code}: ${e.message}`)
        .join('; ')
        .slice(0, 1800);
      throw new Error(`Post-build validation failed: ${summary}`);
    }

    // 8) Artifact manifest (build execution is GATED off in this milestone).
    const buildExecuted = false;
    const outputRef = null;
    const extraWarnings = [
      ...gate.warnings,
      ...validation.warnings.map((w) => `${w.code}: ${w.message}`),
    ];
    const artifactManifest = buildArtifactManifest({
      blueprint,
      renderManifest: pkg.manifest,
      materialization,
      sourceRef,
      outputRef,
      buildCommand: STATIC_BUILD_COMMAND,
      buildExecuted,
      buildResult: 'artifact_only',
      extraWarnings,
    });

    await prisma.siteBuild.update({
      where: { id: build.id },
      data: {
        buildStatus: BUILD_STATUS.READY_FOR_PREVIEW,
        sourceRef,
        outputRef,
        artifactManifestJson: artifactManifest as any,
        completedAt: new Date(),
      },
    });

    return {
      ok: true,
      gate,
      siteBuildId: build.id,
      buildStatus: BUILD_STATUS.READY_FOR_PREVIEW,
      buildNumber,
      outputDir,
      sourceRef,
      outputRef,
      artifactManifest,
      postBuildIssues: validation.issues,
    };
  } catch (err: any) {
    const errorMessage = (err?.message || String(err)).slice(0, 2000);
    await prisma.siteBuild.update({
      where: { id: build.id },
      data: {
        buildStatus: BUILD_STATUS.BUILD_FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });
    return {
      ok: false,
      gate,
      siteBuildId: build.id,
      buildStatus: BUILD_STATUS.BUILD_FAILED,
      buildNumber,
      errorMessage,
    };
  }
}
