export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createConceptWebsiteMission } from '@/lib/tombstone';

/**
 * POST /api/generate-concept-site
 * 
 * Kicks off a 5-step Tombstone concept-website workflow.
 * Returns immediately with workflow_id + taskIds for progress tracking.
 * The UI polls /api/concept-site-status for progress and final HTML.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      websiteUrl,
      businessName,
      industry,
      location,
      contentProfile,
      businessId,
      userId,
      // Legacy fields (still accepted for backward compat)
      sections,
      colorPalette,
    } = body;

    // Need at least a website URL or business name
    if (!websiteUrl && !businessName) {
      return NextResponse.json(
        { error: 'websiteUrl or businessName is required' },
        { status: 400 },
      );
    }

    // Build the Tombstone payload
    const result = await createConceptWebsiteMission({
      website_url: websiteUrl || '',
      business_name: businessName || 'the business',
      industry: industry || '',
      location: location || '',
      content_profile: contentProfile || {},
      business_id: businessId || '',
      user_id: userId || '',
      google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
    });

    if (!result.success) {
      console.error('[generate-concept-site] Tombstone workflow creation failed:', result.error);
      return NextResponse.json(
        { error: result.error || 'Failed to start concept website generation' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      workflowId: result.workflowId,
      taskIds: result.taskIds,
      missionName: result.missionName,
      stepCount: result.stepCount,
      // The final task (George Boole / Code Execution) is the last one
      finalTaskId: result.taskIds?.[result.taskIds.length - 1] ?? null,
    });
  } catch (err: any) {
    console.error('[generate-concept-site] Error:', err?.message);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
