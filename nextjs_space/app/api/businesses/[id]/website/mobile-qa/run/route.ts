export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { runMobileQa } from '@/lib/site-qa';

/**
 * Milestone 7 — run mobile QA against a static preview build.
 *
 * POST /api/businesses/{id}/website/mobile-qa/run  { siteBuildId? }
 *   Runs the mobile QA gate + deterministic analyzer. Never deploys, publishes,
 *   generates images/copy, or advances the SiteBuild status. Any deploy/publish
 *   request is rejected.
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
    // Reject any attempt to deploy/publish through this endpoint.
    if (body?.deploy === true || body?.publish === true || body?.deployRequested === true) {
      return NextResponse.json(
        { error: 'Deployment disabled — dry run only. Mobile QA never deploys or publishes.' },
        { status: 400 },
      );
    }

    const project = await ensureWebsiteProject(businessId);

    // Resolve the build to QA: explicit id, else the latest ready_for_preview.
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
          error: 'No ready-for-preview static build found to QA. Generate a static build first.',
        },
        { status: 422 },
      );
    }

    const result = await runMobileQa({
      businessId,
      siteBuildId,
      websiteProjectId: project.id,
      createdByUserId: access.user.id,
      writeArtifactFile: true,
    });

    if (result.blocked) {
      return NextResponse.json(
        { ok: false, blocked: true, qaId: result.qaId, status: result.status, gate: result.gate },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      qaId: result.qaId,
      status: result.status,
      gate: result.gate,
      report: result.report,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to run mobile QA' },
      { status: 500 },
    );
  }
}
