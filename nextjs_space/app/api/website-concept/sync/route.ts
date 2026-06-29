export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getConceptWebsiteStatus } from '@/lib/tombstone';
import {
  resolveBusinessAccess,
  ensureWebsiteProject,
  CONCEPT_STATUS,
  PRODUCTION_STATUS,
  WEBSITE_STAGE,
} from '@/lib/website-workflow';

/**
 * POST /api/website-concept/sync
 * Body: { businessId, workflowId, finalTaskId?, analysisId? }
 *
 * Persists the concept produced by the existing Tombstone concept workflow
 * into a durable WebsiteConcept record (status `ready_for_review` once the
 * HTML is available). Idempotent per (project, workflowId): an existing
 * concept for the same workflow is updated rather than duplicated.
 *
 * This NEVER touches production records — concept and production are separate.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { businessId, workflowId, finalTaskId } = await request.json();
    if (!businessId || !workflowId) {
      return NextResponse.json(
        { error: 'businessId and workflowId required' },
        { status: 400 },
      );
    }
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const project = await ensureWebsiteProject(businessId);

    // Pull the latest status + extracted HTML from Tombstone.
    let statusResult: any = {};
    try {
      statusResult = await getConceptWebsiteStatus(
        workflowId,
        finalTaskId ? parseInt(String(finalTaskId), 10) : undefined,
      );
    } catch (e: any) {
      console.warn('[website-concept/sync] status fetch failed:', e?.message);
    }

    const html: string | null = statusResult?.html ?? null;
    const ci = statusResult?.competitorIntelligence ?? null;
    const isComplete = !!html;

    // Find an existing concept for this workflow (avoid duplicates).
    let concept = await prisma.websiteConcept.findFirst({
      where: { websiteProjectId: project.id, workflowId: String(workflowId) },
      orderBy: { createdAt: 'desc' },
    });

    const designDirectionJson = ci?.finalSitePlan ?? null;
    const brandDirectionJson = ci?.competitiveSynthesis
      ? { synthesis: ci.competitiveSynthesis }
      : null;
    const imageDirectionJson = null;
    const ctaDirectionJson = null;

    const nextStatus = isComplete
      ? CONCEPT_STATUS.READY_FOR_REVIEW
      : CONCEPT_STATUS.GENERATING;

    if (concept) {
      // Do not regress an already-approved concept back to ready_for_review.
      const keepApproved = concept.status === CONCEPT_STATUS.APPROVED;
      concept = await prisma.websiteConcept.update({
        where: { id: concept.id },
        data: {
          finalTaskId: finalTaskId ? String(finalTaskId) : concept.finalTaskId,
          conceptHtml: html ?? concept.conceptHtml,
          designDirectionJson: designDirectionJson ?? concept.designDirectionJson as any,
          brandDirectionJson: brandDirectionJson ?? concept.brandDirectionJson as any,
          status: keepApproved ? concept.status : nextStatus,
        },
      });
    } else {
      // Determine next version number for this project.
      const count = await prisma.websiteConcept.count({
        where: { websiteProjectId: project.id },
      });
      concept = await prisma.websiteConcept.create({
        data: {
          businessId,
          websiteProjectId: project.id,
          workflowId: String(workflowId),
          finalTaskId: finalTaskId ? String(finalTaskId) : null,
          conceptHtml: html,
          designDirectionJson: designDirectionJson ?? undefined,
          brandDirectionJson: brandDirectionJson ?? undefined,
          imageDirectionJson: imageDirectionJson ?? undefined,
          ctaDirectionJson: ctaDirectionJson ?? undefined,
          status: nextStatus,
          version: count + 1,
        },
      });
    }

    // Record the concept War Room QA result if available.
    if (ci?.warRoomEvaluation) {
      const existingQa = await prisma.websiteQaResult.findFirst({
        where: {
          conceptId: concept.id,
          qaType: 'concept_war_room',
        },
      });
      if (!existingQa) {
        await prisma.websiteQaResult.create({
          data: {
            businessId,
            websiteProjectId: project.id,
            conceptId: concept.id,
            qaType: 'concept_war_room',
            qaAgent: 'Peter Drucker / War Room',
            verdict: ci.winningConceptId ? 'APPROVED' : 'PENDING',
            gatesJson: ci.warRoomEvaluation ?? undefined,
          },
        });
      }
    }

    // Update project concept status (do not override an approval).
    if (project.conceptStatus !== CONCEPT_STATUS.APPROVED) {
      const productionStatus =
        project.productionStatus === PRODUCTION_STATUS.NOT_STARTED && isComplete
          ? PRODUCTION_STATUS.WAITING_FOR_CONCEPT_APPROVAL
          : project.productionStatus;
      await prisma.websiteProject.update({
        where: { id: project.id },
        data: {
          currentStage: WEBSITE_STAGE.CONCEPT,
          conceptStatus: nextStatus,
          productionStatus,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      conceptId: concept.id,
      status: concept.status,
      complete: isComplete,
    });
  } catch (err: any) {
    console.error('[website-concept/sync] error:', err?.message);
    return NextResponse.json({ error: 'Failed to sync concept' }, { status: 500 });
  }
}
