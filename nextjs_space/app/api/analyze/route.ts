export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createMissions } from '@/lib/tombstone';
import { isValidUrl } from '@/lib/email-validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { websiteUrl, userId } = body ?? {};
    if (!websiteUrl) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }
    if (!isValidUrl(websiteUrl)) {
      return NextResponse.json({ error: 'Please enter a valid website URL' }, { status: 400 });
    }

    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    console.log(`[analyze] Starting 3-ad analysis for: ${normalizedUrl}`);
    const result = await createMissions(normalizedUrl);
    console.log(`[analyze] Missions created:`, {
      success: result.success,
      workflowIds: result.workflowIds,
      taskCount: result.allTaskIds.length,
      angles: result.angles,
    });

    if (!result.success) {
      console.error('[analyze] Tombstone API failed');
      return NextResponse.json({ error: 'Failed to start ad generation. Please try again.' }, { status: 502 });
    }

    // Store all workflow IDs as comma-separated string in missionId field
    const missionId = result.workflowIds.join(',');

    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        missionId,
        status: 'processing',
        userId: userId ?? null,
      },
    });

    return NextResponse.json({
      analysisId: analysis.id,
      missionId,
      workflowCount: result.workflowIds.length,
      status: analysis.status,
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
