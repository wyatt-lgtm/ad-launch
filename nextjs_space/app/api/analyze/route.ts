export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createMission } from '@/lib/tombstone';
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

    console.log(`[analyze] Starting analysis for: ${normalizedUrl}`);
    const missionResult = await createMission(normalizedUrl);
    console.log(`[analyze] Mission result:`, {
      success: missionResult.success,
      missionId: missionResult.missionId,
      taskIds: missionResult.taskIds,
    });

    if (!missionResult.success) {
      console.error('[analyze] Tombstone API failed:', missionResult.data);
      return NextResponse.json({ error: 'Failed to start ad generation. Please try again.' }, { status: 502 });
    }

    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        missionId: missionResult.missionId ? String(missionResult.missionId) : null,
        status: 'processing',
        userId: userId ?? null,
      },
    });

    return NextResponse.json({
      analysisId: analysis.id,
      missionId: missionResult.missionId,
      status: analysis.status,
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}