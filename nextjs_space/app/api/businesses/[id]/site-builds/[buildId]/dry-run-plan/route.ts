export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { computeDryRunPlan, type DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import type { ArtifactManifest } from '@/lib/site-builder/artifact-manifest';

/**
 * Phase 4 — dry-run deploy plan for a specific build (business-scoped).
 *
 * GET /api/businesses/[id]/site-builds/[buildId]/dry-run-plan
 *
 * Computes a SIDE-EFFECT-FREE plan from the build's artifact manifest + its
 * deployment target. Never opens an SSH/SFTP connection. Never uploads. Never
 * returns a secret value.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; buildId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Scope the build to the business so no cross-business leakage is possible.
    const build = await prisma.siteBuild.findFirst({
      where: { id: params.buildId, businessId },
      select: {
        id: true,
        buildNumber: true,
        buildStatus: true,
        websiteProjectId: true,
        deploymentTargetId: true,
        artifactManifestJson: true,
      },
    });
    if (!build) return NextResponse.json({ error: 'Build not found' }, { status: 404 });

    // Resolve the target: the build's target if set, else the default target.
    const target = build.deploymentTargetId
      ? await prisma.siteDeploymentTarget.findFirst({
          where: { id: build.deploymentTargetId, businessId },
          select: {
            targetType: true, domain: true, siteUrl: true,
            deployBasePath: true, credentialsRef: true,
          },
        })
      : await prisma.siteDeploymentTarget.findFirst({
          where: { businessId, websiteProjectId: build.websiteProjectId },
          orderBy: { createdAt: 'asc' },
          select: {
            targetType: true, domain: true, siteUrl: true,
            deployBasePath: true, credentialsRef: true,
          },
        });

    // A previous ready build (for delete-diff).
    const previousReady = await prisma.siteBuild.findFirst({
      where: {
        businessId,
        websiteProjectId: build.websiteProjectId,
        buildStatus: 'ready_for_preview',
        buildNumber: { lt: build.buildNumber },
      },
      orderBy: { buildNumber: 'desc' },
      select: { artifactManifestJson: true },
    });

    const targetConfig: DeployTargetConfig = {
      targetType: target?.targetType || 'hostgator_static',
      domain: target?.domain ?? null,
      siteUrl: target?.siteUrl ?? null,
      deployBasePath: target?.deployBasePath ?? null,
      credentialsRef: target?.credentialsRef ?? null,
    };

    const plan = computeDryRunPlan({
      target: targetConfig,
      manifest: (build.artifactManifestJson as unknown as ArtifactManifest) || null,
      previousManifest:
        (previousReady?.artifactManifestJson as unknown as ArtifactManifest) || null,
    });

    const missingConfig: string[] = [];
    if (!targetConfig.domain) missingConfig.push('domain');
    if (!targetConfig.deployBasePath) missingConfig.push('deployBasePath');
    if (!targetConfig.credentialsRef) missingConfig.push('credentialsRef');

    return NextResponse.json({
      buildId: build.id,
      buildNumber: build.buildNumber,
      buildStatus: build.buildStatus,
      liveDeployEnabled: false,
      credentialReferencePresent: Boolean(targetConfig.credentialsRef),
      missingConfig,
      plan,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compute dry-run plan' },
      { status: 500 },
    );
  }
}
