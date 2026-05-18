// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateAllAdImages } from '@/lib/generate-ad-image';

/**
 * POST /api/upgrade-ad-images
 * Background job: upgrades Tombstone images to GPT-5.1 generated images.
 * Called fire-and-forget after ads are created with Tombstone images.
 */
export async function POST(req: NextRequest) {
  try {
    const { analysisId } = await req.json().catch(() => ({} as any));
    if (!analysisId) {
      return NextResponse.json({ error: 'Missing analysisId' }, { status: 400 });
    }

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { ads: { orderBy: { createdAt: 'asc' } } },
    });

    if (!analysis || analysis.status !== 'completed') {
      return NextResponse.json({ error: 'Analysis not found or not completed' }, { status: 404 });
    }

    // Skip if ads already have S3 URLs (already upgraded)
    const needsUpgrade = analysis.ads.filter(
      (ad) => !ad.imageUrl?.includes('.s3.') || !ad.imageUrl?.includes('amazonaws.com')
    );
    if (needsUpgrade.length === 0) {
      console.log(`[upgrade-ad-images] analysisId=${analysisId} — all ads already upgraded`);
      return NextResponse.json({ upgraded: 0 });
    }

    const results = (analysis.results ?? {}) as any;
    const research = results.research ?? {};
    const creative = results.creative ?? {};
    const adsData = results.ads ?? [];

    console.log(`[upgrade-ad-images] Starting GPT-5.1 upgrade for ${needsUpgrade.length} ads (analysisId=${analysisId})`);

    // Generate GPT-5.1 images one at a time to avoid timeout
    let upgraded = 0;
    for (let i = 0; i < Math.min(analysis.ads.length, adsData.length); i++) {
      const ad = analysis.ads[i];
      // Skip already-upgraded ads
      if (ad.imageUrl?.includes('.s3.') && ad.imageUrl?.includes('amazonaws.com')) continue;

      try {
        const singleAdData = [adsData[i]];
        const [result] = await generateAllAdImages(research, creative, singleAdData, analysis.websiteUrl);
        if (result?.imageUrl) {
          await prisma.ad.update({
            where: { id: ad.id },
            data: { imageUrl: result.imageUrl },
          });
          upgraded++;
          console.log(`[upgrade-ad-images] Ad ${ad.id} upgraded (${upgraded}/${needsUpgrade.length})`);
        }
      } catch (err: any) {
        console.error(`[upgrade-ad-images] Failed to upgrade ad ${ad.id}:`, err?.message);
      }
    }

    console.log(`[upgrade-ad-images] Done: ${upgraded}/${needsUpgrade.length} upgraded for analysisId=${analysisId}`);
    return NextResponse.json({ upgraded });
  } catch (err: any) {
    console.error('[upgrade-ad-images] Error:', err?.message);
    return NextResponse.json({ error: 'Upgrade failed' }, { status: 500 });
  }
}
