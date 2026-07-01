export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { evaluateStaticBuildGate } from '@/lib/site-builder/static-build-gate';
import { DEFAULT_DEPLOYMENT_TARGET, LIVE_DEPLOY_ENABLED } from '@/lib/site-deploy/targets';
import { computeDryRunPlan, type DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import { getAssetStoreReadiness } from '@/lib/site-deploy/asset-store-config';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

/**
 * Milestone 6 — sitemap-first static build inspection API (list + gate).
 *
 * GET /api/businesses/{id}/website/static-builds
 *   → gate state, sitemap/copy/brief refs, image counts, SiteBuild list,
 *     latest build, dry-run plan for the latest ready build. Never deploys.
 */

async function getOrCreateDefaultTarget(businessId: string, websiteProjectId: string) {
  const existing = await prisma.siteDeploymentTarget.findFirst({
    where: { businessId, websiteProjectId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  return prisma.siteDeploymentTarget.create({
    data: {
      businessId,
      websiteProjectId,
      targetType: DEFAULT_DEPLOYMENT_TARGET,
      status: 'draft',
      name: 'Default static target (dry-run only)',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const project = await ensureWebsiteProject(businessId);
    const target = await getOrCreateDefaultTarget(businessId, project.id);
    const gate = await evaluateStaticBuildGate(businessId, project.id);

    const builds = await prisma.siteBuild.findMany({
      where: { businessId, websiteProjectId: project.id, websiteProductionId: null },
      orderBy: { buildNumber: 'desc' },
      take: 20,
      select: {
        id: true,
        buildStatus: true,
        buildNumber: true,
        sourceRef: true,
        outputRef: true,
        previewUrl: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        artifactManifestJson: true,
      },
    });

    const latest = builds[0] || null;
    const latestReady = builds.find((b) => b.buildStatus === 'ready_for_preview') || null;
    const previousReady = builds.filter((b) => b.buildStatus === 'ready_for_preview')[1] || null;

    const targetConfig: DeployTargetConfig = {
      targetType: target.targetType,
      domain: target.domain,
      siteUrl: target.siteUrl,
      deployBasePath: target.deployBasePath,
      credentialsRef: target.credentialsRef,
    };
    const dryRunPlan = computeDryRunPlan({
      target: targetConfig,
      manifest: (latestReady?.artifactManifestJson as unknown as ArtifactManifest) || null,
      previousManifest: (previousReady?.artifactManifestJson as unknown as ArtifactManifest) || null,
    });

    const buildList = builds.map((b) => ({
      id: b.id,
      buildStatus: b.buildStatus,
      buildNumber: b.buildNumber,
      sourceRef: b.sourceRef,
      outputRef: b.outputRef,
      previewUrl: b.previewUrl,
      errorMessage: b.errorMessage,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      createdAt: b.createdAt,
    }));

    return NextResponse.json({
      liveDeployEnabled: LIVE_DEPLOY_ENABLED,
      deploymentDisabledNotice: 'Deployment disabled — dry run only',
      gate,
      assetStores: getAssetStoreReadiness(),
      deployTarget: {
        id: target.id,
        targetType: target.targetType,
        status: target.status,
        hasCredentialsRef: Boolean(target.credentialsRef),
      },
      builds: buildList,
      latest: latest
        ? {
            ...buildList.find((b) => b.id === latest.id),
            artifactManifest: latest.artifactManifestJson || null,
          }
        : null,
      dryRunPlan,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load static builds' },
      { status: 500 },
    );
  }
}
