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

    // ── Gather context for news and holiday lanes ────────────────────
    let newsContext = '';
    let holidayContext = '';

    // Get upcoming events/holidays
    try {
      const events = getUpcomingEvents();
      if (events.length > 0) {
        holidayContext = events.slice(0, 5).map(e => `${e.name} (${e.date}): ${e.ideas}`).join('\n');
      }
    } catch (err: any) {
      console.error('[confirm-and-launch] Failed to get upcoming events:', err?.message);
    }
    if (!holidayContext) {
      holidayContext = 'Spring/Summer seasonal content — fresh starts, outdoor activities, community events';
    }

    // Get local news via RSS trade area feed
    try {
      if (businessZip) {
        const brief = await generateContentBrief(businessZip, 25);
        if (brief?.headlines && brief.headlines.length > 0) {
          newsContext = brief.headlines.slice(0, 5).map((h: any) =>
            `${h.title}${h.source ? ` (${h.source})` : ''}`
          ).join('\n');
        }
      }
    } catch (err: any) {
      console.error('[confirm-and-launch] Failed to get local news:', err?.message);
    }
    if (!newsContext) {
      newsContext = `Local community news and events in ${businessCity}, ${businessState}. Focus on small business, community development, or local economy stories.`;
    }

    // ── Launch 3 lane missions sequentially (Tombstone serialises commands) ──
    console.log(`[confirm-and-launch] Launching 3 lane missions for: ${analysis.websiteUrl}`);

    const websiteResult = await createLaneMission(analysis.websiteUrl, 'website', `Business: ${businessName} in ${businessCity}, ${businessState}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const newsResult = await createLaneMission(analysis.websiteUrl, 'news', newsContext);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const holidayResult = await createLaneMission(analysis.websiteUrl, 'holiday', holidayContext);

    console.log(`[confirm-and-launch] Lane missions created:`, {
      website: { success: websiteResult.success, workflowId: websiteResult.workflowId },
      news: { success: newsResult.success, workflowId: newsResult.workflowId },
      holiday: { success: holidayResult.success, workflowId: holidayResult.workflowId },
    });

    // Collect workflow IDs (store as JSON map so we know which is which)
    const laneWorkflows: Record<string, string> = {};
    if (websiteResult.workflowId) laneWorkflows.website = websiteResult.workflowId;
    if (newsResult.workflowId) laneWorkflows.news = newsResult.workflowId;
    if (holidayResult.workflowId) laneWorkflows.holiday = holidayResult.workflowId;

    const allWorkflowIds = Object.values(laneWorkflows);
    if (allWorkflowIds.length === 0) {
      console.error('[confirm-and-launch] All lane missions failed');
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: 'error' },
      });
      return NextResponse.json({ error: 'Failed to start post generation. Please try again.' }, { status: 502 });
    }

    // Store as JSON so frontend knows which workflow = which lane
    const missionId = JSON.stringify(laneWorkflows);
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { missionId },
    });

    return NextResponse.json({
      success: true,
      analysisId,
      missionId,
      laneWorkflows,
      workflowCount: allWorkflowIds.length,
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}
