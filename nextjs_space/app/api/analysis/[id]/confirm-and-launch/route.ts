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

    // ── Launch 3 lane missions sequentially and save missionId to DB ──
    // IMPORTANT: We MUST await this and save missionId before responding.
    // Fire-and-forget causes lost workflow IDs when the serverless function
    // tears down before the background promise completes.
    console.log(`[confirm-and-launch] Launching 3 lane missions for: ${analysis.websiteUrl}`);

    const websiteUrl = analysis.websiteUrl;
    const launchStart = Date.now();
    const laneWorkflows: Record<string, string> = {};
    const usedWorkflowIds: string[] = [];

    // Helper: save missionId after each lane so even partial creation is captured
    const saveMissionId = async () => {
      if (Object.keys(laneWorkflows).length > 0) {
        const missionId = JSON.stringify(laneWorkflows);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { missionId },
        });
      }
    };

    try {
      // Sequential + exclude-list to avoid Tombstone race condition with duplicate workflow IDs
      const websiteResult = await createLaneMission(websiteUrl, 'website', `Business: ${businessName} in ${businessCity}, ${businessState}`, 1, usedWorkflowIds);
      if (websiteResult.workflowId) {
        usedWorkflowIds.push(websiteResult.workflowId);
        laneWorkflows.website = websiteResult.workflowId;
        await saveMissionId(); // Persist immediately — don't risk losing it
      }

      const newsResult = await createLaneMission(websiteUrl, 'news', newsContext, 1, usedWorkflowIds);
      if (newsResult.workflowId) {
        usedWorkflowIds.push(newsResult.workflowId);
        laneWorkflows.news = newsResult.workflowId;
        await saveMissionId();
      }

      const holidayResult = await createLaneMission(websiteUrl, 'holiday', holidayContext, 1, usedWorkflowIds);
      if (holidayResult.workflowId) {
        usedWorkflowIds.push(holidayResult.workflowId);
        laneWorkflows.holiday = holidayResult.workflowId;
        await saveMissionId();
      }

      console.log(`[confirm-and-launch] Missions launched in ${Date.now() - launchStart}ms`);
      console.log(`[confirm-and-launch] Lane missions created:`, {
        website: { success: websiteResult.success, workflowId: websiteResult.workflowId },
        news: { success: newsResult.success, workflowId: newsResult.workflowId },
        holiday: { success: holidayResult.success, workflowId: holidayResult.workflowId },
      });

      // Safety check: warn if duplicate workflow IDs were returned
      const wfIds = Object.values(laneWorkflows);
      const uniqueWfIds = new Set(wfIds);
      if (uniqueWfIds.size < wfIds.length) {
        console.warn(`[confirm-and-launch] DUPLICATE workflow IDs detected! Lanes may collide:`, laneWorkflows);
      }

      if (Object.keys(laneWorkflows).length === 0) {
        console.error('[confirm-and-launch] All lane missions failed');
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'error' },
        });
        return NextResponse.json({
          success: false,
          analysisId,
          status: 'error',
          error: 'Analysis pipeline could not be created. Please try again.',
        });
      }

      console.log(`[confirm-and-launch] Workflow IDs saved for ${analysisId}: ${JSON.stringify(laneWorkflows)}`);
    } catch (err: any) {
      console.error('[confirm-and-launch] Mission launch error:', err);
      // If we saved at least one lane, keep processing; otherwise mark error
      if (Object.keys(laneWorkflows).length === 0) {
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'error' },
        }).catch(() => {});
        return NextResponse.json({
          success: false,
          analysisId,
          status: 'error',
          error: 'Analysis pipeline could not be created. Please try again.',
        });
      }
      // Partial creation — some lanes saved, others failed
      console.log(`[confirm-and-launch] Partial launch: ${Object.keys(laneWorkflows).length} lanes saved despite error`);
    }

    return NextResponse.json({
      success: true,
      analysisId,
      missionId: JSON.stringify(laneWorkflows),
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}
