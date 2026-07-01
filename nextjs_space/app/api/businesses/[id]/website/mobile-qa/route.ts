export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';

/**
 * Milestone 7 — mobile QA list + context.
 *
 * GET /api/businesses/{id}/website/mobile-qa
 *   → the latest ready-for-preview build (QA target), the list of persisted
 *     WebsiteMobileQa records, and the latest QA result. Never deploys.
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
    const latestReadyBuild = builds.find((b) => b.buildStatus === 'ready_for_preview') || null;

    const qaResults = await prisma.websiteMobileQa.findMany({
      where: { businessId, siteBuild: { websiteProjectId: project.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        siteBuildId: true,
        status: true,
        score: true,
        passed: true,
        checkedRoutesCount: true,
        failedRoutesCount: true,
        warningCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      deploymentDisabledNotice: 'Deployment disabled — dry run only',
      qaTargetBuild: latestReadyBuild,
      builds,
      latestQa: qaResults[0] || null,
      qaResults,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load mobile QA' },
      { status: 500 },
    );
  }
}
