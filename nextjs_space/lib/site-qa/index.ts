/**
 * Milestone 7 — Mobile QA orchestrator.
 *
 * Ties together: load SiteBuild -> re-render the static package in memory from
 * the approved sitemap-first blueprint -> run the mobile QA gate -> (if the
 * gate passes) run the deterministic mobile analyzer -> persist a durable
 * WebsiteMobileQa record. Optionally writes a `website_mobile_qa.json` copy
 * into the package directory when it still exists on disk (best-effort; the
 * durable copy always lives in the DB `qaJson` column).
 *
 * HARD RULES: never deploys, publishes, generates images/copy, or advances the
 * SiteBuild status. Never persists secrets or signed URLs.
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { renderStaticSite } from '@/lib/site-renderer';
import type { RenderedFile } from '@/lib/site-renderer';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { resolveSitemapBuildInputs } from '@/lib/site-builder/sitemap-build-inputs';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import {
  evaluateMobileQaGate,
  type MobileQaGateResult,
  type MobileQaBuildLike,
} from '@/lib/site-qa/mobile-qa-gate';
import { analyzeMobileQa, type MobileQaReport } from '@/lib/site-qa/mobile-qa';

export interface RunMobileQaOptions {
  businessId: string;
  siteBuildId: string;
  websiteProjectId?: string | null;
  createdByUserId?: string | null;
  /** Must be false/undefined — a live deploy is never allowed here. */
  deployRequested?: boolean;
  /** When true, write website_mobile_qa.json into the package dir if present. */
  writeArtifactFile?: boolean;
}

export interface RunMobileQaResult {
  ok: boolean;
  blocked: boolean;
  qaId?: string;
  status: string;
  gate: MobileQaGateResult;
  report?: MobileQaReport;
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

export async function runMobileQa(opts: RunMobileQaOptions): Promise<RunMobileQaResult> {
  const build = await prisma.siteBuild.findUnique({
    where: { id: opts.siteBuildId },
    select: {
      id: true,
      businessId: true,
      websiteProjectId: true,
      buildStatus: true,
      sourceRef: true,
      artifactManifestJson: true,
    },
  });

  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { id: true },
  });

  const buildLike: MobileQaBuildLike | null = build
    ? {
        id: build.id,
        businessId: build.businessId,
        buildStatus: build.buildStatus,
        sourceRef: build.sourceRef,
        artifactManifestJson: (build.artifactManifestJson as unknown as ArtifactManifest) || null,
      }
    : null;

  // Re-render only when the build belongs to this business (avoid cross-tenant work).
  const files =
    build && build.businessId === opts.businessId
      ? await rerenderPackage(opts.businessId, build.websiteProjectId)
      : [];

  const gate = evaluateMobileQaGate({
    businessId: opts.businessId,
    businessExists: Boolean(business),
    build: buildLike,
    files,
    deployRequested: opts.deployRequested === true,
  });

  const websiteProjectId = opts.websiteProjectId || build?.websiteProjectId || null;

  // ── Gate blocked → persist an auditable blocked row (never a passing artifact).
  if (!gate.ok) {
    const blockedJson = {
      status: 'blocked' as const,
      businessId: opts.businessId,
      siteBuildId: opts.siteBuildId,
      checkedAt: new Date().toISOString(),
      blocking: gate.blocking,
      warnings: gate.warnings,
      refs: gate.refs,
    };
    let qaId: string | undefined;
    // Only persist when we have a valid FK target (build + business exist).
    if (build && business && build.businessId === opts.businessId) {
      const row = await prisma.websiteMobileQa.create({
        data: {
          businessId: opts.businessId,
          websiteProjectId,
          siteBuildId: opts.siteBuildId,
          status: 'blocked',
          passed: false,
          score: null,
          checkedRoutesCount: 0,
          failedRoutesCount: 0,
          warningCount: gate.warnings.length,
          qaJson: blockedJson as any,
          createdByUserId: opts.createdByUserId || null,
        },
        select: { id: true },
      });
      qaId = row.id;
    }
    return { ok: false, blocked: true, qaId, status: 'blocked', gate };
  }

  // ── Gate passed → run the deterministic analyzer.
  const manifest = buildLike!.artifactManifestJson;
  const report = analyzeMobileQa({
    businessId: opts.businessId,
    siteBuildId: opts.siteBuildId,
    files,
    manifest,
    routes: (manifest?.routes as string[]) || undefined,
  });

  const row = await prisma.websiteMobileQa.create({
    data: {
      businessId: opts.businessId,
      websiteProjectId,
      siteBuildId: opts.siteBuildId,
      status: report.status,
      passed: report.passed,
      score: report.score,
      checkedRoutesCount: report.summary.checkedRoutesCount,
      failedRoutesCount: report.summary.failedRoutesCount,
      warningCount: report.summary.warningCount,
      qaJson: report as any,
      createdByUserId: opts.createdByUserId || null,
    },
    select: { id: true },
  });

  // Best-effort: drop a copy into the package dir if it still exists on disk.
  if (opts.writeArtifactFile && build?.sourceRef) {
    try {
      if (fs.existsSync(build.sourceRef) && fs.statSync(build.sourceRef).isDirectory()) {
        fs.writeFileSync(
          path.join(build.sourceRef, 'website_mobile_qa.json'),
          JSON.stringify(report, null, 2),
          'utf8',
        );
      }
    } catch {
      // Non-fatal — durable copy is the DB row.
    }
  }

  return {
    ok: true,
    blocked: false,
    qaId: row.id,
    status: report.status,
    gate,
    report,
  };
}
