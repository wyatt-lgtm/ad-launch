export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  resolveBusinessAccess,
  canStartProduction,
  CONCEPT_STATUS,
  PRODUCTION_STATUS,
  WEBSITE_STAGE,
} from '@/lib/website-workflow';
import { generateProductionFromConcept } from '@/lib/website-production';

/**
 * POST /api/website-project/[id]/start-production
 * Body: { adminOverride?: boolean }
 *
 * HARD GATE: production generation can only start when the concept is approved,
 * unless an admin supplies adminOverride=true. Returns 403 otherwise.
 *
 * Production records are created entirely separate from the concept; the
 * approved concept is consumed as creative direction only and is never
 * overwritten. No publishing / tracking / GHL forms are touched.
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
    const { adminOverride } = await request.json().catch(() => ({}));

    const project = await prisma.websiteProject.findUnique({
      where: { id: params.id },
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const access = await resolveBusinessAccess(
      session.user.email,
      project.businessId,
    );
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only admins may use the override.
    const useOverride = !!adminOverride && access.isAdmin;

    // HARD GATE.
    if (!canStartProduction(project.conceptStatus, { adminOverride: useOverride })) {
      return NextResponse.json(
        {
          error:
            'Production build is blocked until the concept is approved. Approve the concept first, or use an admin override.',
          conceptStatus: project.conceptStatus,
          gated: true,
        },
        { status: 403 },
      );
    }

    // Resolve the approved concept to derive creative direction from.
    const concept =
      (project.approvedConceptVersionId &&
        (await prisma.websiteConcept.findUnique({
          where: { id: project.approvedConceptVersionId },
        }))) ||
      (await prisma.websiteConcept.findFirst({
        where: {
          websiteProjectId: project.id,
          status: CONCEPT_STATUS.APPROVED,
        },
        orderBy: { approvedAt: 'desc' },
      })) ||
      // Admin override path may run without an approved concept — use latest.
      (useOverride
        ? await prisma.websiteConcept.findFirst({
            where: { websiteProjectId: project.id },
            orderBy: { createdAt: 'desc' },
          })
        : null);

    if (!concept) {
      return NextResponse.json(
        { error: 'No concept available to use as creative direction.' },
        { status: 400 },
      );
    }

    // Mark the project as entering production planning.
    await prisma.websiteProject.update({
      where: { id: project.id },
      data: {
        currentStage: WEBSITE_STAGE.PRODUCTION,
        productionStatus: PRODUCTION_STATUS.PLANNING,
      },
    });

    // Generate the production build (records only — no publish/tracking/GHL).
    const { productionId, pageCount } = await generateProductionFromConcept({
      businessId: project.businessId,
      websiteProjectId: project.id,
      conceptId: concept.id,
    });

    // Production finished generating — ready for review.
    await prisma.websiteProject.update({
      where: { id: project.id },
      data: {
        productionStatus: PRODUCTION_STATUS.READY_FOR_REVIEW,
        currentProductionVersionId: productionId,
      },
    });

    return NextResponse.json({
      ok: true,
      productionId,
      pageCount,
      usedAdminOverride: useOverride,
    });
  } catch (err: any) {
    console.error('[start-production] error:', err?.message);
    // Best-effort: reset production status so the user can retry.
    try {
      await prisma.websiteProject.update({
        where: { id: params.id },
        data: { productionStatus: PRODUCTION_STATUS.NOT_STARTED },
      });
    } catch {}
    return NextResponse.json(
      { error: 'Failed to start production build' },
      { status: 500 },
    );
  }
}
