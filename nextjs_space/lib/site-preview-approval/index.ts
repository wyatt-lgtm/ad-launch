/**
 * Milestone 8 — Preview approval + deployment-readiness orchestrator.
 *
 * Ties together: load SiteBuild -> load latest mobile QA for the build -> load
 * the deployment target (if any) -> re-render the static package in memory from
 * the approved sitemap-first blueprint -> resolve sitemap/copy readiness
 * (read-only) -> compute a side-effect-free dry-run deploy plan -> run the pure
 * readiness gate -> persist a durable, auditable WebsitePreviewApproval record
 * with the readiness report.
 *
 * HARD RULES: never deploys, publishes, launches, uploads, changes DNS,
 * generates images/copy, or rebuilds the static site. Never advances
 * SiteBuild.buildStatus (it stays `ready_for_preview`). The furthest state a
 * preview can reach here is `approved_for_deployment_readiness` — a readiness
 * decision only, NEVER deployed/live/published. Never persists secrets or
 * signed URLs.
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { renderStaticSite, type RenderedFile } from '@/lib/site-renderer';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { resolveSitemapBuildInputs } from '@/lib/site-builder/sitemap-build-inputs';
import { evaluateGateFromInputs } from '@/lib/site-builder/static-build-gate';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { computeDryRunPlan, type DeployTargetConfig, type DryRunPlan } from '@/lib/site-deploy/dry-run';
import { TARGET_SELECT, type TargetRow } from '@/lib/site-deploy/target-config';
import {
  evaluatePreviewReadiness as runReadinessGate,
  buildReadinessReport,
  type PreviewBuildLike,
  type PreviewMobileQaLike,
  type PreviewReadinessResult,
  type WebsitePreviewReadinessReport,
  type OverallReadinessStatus,
  type BacklinkReadinessContext,
} from '@/lib/site-preview-approval/readiness-gate';
import { loadLatestInventory, loadEnrichedMappings, loadRedirectPlan } from '@/lib/site-backlinks/store';

/** Deployment adapters that natively apply 301 redirects from a `_redirects` file. */
const REDIRECT_CAPABLE_ADAPTERS = new Set(['cloudflare_pages', 'vercel']);

export interface EvaluatePreviewOptions {
  businessId: string;
  siteBuildId: string;
  websiteProjectId?: string | null;
  createdByUserId?: string | null;
  /** Must be false/undefined — a live deploy is never allowed here. */
  deployRequested?: boolean;
  /** When true, write website_preview_readiness.json into the package dir if present. */
  writeArtifactFile?: boolean;
}

export interface PreviewApprovalActionResult {
  ok: boolean;
  blocked: boolean;
  approvalId?: string;
  status: string;
  result: PreviewReadinessResult;
  report: WebsitePreviewReadinessReport;
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

function toDeployTargetConfig(target: TargetRow | null): DeployTargetConfig | null {
  if (!target) return null;
  return {
    targetType: target.targetType,
    domain: target.domain,
    siteUrl: target.siteUrl,
    deployBasePath: target.deployBasePath,
    credentialsRef: target.credentialsRef,
  };
}

interface LoadedContext {
  build: PreviewBuildLike | null;
  businessExists: boolean;
  websiteProjectId: string | null;
  mobileQa: PreviewMobileQaLike | null;
  target: TargetRow | null;
  files: RenderedFile[];
  sitemapApproved: boolean;
  copyArtifactExists: boolean;
  dryRunPlan: DryRunPlan | null;
  manifest: ArtifactManifest | null;
  backlink: BacklinkReadinessContext | null;
}

/** Load every input the readiness gate needs (all read-only). */
async function loadContext(opts: {
  businessId: string;
  siteBuildId: string;
  websiteProjectId?: string | null;
}): Promise<LoadedContext> {
  const buildRow = await prisma.siteBuild.findUnique({
    where: { id: opts.siteBuildId },
    select: {
      id: true,
      businessId: true,
      websiteProjectId: true,
      buildStatus: true,
      sourceRef: true,
      deploymentTargetId: true,
      artifactManifestJson: true,
    },
  });

  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { id: true },
  });

  const manifest =
    (buildRow?.artifactManifestJson as unknown as ArtifactManifest) || null;

  const build: PreviewBuildLike | null = buildRow
    ? {
        id: buildRow.id,
        businessId: buildRow.businessId,
        buildStatus: buildRow.buildStatus,
        sourceRef: buildRow.sourceRef,
        artifactManifestJson: manifest,
      }
    : null;

  const belongs = Boolean(buildRow && buildRow.businessId === opts.businessId);
  const websiteProjectId =
    opts.websiteProjectId || buildRow?.websiteProjectId || null;

  // Latest mobile QA for THIS build (scoped to business).
  let mobileQa: PreviewMobileQaLike | null = null;
  if (belongs) {
    const qaRow = await prisma.websiteMobileQa.findFirst({
      where: { siteBuildId: opts.siteBuildId, businessId: opts.businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        siteBuildId: true,
        status: true,
        passed: true,
        score: true,
        checkedRoutesCount: true,
        failedRoutesCount: true,
        warningCount: true,
        qaJson: true,
      },
    });
    if (qaRow) mobileQa = qaRow as unknown as PreviewMobileQaLike;
  }

  // Deployment target: prefer the build's target, else latest configured one.
  let target: TargetRow | null = null;
  if (belongs) {
    if (buildRow?.deploymentTargetId) {
      const t = await prisma.siteDeploymentTarget.findFirst({
        where: { id: buildRow.deploymentTargetId, businessId: opts.businessId },
        select: TARGET_SELECT,
      });
      if (t) target = t as unknown as TargetRow;
    }
    if (!target) {
      const t = await prisma.siteDeploymentTarget.findFirst({
        where: { businessId: opts.businessId, status: 'configured' },
        orderBy: { updatedAt: 'desc' },
        select: TARGET_SELECT,
      });
      if (t) target = t as unknown as TargetRow;
    }
    if (!target) {
      // Fall back to ANY target row (may be draft/incomplete) for readiness.
      const t = await prisma.siteDeploymentTarget.findFirst({
        where: { businessId: opts.businessId },
        orderBy: { updatedAt: 'desc' },
        select: TARGET_SELECT,
      });
      if (t) target = t as unknown as TargetRow;
    }
  }

  // Re-render package only when the build belongs to this business.
  const files = belongs
    ? await rerenderPackage(opts.businessId, websiteProjectId)
    : [];

  // Sitemap + copy readiness (read-only; reuses the M6 gate refs).
  let sitemapApproved = false;
  let copyArtifactExists = false;
  if (belongs) {
    try {
      const inputs = await resolveSitemapBuildInputs(
        opts.businessId,
        websiteProjectId || undefined,
      );
      const gate = evaluateGateFromInputs(opts.businessId, inputs);
      sitemapApproved = gate.refs.sitemapApproved;
      copyArtifactExists = (gate.refs.copyArtifactIds || []).length > 0;
    } catch {
      // Leave both false → gate will block with clear reasons.
    }
  }

  // Dry-run deploy plan (always computed when a manifest exists; never deploys).
  const dryRunPlan =
    belongs && manifest
      ? computeDryRunPlan({
          target: toDeployTargetConfig(target) || { targetType: 'unconfigured' },
          manifest,
        })
      : null;

  // Backlink-preservation readiness context (Milestone 10; all read-only).
  // Absent inventory => backlink layer not run for this site => never gates.
  let backlink: BacklinkReadinessContext | null = null;
  if (belongs) {
    try {
      const inv = await loadLatestInventory(opts.businessId, websiteProjectId);
      if (inv) {
        const mappings = await loadEnrichedMappings(opts.businessId, websiteProjectId);
        const plan = await loadRedirectPlan(opts.businessId, websiteProjectId);
        const redirectsArtifact = manifest?.redirects || null;
        backlink = {
          inventoryPresent: true,
          inventoryStatus: inv.status || inv.inventory?.status || null,
          providerMissing:
            inv.inventory?.providerMissing ?? inv.status === 'incomplete_provider_missing',
          mappings,
          redirectPlanPresent: Boolean(plan),
          redirectsArtifactPresent: Boolean(
            redirectsArtifact && (redirectsArtifact.count > 0 || redirectsArtifact.artifactPath),
          ),
          adapterSupportsRedirects: target
            ? REDIRECT_CAPABLE_ADAPTERS.has(target.targetType)
            : false,
        };
      }
    } catch {
      // Non-fatal: leave backlink null (layer treated as not evaluated).
      backlink = null;
    }
  }

  return {
    build,
    businessExists: Boolean(business),
    websiteProjectId,
    mobileQa,
    target,
    files,
    sitemapApproved,
    copyArtifactExists,
    dryRunPlan,
    manifest,
    backlink,
  };
}

function runGate(ctx: LoadedContext, businessId: string, deployRequested?: boolean) {
  return runReadinessGate({
    businessId,
    businessExists: ctx.businessExists,
    build: ctx.build,
    files: ctx.files,
    mobileQa: ctx.mobileQa,
    sitemapApproved: ctx.sitemapApproved,
    copyArtifactExists: ctx.copyArtifactExists,
    target: toDeployTargetConfig(ctx.target),
    targetStatusRaw: ctx.target?.status || null,
    dryRunPlan: ctx.dryRunPlan,
    deployRequested,
    backlink: ctx.backlink,
  });
}

/** Best-effort: write website_preview_readiness.json to disk if the dir exists. */
function maybeWriteArtifact(
  writeArtifactFile: boolean | undefined,
  sourceRef: string | null | undefined,
  report: WebsitePreviewReadinessReport,
) {
  if (!writeArtifactFile || !sourceRef) return;
  try {
    if (fs.existsSync(sourceRef) && fs.statSync(sourceRef).isDirectory()) {
      fs.writeFileSync(
        path.join(sourceRef, 'website_preview_readiness.json'),
        JSON.stringify(report, null, 2),
        'utf8',
      );
    }
  } catch {
    // Non-fatal — the durable copy is the DB readinessJson column.
  }
}

/**
 * Evaluate preview readiness and upsert a WebsitePreviewApproval row.
 * NEVER deploys/publishes/uploads and NEVER changes SiteBuild.buildStatus.
 */
export async function evaluatePreviewReadiness(
  opts: EvaluatePreviewOptions,
): Promise<PreviewApprovalActionResult> {
  const ctx = await loadContext({
    businessId: opts.businessId,
    siteBuildId: opts.siteBuildId,
    websiteProjectId: opts.websiteProjectId,
  });

  const result = runGate(ctx, opts.businessId, opts.deployRequested === true);
  const checkedAt = new Date().toISOString();
  const dbStatus = result.approvable ? 'pending_review' : 'blocked';

  const report = buildReadinessReport({
    result,
    status: dbStatus,
    manifest: ctx.manifest,
    mobileQa: ctx.mobileQa,
    deploymentTargetId: ctx.target?.id || null,
    dryRunPlan: ctx.dryRunPlan,
    checkedAt,
    backlink: ctx.backlink,
  });

  let approvalId: string | undefined;

  // Only persist when we have valid FK targets (build + business exist + own).
  const canPersist =
    ctx.build && ctx.businessExists && ctx.build.businessId === opts.businessId;

  if (canPersist) {
    // Update the most recent still-reviewable row for this build, else create.
    const existing = await prisma.websitePreviewApproval.findFirst({
      where: {
        businessId: opts.businessId,
        siteBuildId: opts.siteBuildId,
        status: { in: ['pending_review', 'blocked'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing) {
      const row = await prisma.websitePreviewApproval.update({
        where: { id: existing.id },
        data: {
          status: dbStatus,
          websiteProjectId: ctx.websiteProjectId,
          mobileQaId: ctx.mobileQa?.id || null,
          deploymentTargetId: ctx.target?.id || null,
          readinessJson: report as any,
        },
        select: { id: true },
      });
      approvalId = row.id;
    } else {
      const row = await prisma.websitePreviewApproval.create({
        data: {
          businessId: opts.businessId,
          websiteProjectId: ctx.websiteProjectId,
          siteBuildId: opts.siteBuildId,
          mobileQaId: ctx.mobileQa?.id || null,
          deploymentTargetId: ctx.target?.id || null,
          status: dbStatus,
          readinessJson: report as any,
        },
        select: { id: true },
      });
      approvalId = row.id;
    }
  }

  maybeWriteArtifact(opts.writeArtifactFile, ctx.build?.sourceRef, report);

  return {
    ok: result.approvable,
    blocked: !result.approvable,
    approvalId,
    status: dbStatus,
    result,
    report,
  };
}

export interface ApprovePreviewOptions {
  businessId: string;
  approvalId: string;
  approvedByUserId: string;
  notes?: string | null;
}

export interface RejectPreviewOptions {
  businessId: string;
  approvalId: string;
  rejectedByUserId: string;
  reason: string;
}

/**
 * Approve a preview for FUTURE deployment readiness ONLY. Re-evaluates the gate
 * fresh; if the preview is not ready, returns blocked (caller responds 422) and
 * leaves the row non-approved. On success sets an approved_* status — NEVER
 * deployed/live/published — and NEVER changes SiteBuild.buildStatus.
 */
export async function approvePreviewApproval(
  opts: ApprovePreviewOptions,
): Promise<PreviewApprovalActionResult & { notFound?: boolean }> {
  const approval = await prisma.websitePreviewApproval.findFirst({
    where: { id: opts.approvalId, businessId: opts.businessId },
    select: { id: true, siteBuildId: true, websiteProjectId: true },
  });

  if (!approval) {
    return {
      ok: false,
      blocked: true,
      notFound: true,
      status: 'not_found',
      result: undefined as unknown as PreviewReadinessResult,
      report: undefined as unknown as WebsitePreviewReadinessReport,
    };
  }

  const ctx = await loadContext({
    businessId: opts.businessId,
    siteBuildId: approval.siteBuildId,
    websiteProjectId: approval.websiteProjectId,
  });
  const result = runGate(ctx, opts.businessId, false);
  const checkedAt = new Date().toISOString();

  if (!result.approvable) {
    // Gate fails → keep blocked, do NOT approve, do NOT deploy/publish.
    const report = buildReadinessReport({
      result,
      status: 'blocked',
      manifest: ctx.manifest,
      mobileQa: ctx.mobileQa,
      deploymentTargetId: ctx.target?.id || null,
      dryRunPlan: ctx.dryRunPlan,
      checkedAt,
      backlink: ctx.backlink,
    });
    await prisma.websitePreviewApproval.update({
      where: { id: approval.id },
      data: {
        status: 'blocked',
        mobileQaId: ctx.mobileQa?.id || null,
        deploymentTargetId: ctx.target?.id || null,
        readinessJson: report as any,
      },
    });
    return { ok: false, blocked: true, approvalId: approval.id, status: 'blocked', result, report };
  }

  const approvedStatus: OverallReadinessStatus =
    result.targetStatus === 'target_ready_for_future_deploy'
      ? 'approved_for_deployment_readiness'
      : 'approved_preview_only_target_incomplete';

  const approvedAt = checkedAt;
  const report = buildReadinessReport({
    result,
    status: approvedStatus,
    manifest: ctx.manifest,
    mobileQa: ctx.mobileQa,
    deploymentTargetId: ctx.target?.id || null,
    dryRunPlan: ctx.dryRunPlan,
    checkedAt,
    backlink: ctx.backlink,
    approval: { approvedBy: opts.approvedByUserId, approvedAt, notes: opts.notes || null },
  });

  await prisma.websitePreviewApproval.update({
    where: { id: approval.id },
    data: {
      status: approvedStatus,
      mobileQaId: ctx.mobileQa?.id || null,
      deploymentTargetId: ctx.target?.id || null,
      approvedByUserId: opts.approvedByUserId,
      approvedAt,
      approvalNotes: opts.notes || null,
      readinessJson: report as any,
    },
  });
  // NOTE: SiteBuild.buildStatus is intentionally NOT changed (stays ready_for_preview).

  return { ok: true, blocked: false, approvalId: approval.id, status: approvedStatus, result, report };
}

/** Reject a preview. Stores the reason; never deletes the build; never deploys. */
export async function rejectPreviewApproval(
  opts: RejectPreviewOptions,
): Promise<{ ok: boolean; notFound?: boolean; approvalId?: string; status: string }> {
  const approval = await prisma.websitePreviewApproval.findFirst({
    where: { id: opts.approvalId, businessId: opts.businessId },
    select: { id: true, readinessJson: true },
  });
  if (!approval) return { ok: false, notFound: true, status: 'not_found' };

  const rejectedAt = new Date().toISOString();
  const existingReport =
    (approval.readinessJson as unknown as WebsitePreviewReadinessReport) || null;
  const report = existingReport
    ? { ...existingReport, status: 'rejected' as const }
    : null;

  await prisma.websitePreviewApproval.update({
    where: { id: approval.id },
    data: {
      status: 'rejected',
      rejectedByUserId: opts.rejectedByUserId,
      rejectedAt,
      rejectionReason: opts.reason,
      ...(report ? { readinessJson: report as any } : {}),
    },
  });

  return { ok: true, approvalId: approval.id, status: 'rejected' };
}
