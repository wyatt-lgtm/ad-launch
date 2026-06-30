/**
 * Phase 3 — static package build orchestrator (artifact mode).
 *
 * Pipeline:
 *   1. Build the platform-neutral Site Blueprint from a WebsiteProduction.
 *   2. Render the static package (in-memory file map) and write it to disk.
 *   3. Materialize assets into public/images (portable local files).
 *   4. Optionally run install/build — GATED behind STATIC_BUILD_EXEC_ENABLED
 *      (default OFF). In the default "artifact mode" no npm/build is executed;
 *      the build command is recorded for a future, explicitly-approved phase.
 *   5. Build a safe artifact manifest.
 *   6. Persist a SiteBuild record (building -> ready_for_preview | build_failed).
 *
 * HARD RULES: never deploys, never publishes, never changes a customer domain,
 * never advances status past `ready_for_preview`, never logs secrets. Build
 * failures are recorded on the SiteBuild row, not swallowed.
 */

import path from 'path';
import { prisma } from '@/lib/db';
import { buildSiteBlueprint } from '@/lib/site-blueprint';
import { renderStaticSite, writeSitePackage } from '@/lib/site-renderer';
import {
  materializeAssets,
  createDefaultAssetFetcher,
  type AssetFetcher,
  type MaterializationResult,
} from '@/lib/site-renderer/assets';
import { buildArtifactManifest, type ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

export const BUILD_STATUS = {
  DRAFT: 'draft',
  BUILDING: 'building',
  BUILD_FAILED: 'build_failed',
  READY_FOR_PREVIEW: 'ready_for_preview',
} as const;

/** The build command that WOULD run if/when execution is enabled. */
export const STATIC_BUILD_COMMAND = 'npm install --no-audit --no-fund && npm run build';

export function isBuildExecEnabled(): boolean {
  return process.env.STATIC_BUILD_EXEC_ENABLED === 'true';
}

export interface BuildStaticSiteOptions {
  businessId: string;
  websiteProductionId: string;
  websiteProjectId?: string;
  deploymentTargetId?: string | null;
  createdByUserId?: string | null;
  /** Override the asset fetcher (tests inject a deterministic one). */
  fetcher?: AssetFetcher;
  /** Base dir for generated packages. Defaults to project generated dir. */
  outputRoot?: string;
  /** When false, skips writing files/bytes to disk (pure dry inspection). */
  writeFiles?: boolean;
}

export interface BuildStaticSiteResult {
  siteBuildId: string;
  buildStatus: string;
  buildNumber: number;
  outputDir: string;
  sourceRef: string;
  outputRef: string | null;
  artifactManifest: ArtifactManifest;
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
 * Run a static site build in artifact mode and persist a SiteBuild record.
 */
export async function buildStaticSite(
  opts: BuildStaticSiteOptions,
): Promise<BuildStaticSiteResult> {
  const { businessId, websiteProductionId } = opts;
  const writeFiles = opts.writeFiles !== false;

  // Resolve the project id (needed for the required SiteBuild relation).
  const production = await prisma.websiteProduction.findFirst({
    where: { id: websiteProductionId, businessId },
    select: { id: true, websiteProjectId: true },
  });
  if (!production) {
    throw new Error(`WebsiteProduction ${websiteProductionId} not found for business ${businessId}`);
  }
  const websiteProjectId = opts.websiteProjectId || production.websiteProjectId;

  const buildNumber = await nextBuildNumber(websiteProjectId);

  // Create the SiteBuild row up-front in `building` state so failures persist.
  const build = await prisma.siteBuild.create({
    data: {
      businessId,
      websiteProjectId,
      websiteProductionId,
      deploymentTargetId: opts.deploymentTargetId || null,
      buildStatus: BUILD_STATUS.BUILDING,
      buildNumber,
      startedAt: new Date(),
      createdByUserId: opts.createdByUserId || null,
    },
    select: { id: true },
  });

  try {
    // 1) Blueprint
    const blueprint = await buildSiteBlueprint({ businessId, websiteProductionId });

    // 2) Render + write package
    const pkg = renderStaticSite(blueprint, { outputRoot: opts.outputRoot });
    const outputDir = pkg.outputDir;
    if (writeFiles) writeSitePackage(pkg);
    const sourceRef = outputDir;

    // 3) Materialize assets (need r2 keys for the default fetcher)
    let fetcher = opts.fetcher;
    if (!fetcher) {
      const assetRows = await prisma.websiteAsset.findMany({
        where: { businessId, productionId: websiteProductionId },
        select: { id: true, r2Key: true },
      });
      const r2KeyByAssetId = new Map<string, string | null>(
        assetRows.map((a) => [a.id, a.r2Key]),
      );
      fetcher = createDefaultAssetFetcher({ r2KeyByAssetId });
    }
    const materialization: MaterializationResult = await materializeAssets(
      blueprint.assetManifest,
      outputDir,
      fetcher,
      { writeFiles },
    );

    // 4) Build execution is GATED. Default artifact mode does not run npm.
    const buildExecuted = false; // never executes in this phase
    const outputRef = buildExecuted ? path.join(outputDir, 'out') : null;

    // 5) Artifact manifest
    const artifactManifest = buildArtifactManifest({
      blueprint,
      renderManifest: pkg.manifest,
      materialization,
      sourceRef,
      outputRef,
      buildCommand: STATIC_BUILD_COMMAND,
      buildExecuted,
      buildResult: 'artifact_only',
    });

    // 6) Persist success (ready_for_preview — never further)
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
      siteBuildId: build.id,
      buildStatus: BUILD_STATUS.READY_FOR_PREVIEW,
      buildNumber,
      outputDir,
      sourceRef,
      outputRef,
      artifactManifest,
    };
  } catch (err: any) {
    const errorMessage = (err?.message || String(err)).slice(0, 2000);
    // Record the failure — never swallow it.
    await prisma.siteBuild.update({
      where: { id: build.id },
      data: {
        buildStatus: BUILD_STATUS.BUILD_FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });
    return {
      siteBuildId: build.id,
      buildStatus: BUILD_STATUS.BUILD_FAILED,
      buildNumber,
      outputDir: '',
      sourceRef: '',
      outputRef: null,
      artifactManifest: undefined as any,
      errorMessage,
    };
  }
}
