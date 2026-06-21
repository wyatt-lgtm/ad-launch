export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/site-feedback?analysisId=xxx[&sectionId=yyy]
 * Retrieve feedback entries for a given analysis, optionally filtered by section.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const analysisId = searchParams.get('analysisId');
    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 });
    }

    const where: any = { analysisId };
    const sectionId = searchParams.get('sectionId');
    if (sectionId) where.sectionId = sectionId;

    const feedback = await prisma.siteFeedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ feedback });
  } catch (err: any) {
    console.error('[site-feedback] GET error:', err?.message);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}

/**
 * POST /api/site-feedback
 * Create a new feedback entry.
 * Body: { analysisId, workflowId?, pageId?, sectionId, target, feedback, requestedAction? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await request.json().catch(() => ({}));
    const { analysisId, workflowId, pageId, sectionId, target, feedback, requestedAction } = body;

    if (!analysisId || !feedback) {
      return NextResponse.json({ error: 'analysisId and feedback are required' }, { status: 400 });
    }

    // Look up the business for this analysis
    let businessId: string | undefined;
    try {
      const analysis = await prisma.analysis.findUnique({ where: { id: analysisId }, select: { businessId: true } });
      businessId = analysis?.businessId ?? undefined;
    } catch { /* non-critical */ }

    const entry = await prisma.siteFeedback.create({
      data: {
        businessId: businessId ?? '',
        analysisId,
        workflowId: workflowId ?? '',
        pageId: pageId ?? 'homepage',
        sectionId: sectionId ?? 'general',
        target: target ?? 'section',
        feedback,
        requestedAction: requestedAction ?? '',
        status: 'pending',
        userId,
      },
    });

    return NextResponse.json({ ok: true, id: entry.id });
  } catch (err: any) {
    console.error('[site-feedback] POST error:', err?.message);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}
