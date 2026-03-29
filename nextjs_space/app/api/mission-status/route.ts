export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMissionStatus, getMissionResults, extractAdsFromResults } from '@/lib/tombstone';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const analysisId = searchParams.get('analysisId');
    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 });
    }
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { ads: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    if (analysis.status === 'completed' && (analysis.ads?.length ?? 0) > 0) {
      return NextResponse.json({
        status: 'completed',
        ads: analysis.ads ?? [],
        seoData: analysis.seoData ?? null,
        postingPlan: analysis.postingPlan ?? null,
      });
    }
    if (!analysis.missionId) {
      return NextResponse.json({ status: analysis.status, error: 'No mission ID' });
    }
    const statusResult = await getMissionStatus(analysis.missionId);
    const missionStatus = statusResult?.status ?? 'unknown';

    if (missionStatus === 'completed' || missionStatus === 'done' || missionStatus === 'finished') {
      const resultsResponse = await getMissionResults(analysis.missionId);
      const { ads, seoData, postingPlan } = extractAdsFromResults(resultsResponse.data);

      // Create ad records
      for (const ad of ads) {
        await prisma.ad.create({
          data: {
            analysisId: analysis.id,
            imageUrl: ad?.imageUrl ?? ad?.image_url ?? null,
            caption: ad?.caption ?? ad?.text ?? '',
            headline: ad?.headline ?? ad?.title ?? 'Ad',
            watermarked: true,
          },
        });
      }

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          results: resultsResponse.data ?? {},
          seoData: seoData ?? {},
          postingPlan: postingPlan ?? {},
        },
      });

      const updatedAnalysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        include: { ads: true },
      });

      return NextResponse.json({
        status: 'completed',
        ads: updatedAnalysis?.ads ?? [],
        seoData: seoData,
        postingPlan: postingPlan,
        rawResults: resultsResponse.data,
      });
    }

    let mappedStatus = 'processing';
    if (missionStatus === 'failed' || missionStatus === 'error') mappedStatus = 'error';
    else if (missionStatus === 'running' || missionStatus === 'in_progress') mappedStatus = 'generating';

    if (analysis.status !== mappedStatus) {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: mappedStatus },
      });
    }

    return NextResponse.json({
      status: mappedStatus,
      missionStatus,
      missionData: statusResult.data,
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}
