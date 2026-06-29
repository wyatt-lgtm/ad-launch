export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  resolveBusinessAccess,
  ensureWebsiteProject,
} from '@/lib/website-workflow';

/**
 * GET /api/website-project?businessId=...
 * Ensures a WebsiteProject exists for the business and returns the full
 * two-stage state: concept status, production status, latest concept, latest
 * production, production pages count and recent QA results.
 */
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

    const [concepts, productions, pagesCount, qaResults] = await Promise.all([
      prisma.websiteConcept.findMany({
        where: { websiteProjectId: project.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, version: true, conceptSummary: true,
          workflowId: true, finalTaskId: true, approvedByUserId: true,
          approvedAt: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.websiteProduction.findMany({
        where: { websiteProjectId: project.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, version: true, qaStatus: true,
          sourceConceptId: true, approvedByUserId: true, approvedAt: true,
          publishedAt: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.websitePage.count({ where: { websiteProjectId: project.id } }),
      prisma.websiteQaResult.findMany({
        where: { websiteProjectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    // Latest analysis for this business — used to route the user to the concept
    // generator (which lives in the analysis results flow).
    const latestAnalysis = await prisma.analysis.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return NextResponse.json({
      project,
      concepts,
      productions,
      pagesCount,
      qaResults,
      latestAnalysisId: latestAnalysis?.id ?? null,
      isAdmin: access.isAdmin,
    });
  } catch (err: any) {
    console.error('[website-project] GET error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/website-project
 * Body: { businessId, projectName? }
 * Ensures a WebsiteProject exists (idempotent). Optionally sets a project name.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { businessId, projectName } = await request.json();
    if (!businessId) {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const project = await ensureWebsiteProject(businessId);
    if (projectName && projectName !== project.projectName) {
      const updated = await prisma.websiteProject.update({
        where: { id: project.id },
        data: { projectName },
      });
      return NextResponse.json({ project: updated });
    }
    return NextResponse.json({ project });
  } catch (err: any) {
    console.error('[website-project] POST error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
