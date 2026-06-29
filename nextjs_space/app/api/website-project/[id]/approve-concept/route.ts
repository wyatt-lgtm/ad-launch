export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  resolveBusinessAccess,
  CONCEPT_STATUS,
  PRODUCTION_STATUS,
} from '@/lib/website-workflow';

/**
 * POST /api/website-project/[id]/approve-concept
 * Body: { conceptId }
 * Approves a concept version. Records who approved it and when, marks the
 * concept as the project's approved version, and unblocks production.
 * Does NOT touch any production records.
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
    const { conceptId } = await request.json().catch(() => ({}));

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

    // Pick the concept to approve: explicit conceptId or latest reviewable one.
    const concept = conceptId
      ? await prisma.websiteConcept.findFirst({
          where: { id: conceptId, websiteProjectId: project.id },
        })
      : await prisma.websiteConcept.findFirst({
          where: {
            websiteProjectId: project.id,
            status: {
              in: [
                CONCEPT_STATUS.READY_FOR_REVIEW,
                CONCEPT_STATUS.REVISION_REQUESTED,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
        });
    if (!concept) {
      return NextResponse.json(
        { error: 'No reviewable concept found to approve' },
        { status: 400 },
      );
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.websiteConcept.update({
        where: { id: concept.id },
        data: {
          status: CONCEPT_STATUS.APPROVED,
          approvedByUserId: access.user.id,
          approvedAt: now,
        },
      }),
      prisma.websiteProject.update({
        where: { id: project.id },
        data: {
          conceptStatus: CONCEPT_STATUS.APPROVED,
          approvedConceptVersionId: concept.id,
          // Production is now unblocked but not yet started.
          productionStatus:
            project.productionStatus === PRODUCTION_STATUS.NOT_STARTED ||
            project.productionStatus ===
              PRODUCTION_STATUS.WAITING_FOR_CONCEPT_APPROVAL
              ? PRODUCTION_STATUS.NOT_STARTED
              : project.productionStatus,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, approvedConceptId: concept.id });
  } catch (err: any) {
    console.error('[approve-concept] error:', err?.message);
    return NextResponse.json({ error: 'Failed to approve concept' }, { status: 500 });
  }
}
