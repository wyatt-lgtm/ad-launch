export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createConceptWebsiteMission, type ConceptWebsitePayload } from '@/lib/tombstone';

/**
 * POST /api/site-revision
 * Trigger a revision workflow using pending owner feedback.
 * Body: { analysisId, websiteUrl, businessName, industry, location? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { analysisId, websiteUrl, businessName, industry, location } = body;

    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 });
    }

    // Gather all pending feedback for this analysis
    const pendingFeedback = await prisma.siteFeedback.findMany({
      where: { analysisId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingFeedback.length === 0) {
      return NextResponse.json({ error: 'No pending feedback to apply' }, { status: 400 });
    }

    // Build owner_feedback payload for Tombstone
    const ownerFeedback = pendingFeedback.map((fb: any) => ({
      section_id: fb.sectionId,
      target: fb.target,
      feedback: fb.feedback,
      requested_action: fb.requestedAction || undefined,
    }));

    // Look up business info from analysis
    let businessId = '';
    try {
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        select: { businessId: true },
      });
      businessId = analysis?.businessId ?? '';
    } catch { /* non-critical */ }

    // Trigger a new concept website workflow with feedback attached
    const payload: ConceptWebsitePayload = {
      website_url: websiteUrl || '',
      business_name: businessName || 'the business',
      industry: industry || '',
      location: location || '',
      business_id: businessId,
      user_id: (session.user as any).id || '',
      google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
      owner_feedback: ownerFeedback,
    };

    const result = await createConceptWebsiteMission(payload);

    if (!result.success || !result.workflowId) {
      return NextResponse.json({ error: result.error || 'Revision workflow failed to start' }, { status: 500 });
    }

    // Mark feedback as applied
    await prisma.siteFeedback.updateMany({
      where: { id: { in: pendingFeedback.map((fb: any) => fb.id) } },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        appliedInWorkflowId: result.workflowId,
      },
    });

    return NextResponse.json({
      ok: true,
      workflowId: result.workflowId,
      taskIds: result.taskIds,
      feedbackApplied: pendingFeedback.length,
    });
  } catch (err: any) {
    console.error('[site-revision] POST error:', err?.message);
    return NextResponse.json({ error: 'Revision failed' }, { status: 500 });
  }
}
