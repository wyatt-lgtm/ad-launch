export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { buildStaticSiteFromSitemap } from '@/lib/site-builder/sitemap-site-builder';
import { DEFAULT_DEPLOYMENT_TARGET } from '@/lib/site-deploy/targets';

/**
 * Milestone 6 — generate a sitemap-first static preview build.
 *
 * POST /api/businesses/{id}/website/static-builds/generate
 *   Runs the static build gate + build in ARTIFACT MODE. Never deploys or
 *   publishes; furthest status is `ready_for_preview`. Any deploy/publish
 *   request is rejected.
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

export async function POST(
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

    const body = await request.json().catch(() => ({} as any));
    // Reject any attempt to deploy/publish through this endpoint.
    const deployRequested =
      body?.deploy === true ||
      body?.publish === true ||
      body?.deployRequested === true;
    if (deployRequested) {
      return NextResponse.json(
        { error: 'Deployment disabled — dry run only. This endpoint only builds a static preview.' },
        { status: 400 },
      );
    }

    const project = await ensureWebsiteProject(businessId);
    const target = await getOrCreateDefaultTarget(businessId, project.id);

    const result = await buildStaticSiteFromSitemap({
      businessId,
      websiteProjectId: project.id,
      deploymentTargetId: target.id,
      createdByUserId: access.user.id,
    });

    if (!result.ok && !result.siteBuildId) {
      // Gate blocked before any build attempt started.
      return NextResponse.json(
        { ok: false, blocked: true, gate: result.gate },
        { status: 422 },
      );
    }

    const status = result.buildStatus === 'build_failed' ? 422 : 200;
    return NextResponse.json(
      {
        ok: result.ok,
        siteBuildId: result.siteBuildId,
        buildStatus: result.buildStatus,
        buildNumber: result.buildNumber,
        sourceRef: result.sourceRef,
        outputRef: result.outputRef,
        artifactManifest: result.artifactManifest || null,
        postBuildIssues: result.postBuildIssues || [],
        gate: result.gate,
        errorMessage: result.errorMessage,
      },
      { status },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to generate static build' },
      { status: 500 },
    );
  }
}
