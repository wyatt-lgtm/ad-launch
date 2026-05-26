export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createLaneMission } from '@/lib/tombstone';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';

/**
 * POST /api/analysis/[id]/confirm-and-launch
 * Step 2: User confirms location, then launches 3 lane-based missions:
 *   Lane 1 (website): Brand/service post from website content
 *   Lane 2 (news): Post tied to local news
 *   Lane 3 (holiday): Post tied to upcoming holiday/event
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const analysisId = params.id;
    const body = await request.json().catch(() => ({} as any));
    const { name, address, city, state, zip, phone, placeId, googleMapsUrl } = body;

    // Validate analysis exists and is in pending_location state
    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    if (analysis.status !== 'pending_location') {
      return NextResponse.json({
        success: true,
        analysisId,
        missionId: analysis.missionId,
        status: analysis.status,
      });
    }

    // Save confirmed location
    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        businessName: name || analysis.businessName,
        businessAddr: address || analysis.businessAddr,
        businessCity: city || analysis.businessCity,
        businessState: state || analysis.businessState,
        businessZip: zip || analysis.businessZip,
        businessPhone: phone || analysis.businessPhone,
        geoConfirmed: true,
        geoSource: placeId ? 'google_places' : (analysis.geoSource ?? 'manual'),
        status: 'processing',
      },
    });

    const businessCity = city || analysis.businessCity || '';
    const businessState = state || analysis.businessState || '';
    const businessZip = zip || analysis.businessZip || '';
    const businessName = name || analysis.businessName || '';
    const businessAddr = address || analysis.businessAddr || '';
    const businessPhone = phone || analysis.businessPhone || '';
    console.log(`[confirm-and-launch] Location confirmed for ${analysisId}: ${businessName} in ${businessCity}, ${businessState} ${businessZip}`);

    // Sync confirmed location to the Business record
    if (analysis.businessId) {
      try {
        await prisma.business.update({
          where: { id: analysis.businessId },
          data: {
            ...(businessName ? { businessName } : {}),
            ...(businessAddr ? { businessAddr } : {}),
            ...(businessCity ? { businessCity } : {}),
            ...(businessState ? { businessState } : {}),
            ...(businessZip ? { businessZip } : {}),
            ...(businessPhone ? { businessPhone } : {}),
          },
        });
        console.log(`[confirm-and-launch] Business ${analysis.businessId} synced with location`);
      } catch (bizErr: any) {
        console.error('[confirm-and-launch] Business sync error (non-fatal):', bizErr?.message);
      }
    }

    // ── Gather context for news and holiday lanes (parallel) ─────────
    console.log(`[confirm-and-launch] Gathering context for: ${analysis.websiteUrl}`);
    const contextStart = Date.now();

    // Run RSS brief + events lookup in parallel
    const [newsContextResult, holidayContextResult] = await Promise.allSettled([
      // News context from RSS trade area feed
      (async () => {
        if (!businessZip) return '';
        try {
          const brief = await generateContentBrief(businessZip, 25);
          if (brief?.headlines && brief.headlines.length > 0) {
            return brief.headlines.slice(0, 5).map((h: any) =>
              `${h.title}${h.source ? ` (${h.source})` : ''}`
            ).join('\n');
          }
        } catch (err: any) {
          console.error('[confirm-and-launch] Failed to get local news:', err?.message);
        }
        return '';
      })(),
      // Holiday context from upcoming events
      (async () => {
        try {
          const events = getUpcomingEvents();
          if (events.length > 0) {
            return events.slice(0, 5).map(e => `${e.name} (${e.date}): ${e.ideas}`).join('\n');
          }
        } catch (err: any) {
          console.error('[confirm-and-launch] Failed to get upcoming events:', err?.message);
        }
        return '';
      })(),
    ]);

    let newsContext = newsContextResult.status === 'fulfilled' ? newsContextResult.value : '';
    let holidayContext = holidayContextResult.status === 'fulfilled' ? holidayContextResult.value : '';
    if (!newsContext) {
      newsContext = `Local community news and events in ${businessCity}, ${businessState}. Focus on small business, community development, or local economy stories.`;
    }
    if (!holidayContext) {
      holidayContext = 'Spring/Summer seasonal content — fresh starts, outdoor activities, community events';
    }

    console.log(`[confirm-and-launch] Context gathered in ${Date.now() - contextStart}ms`);

    // ── Launch 3 lane missions in the background (don't block response) ──
    console.log(`[confirm-and-launch] Launching 3 lane missions (background) for: ${analysis.websiteUrl}`);

    // Fire-and-forget: launch missions and record workflow IDs
    // The frontend will redirect immediately and poll for results.
    const websiteUrl = analysis.websiteUrl;
    const launchPromise = (async () => {
      const launchStart = Date.now();
      try {
        // Sequential to avoid Tombstone race condition that returns duplicate workflow IDs
        const websiteResult = await createLaneMission(websiteUrl, 'website', `Business: ${businessName} in ${businessCity}, ${businessState}`);
        const newsResult = await createLaneMission(websiteUrl, 'news', newsContext);
        const holidayResult = await createLaneMission(websiteUrl, 'holiday', holidayContext);

        console.log(`[confirm-and-launch] Missions launched in ${Date.now() - launchStart}ms`);
        console.log(`[confirm-and-launch] Lane missions created:`, {
          website: { success: websiteResult.success, workflowId: websiteResult.workflowId },
          news: { success: newsResult.success, workflowId: newsResult.workflowId },
          holiday: { success: holidayResult.success, workflowId: holidayResult.workflowId },
        });

        const laneWorkflows: Record<string, string> = {};
        if (websiteResult.workflowId) laneWorkflows.website = websiteResult.workflowId;
        if (newsResult.workflowId) laneWorkflows.news = newsResult.workflowId;
        if (holidayResult.workflowId) laneWorkflows.holiday = holidayResult.workflowId;

        // Safety check: warn if duplicate workflow IDs were returned
        const wfIds = Object.values(laneWorkflows);
        const uniqueWfIds = new Set(wfIds);
        if (uniqueWfIds.size < wfIds.length) {
          console.warn(`[confirm-and-launch] DUPLICATE workflow IDs detected! Lanes may collide:`, laneWorkflows);
        }

        const allWorkflowIds = Object.values(laneWorkflows);
        if (allWorkflowIds.length === 0) {
          console.error('[confirm-and-launch] All lane missions failed');
          await prisma.analysis.update({
            where: { id: analysisId },
            data: { status: 'error' },
          });
          return;
        }

        const missionId = JSON.stringify(laneWorkflows);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { missionId },
        });
        console.log(`[confirm-and-launch] Workflow IDs saved for ${analysisId}: ${missionId}`);
      } catch (err: any) {
        console.error('[confirm-and-launch] Background mission launch error:', err);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'error' },
        }).catch(() => {});
      }
    })();

    // Don't await — let it run in background while we respond immediately
    // In serverless, we can give it a small head-start to increase chances
    // of completion before the function tears down, but don't block.
    void launchPromise;

    return NextResponse.json({
      success: true,
      analysisId,
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}
