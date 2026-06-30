export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { buildStaticSite } from '@/lib/site-builder';
import { DEFAULT_DEPLOYMENT_TARGET } from '@/lib/site-deploy/targets';
import { computeDryRunPlan, type DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import { getAssetStoreReadiness } from '@/lib/site-deploy/asset-store-config';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

/**
 * Phase 3 — static site build inspection API.
 *
 * GET  /api/site-build?businessId=...  → deployment target (safe fields),
 *      list of SiteBuild records, the latest build, and a computed dry-run
 *      deploy plan (never executes anything).
 * POST /api/site-build  { businessId, websiteProductionId, deploymentTargetId? }
 *      → runs a build in ARTIFACT MODE and persists a SiteBuild record. Never
 *      deploys or publishes; the furthest status is `ready_for_preview`.
 */

function safeTarget(t: {
  id: string;
  targetType: string;
  status: string;
  domain: string | null;
  siteUrl: string | null;
  deployBasePath: string | null;
  credentialsRef: string | null;
} | null) {
  if (!t) return null;
  // credentialsRef is surfaced as a boolean presence flag ONLY — never a value.
  return {
    id: t.id,
    targetType: t.targetType,
    status: t.status,
    domain: t.domain,
    siteUrl: t.siteUrl,
    deployBasePath: t.deployBasePath,
    hasCredentialsRef: Boolean(t.credentialsRef),
  };
}

async function getOrCreateDefaultTarget(businessId: string, websiteProjectId: string) {
  const existing = await prisma.siteDeploymentTarget.findFirst({
    where: { businessId, websiteProjectId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  // Create a default, NON-LIVE target so inspection has a config to validate.
  // status stays `draft` — this never enables deployment.
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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = new URL(request.url).searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const project = await ensureWebsiteProject(businessId);
    const target = await getOrCreateDefaultTarget(businessId, project.id);

    const builds = await prisma.siteBuild.findMany({
      where: { businessId, websiteProjectId: project.id },
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
        deploymentTargetId: true,
      },
    });

    const latest = builds[0] || null;
    const latestReady =
      builds.find((b) => b.buildStatus === 'ready_for_preview') || null;
    const previousReady =
      builds.filter((b) => b.buildStatus === 'ready_for_preview')[1] || null;

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
      previousManifest:
        (previousReady?.artifactManifestJson as unknown as ArtifactManifest) || null,
    });

    // Strip raw manifest from the list payload (kept on `latest` only) to keep
    // the response lean; the manifest contains only safe fields regardless.
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
      deployTarget: safeTarget(target),
      liveDeployEnabled: false,
      // R2 source bucket config (names + presence only — never credentials).
      assetStores: getAssetStoreReadiness(),
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
      { error: err?.message || 'Failed to load builds' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const businessId: string | undefined = body.businessId;
    const websiteProductionId: string | undefined = body.websiteProductionId;
    if (!businessId || !websiteProductionId) {
      return NextResponse.json(
        { error: 'businessId and websiteProductionId are required' },
        { status: 400 },
      );
    }
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const project = await ensureWebsiteProject(businessId);
    const target = await getOrCreateDefaultTarget(businessId, project.id);

    const result = await buildStaticSite({
      businessId,
      websiteProductionId,
      websiteProjectId: project.id,
      deploymentTargetId: body.deploymentTargetId || target.id,
      createdByUserId: access.user.id,
    });

    const status = result.buildStatus === 'build_failed' ? 422 : 200;
    return NextResponse.json(
      {
        siteBuildId: result.siteBuildId,
        buildStatus: result.buildStatus,
        buildNumber: result.buildNumber,
        sourceRef: result.sourceRef,
        outputRef: result.outputRef,
        errorMessage: result.errorMessage || null,
        artifactManifest: result.artifactManifest || null,
        liveDeployEnabled: false,
      },
      { status },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Build failed to start' },
      { status: 500 },
    );
  }
}
