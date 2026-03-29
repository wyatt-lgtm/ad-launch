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
    const missionResult = await createMission(normalizedUrl);
    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        missionId: missionResult.missionId ? String(missionResult.missionId) : null,
        status: missionResult.success ? 'processing' : 'error',
        userId: userId ?? null,
      },
    });
    return NextResponse.json({
      analysisId: analysis.id,
      missionId: missionResult.missionId,
      status: analysis.status,
      missionData: missionResult.data,
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
