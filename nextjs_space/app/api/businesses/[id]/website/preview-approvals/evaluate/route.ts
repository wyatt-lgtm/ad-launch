export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { evaluatePreviewReadiness } from '@/lib/site-preview-approval';

/**
 * Milestone 8 — evaluate preview readiness for a static build.
 *
 * POST /api/businesses/{id}/website/preview-approvals/evaluate  { siteBuildId? }
 *   Runs the readiness gate and upserts a WebsitePreviewApproval record. NEVER
 *   deploys, publishes, launches, uploads, generates images/copy, rebuilds the
 *   static site, or advances the SiteBuild status. Any deploy/publish request is
 *   rejected outright.
 */
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
    // Reject any attempt to deploy/publish/launch through this endpoint.
    if (
      body?.deploy === true ||
      body?.publish === true ||
      body?.launch === true ||
      body?.deployRequested === true
    ) {
      return NextResponse.json(
        {
          error:
            'Deployment disabled — dry run only. Preview approval never deploys, publishes, or launches. Future deployment requires a separate approval step.',
        },
        { status: 400 },
      );
    }

    const project = await ensureWebsiteProject(businessId);

    let siteBuildId: string | null = typeof body?.siteBuildId === 'string' ? body.siteBuildId : null;
    if (!siteBuildId) {
      const latestReady = await prisma.siteBuild.findFirst({
        where: {
          businessId,
          websiteProjectId: project.id,
          websiteProductionId: null,
          buildStatus: 'ready_for_preview',
        },
        orderBy: { buildNumber: 'desc' },
        select: { id: true },
      });
      siteBuildId = latestReady?.id || null;
    }

    if (!siteBuildId) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: 'No ready-for-preview static build found to review. Generate a static build first.',
        },
        { status: 422 },
      );
    }

    // Business scoping: never evaluate a build owned by another business.
    const build = await prisma.siteBuild.findUnique({
      where: { id: siteBuildId },
      select: { id: true, businessId: true },
    });
    if (!build || build.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await evaluatePreviewReadiness({
      businessId,
      siteBuildId,
      websiteProjectId: project.id,
      createdByUserId: access.user.id,
      writeArtifactFile: true,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        blocked: result.blocked,
        approvalId: result.approvalId,
        status: result.status,
        previewStatus: result.result.previewStatus,
        targetStatus: result.result.targetStatus,
        recommendedStatus: result.result.recommendedStatus,
        checks: result.result.checks,
        blockingReasons: result.result.blockingReasons,
        warnings: result.result.warnings,
        report: result.report,
      },
      { status: result.blocked ? 200 : 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to evaluate preview readiness' },
      { status: 500 },
    );
  }
}
