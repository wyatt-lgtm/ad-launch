export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * GET /api/website-concept/[id][?html=1]
 * Returns the stored concept record. With ?html=1, serves the rendered concept
 * HTML directly (used by the "View Concept" preview — stays available even after
 * production has started, since concept and production are separate records).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const concept = await prisma.websiteConcept.findUnique({
      where: { id: params.id },
    });
    if (!concept) {
      return NextResponse.json({ error: 'Concept not found' }, { status: 404 });
    }
    const access = await resolveBusinessAccess(
      session.user.email,
      concept.businessId,
    );
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const wantsHtml = new URL(request.url).searchParams.get('html') === '1';
    if (wantsHtml) {
      if (!concept.conceptHtml) {
        return new NextResponse('Concept HTML is not available yet.', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return new NextResponse(concept.conceptHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return NextResponse.json({
      concept: {
        id: concept.id,
        status: concept.status,
        version: concept.version,
        workflowId: concept.workflowId,
        finalTaskId: concept.finalTaskId,
        conceptSummary: concept.conceptSummary,
        hasHtml: !!concept.conceptHtml,
        designDirectionJson: concept.designDirectionJson,
        approvedByUserId: concept.approvedByUserId,
        approvedAt: concept.approvedAt,
        createdAt: concept.createdAt,
        updatedAt: concept.updatedAt,
      },
    });
  } catch (err: any) {
    console.error('[website-concept/[id]] error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
