/**
 * Milestone 9 — Cloudflare Pages readiness orchestrator.
 *
 * Loads all read-only inputs the pure Cloudflare readiness gate needs:
 *   - the SiteDeploymentTarget row (business-scoped),
 *   - the latest static package artifact manifest (for the image checks),
 *   - a fresh in-memory re-render of the static package (for signed-url /
 *     secret / next.config / package.json checks),
 *   - env-token presence booleans (references only),
 *   - the configured public env var NAMES for the target (names only).
 *
 * It then runs the pure gate + dry-run planner and returns a durable,
 * secret-free readiness report.
 *
 * HARD RULES: never calls the Cloudflare API, never creates / connects a Pages
 * project, never mutates DNS, never uploads / publishes / deploys, never returns
 * or persists secret token values or signed URLs. liveDeployEnabled is always
 * false.
 */

import { prisma } from '@/lib/db';
import { renderStaticSite, type RenderedFile } from '@/lib/site-renderer';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { resolveSitemapBuildInputs } from '@/lib/site-builder/sitemap-build-inputs';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { getCloudflareReadiness } from '@/lib/site-deploy/asset-store-config';
import { TARGET_SELECT, serializeTarget, type TargetRow } from '@/lib/site-deploy/target-config';
import {
  evaluateCloudflareReadiness,
  computeCloudflarePagesDryRun,
  getManualSetupChecklist,
  type CloudflareTargetConfig,
  type CloudflareReadinessResult,
  type CloudflarePagesDryRunPlan,
  type ChecklistStep,
} from '@/lib/site-deploy/cloudflare-readiness';

function toCloudflareTargetConfig(t: TargetRow): CloudflareTargetConfig {
  return {
    targetType: t.targetType,
    status: t.status,
    cloudflareAccountId: t.cloudflareAccountId,
    cloudflareZoneId: t.cloudflareZoneId,
    cloudflareProjectName: t.cloudflareProjectName,
    cloudflareProjectRef: t.cloudflareProjectRef,
    githubRepoUrl: t.githubRepoUrl,
    githubBranch: t.githubBranch,
    gitRepoUrl: t.gitRepoUrl,
    gitBranch: t.gitBranch,
    productionBranch: t.productionBranch,
    previewBranch: t.previewBranch,
    buildCommand: t.buildCommand,
    outputDirectory: t.outputDirectory,
    customDomain: t.customDomain,
    domain: t.domain,
    dnsMode: t.dnsMode,
    credentialsRef: t.credentialsRef,
  };
}

/** Re-render the static package (in memory) from the approved blueprint. */
async function rerenderPackage(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<RenderedFile[]> {
  try {
    const inputs = await resolveSitemapBuildInputs(businessId, websiteProjectId || undefined);
    if (!inputs.sitemap) return [];
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const pkg = renderStaticSite(blueprint, {});
    return pkg.files;
  } catch {
    return [];
  }
}

/** Load the latest usable artifact manifest for the business (read-only). */
async function loadLatestManifest(businessId: string): Promise<ArtifactManifest | null> {
  const build = await prisma.siteBuild.findFirst({
    where: { businessId, buildStatus: 'ready_for_preview' },
    orderBy: { updatedAt: 'desc' },
    select: { artifactManifestJson: true },
  });
  return (build?.artifactManifestJson as unknown as ArtifactManifest) || null;
}

/** Configured PUBLIC env var NAMES for the target/business (names only). */
async function loadConfiguredEnvVarNames(
  businessId: string,
  targetId: string,
): Promise<string[]> {
  const rows = await prisma.siteEnvironmentVariable.findMany({
    where: {
      businessId,
      isSecret: false,
      OR: [{ deploymentTargetId: targetId }, { deploymentTargetId: null }],
    },
    select: { key: true },
  });
  return Array.from(new Set(rows.map((r) => r.key).filter(Boolean)));
}

export interface CloudflareReadinessBundle {
  ok: boolean;
  notFound: boolean;
  target: ReturnType<typeof serializeTarget> | null;
  readiness: CloudflareReadinessResult | null;
  dryRunPlan: CloudflarePagesDryRunPlan | null;
  checklist: ChecklistStep[];
  liveDeployEnabled: false;
}

/**
 * Compute the full Cloudflare Pages readiness bundle for a target.
 * `deployRequested` must never be true from a normal request; it is only
 * threaded through so an explicit deploy attempt is hard-blocked by the gate.
 */
export async function computeCloudflareReadinessBundle(opts: {
  businessId: string;
  targetId: string;
  deployRequested?: boolean;
}): Promise<CloudflareReadinessBundle> {
  const targetRow = await prisma.siteDeploymentTarget.findFirst({
    where: { id: opts.targetId, businessId: opts.businessId },
    select: { ...TARGET_SELECT, websiteProjectId: true },
  });

  if (!targetRow) {
    return {
      ok: false,
      notFound: true,
      target: null,
      readiness: null,
      dryRunPlan: null,
      checklist: getManualSetupChecklist(),
      liveDeployEnabled: false,
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { id: true },
  });

  const t = targetRow as unknown as TargetRow;
  const cfConfig = toCloudflareTargetConfig(t);

  const [files, manifest, configuredEnvVarNames] = await Promise.all([
    rerenderPackage(opts.businessId, (targetRow as any).websiteProjectId),
    loadLatestManifest(opts.businessId),
    loadConfiguredEnvVarNames(opts.businessId, opts.targetId),
  ]);

  const readiness = evaluateCloudflareReadiness({
    businessId: opts.businessId,
    businessExists: Boolean(business),
    target: cfConfig,
    files,
    manifest,
    envReadiness: getCloudflareReadiness(),
    configuredEnvVarNames,
    deployRequested: opts.deployRequested === true,
  });

  const dryRunPlan = computeCloudflarePagesDryRun({
    target: cfConfig,
    readiness,
    configuredEnvVarNames,
  });

  return {
    ok: true,
    notFound: false,
    target: serializeTarget(t),
    readiness,
    dryRunPlan,
    checklist: getManualSetupChecklist(),
    liveDeployEnabled: false,
  };
}
