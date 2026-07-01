export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { DEFAULT_DEPLOYMENT_TARGET, LIVE_DEPLOY_ENABLED } from '@/lib/site-deploy/targets';
import { computeDryRunPlan, type DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

/**
 * Milestone 6 — dry-run deployment plan preview for a static build.
 * GET /api/businesses/{id}/website/static-builds/{buildId}/dry-run-plan
 *
 * Computes what a deploy WOULD do. Never uploads, never contacts any host.
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
  { params }: { params: { id: string; buildId: string } },
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

    const build = await prisma.siteBuild.findUnique({
      where: { id: params.buildId },
      select: { businessId: true, artifactManifestJson: true, buildStatus: true },
    });
    if (!build || build.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const project = await ensureWebsiteProject(businessId);
    const target = await getOrCreateDefaultTarget(businessId, project.id);
    const targetConfig: DeployTargetConfig = {
      targetType: target.targetType,
      domain: target.domain,
      siteUrl: target.siteUrl,
      deployBasePath: target.deployBasePath,
      credentialsRef: target.credentialsRef,
    };

    const dryRunPlan = computeDryRunPlan({
      target: targetConfig,
      manifest: (build.artifactManifestJson as unknown as ArtifactManifest) || null,
    });

    return NextResponse.json({
      liveDeployEnabled: LIVE_DEPLOY_ENABLED,
      deploymentDisabledNotice: 'Deployment disabled — dry run only',
      dryRunPlan,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compute dry-run plan' },
      { status: 500 },
    );
  }
}
