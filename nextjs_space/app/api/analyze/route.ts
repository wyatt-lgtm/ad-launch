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

    // Pre-flight: check if the website is reachable before spending resources
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const probe = await fetch(normalizedUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      }).catch(() => null);
      clearTimeout(timeout);

      if (!probe || !probe.ok) {
        // Try GET as fallback (some servers reject HEAD)
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 10000);
        const probe2 = await fetch(normalizedUrl, {
          signal: controller2.signal,
          redirect: 'follow',
        }).catch(() => null);
        clearTimeout(timeout2);

        if (!probe2 || !probe2.ok) {
          console.warn(`[analyze] Website unreachable: ${normalizedUrl} (status: ${probe?.status ?? probe2?.status ?? 'timeout'})`);
          return NextResponse.json({
            error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
          }, { status: 422 });
        }
      }
      console.log(`[analyze] Website reachable: ${normalizedUrl} (status: ${probe?.status ?? 200})`);
    } catch (probeErr: any) {
      console.warn(`[analyze] Website probe failed: ${normalizedUrl}`, probeErr?.message);
      return NextResponse.json({
        error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
      }, { status: 422 });
    }

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
