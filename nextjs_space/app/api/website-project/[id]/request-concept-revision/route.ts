export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  resolveBusinessAccess,
  CONCEPT_STATUS,
} from '@/lib/website-workflow';

/**
 * POST /api/website-project/[id]/request-concept-revision
 * Body: { conceptId?, feedback?, target?, sectionId? }
 *
 * Marks a concept as revision_requested and records the feedback in the
 * existing SiteFeedback table (reused for the Revisions tab). A concept in
 * revision_requested state can NOT start production.
 * Does NOT touch production records.
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
    const body = await request.json().catch(() => ({}));
    const { conceptId, feedback, target, sectionId } = body;

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

    const concept = conceptId
      ? await prisma.websiteConcept.findFirst({
          where: { id: conceptId, websiteProjectId: project.id },
        })
      : await prisma.websiteConcept.findFirst({
          where: { websiteProjectId: project.id },
          orderBy: { createdAt: 'desc' },
        });
    if (!concept) {
      return NextResponse.json({ error: 'No concept found' }, { status: 400 });
    }

    await prisma.websiteConcept.update({
      where: { id: concept.id },
      data: {
        status: CONCEPT_STATUS.REVISION_REQUESTED,
        // A revision clears any prior approval on this concept version.
        approvedByUserId: null,
        approvedAt: null,
      },
    });

    // Record the feedback for the Revisions tab (reuse existing SiteFeedback).
    if (feedback && String(feedback).trim()) {
      await prisma.siteFeedback.create({
        data: {
          businessId: project.businessId,
          workflowId: concept.workflowId,
          pageId: 'home',
          sectionId: sectionId || null,
          target: target || 'whole_site',
          feedback: String(feedback).trim(),
          status: 'pending',
          userId: access.user.id,
        },
      });
    }

    // If the project's approved concept was this one, clear the approval pointer.
    const data: any = { conceptStatus: CONCEPT_STATUS.REVISION_REQUESTED };
    if (project.approvedConceptVersionId === concept.id) {
      data.approvedConceptVersionId = null;
    }
    await prisma.websiteProject.update({
      where: { id: project.id },
      data,
    });

    return NextResponse.json({ ok: true, conceptId: concept.id });
  } catch (err: any) {
    console.error('[request-concept-revision] error:', err?.message);
    return NextResponse.json(
      { error: 'Failed to request revision' },
      { status: 500 },
    );
  }
}
