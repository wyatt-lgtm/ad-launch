export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMissionStatus, getMissionResults, extractAdsFromResults, enrichAdsWithOutputs } from '@/lib/tombstone';

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

    // If already completed with ads, return cached results
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

    // Poll Tombstone for status
    const statusResult = await getMissionStatus(analysis.missionId);
    const overallStatus = statusResult?.status ?? 'processing';

    console.log(`[mission-status] analysisId=${analysisId} missionId=${analysis.missionId} status=${overallStatus}`);

    if (overallStatus === 'completed') {
      // Fetch full results and extract ads
      const resultsResponse = await getMissionResults(analysis.missionId);
      const { ads: rawAds, seoData, postingPlan } = extractAdsFromResults(resultsResponse.data ?? []);

      // Enrich ads with outputs and artifact URLs
      const enrichedAds = await enrichAdsWithOutputs(rawAds);

      // Create ad records in DB
      for (const ad of enrichedAds) {
        await prisma.ad.create({
          data: {
            analysisId: analysis.id,
            imageUrl: ad?.imageUrl ?? null,
            caption: ad?.caption ?? '',
            headline: ad?.headline ?? 'Ad',
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
        seoData,
        postingPlan,
      });
    }

    // Update status in DB if changed
    const mappedStatus = overallStatus === 'error' ? 'error' : overallStatus === 'generating' ? 'generating' : 'processing';

    if (analysis.status !== mappedStatus) {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: mappedStatus },
      });
    }

    return NextResponse.json({
      status: mappedStatus,
      missionStatus: overallStatus,
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}