export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';

/**
 * Milestone 8 — preview-approval list + context.
 *
 * GET /api/businesses/{id}/website/preview-approvals
 *   → the latest ready-for-preview build (approval target), the list of
 *     persisted WebsitePreviewApproval records, and the latest one. Readiness
 *     only — NEVER deploys, publishes, or launches.
 */
export async function GET(
  _request: NextRequest,
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

    const builds = await prisma.siteBuild.findMany({
      where: { businessId, websiteProjectId: project.id, websiteProductionId: null },
      orderBy: { buildNumber: 'desc' },
      take: 20,
      select: {
        id: true,
        buildStatus: true,
        buildNumber: true,
        sourceRef: true,
        completedAt: true,
        createdAt: true,
      },
    });
    const approvalTargetBuild = builds.find((b) => b.buildStatus === 'ready_for_preview') || null;

    const approvals = await prisma.websitePreviewApproval.findMany({
      where: { businessId, siteBuild: { websiteProjectId: project.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        siteBuildId: true,
        mobileQaId: true,
        deploymentTargetId: true,
        status: true,
        approvalNotes: true,
        rejectionReason: true,
        approvedByUserId: true,
        rejectedByUserId: true,
        approvedAt: true,
        rejectedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      previewApprovalOnly: true,
      deploymentDisabledNotice: 'Deployment disabled — dry run only',
      launchNotice: 'This does not publish or deploy the website',
      futureDeployNotice: 'Future deployment requires a separate approval step',
      approvalTargetBuild,
      builds,
      latestApproval: approvals[0] || null,
      approvals,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load preview approvals' },
      { status: 500 },
    );
  }
}
