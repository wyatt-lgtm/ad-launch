export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createLaneMission } from '@/lib/tombstone';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';

/**
 * POST /api/analysis/[id]/generate-more
 * Generates 3 more posts for a specific lane.
 * Body: { lane: 'website' | 'news' | 'holiday' }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const analysisId = params.id;
    const body = await request.json().catch(() => ({} as any));
    const { lane } = body;

    if (!lane || !['website', 'news', 'holiday'].includes(lane)) {
      return NextResponse.json({ error: 'Valid lane required (website, news, holiday)' }, { status: 400 });
    }

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Build lane-specific context
    let context = '';
    const businessName = analysis.businessName || '';
    const businessCity = analysis.businessCity || '';
    const businessState = analysis.businessState || '';
    const businessZip = analysis.businessZip || '';

    if (lane === 'website') {
      context = `Business: ${businessName} in ${businessCity}, ${businessState}`;
    } else if (lane === 'news') {
      try {
        if (businessZip) {
          const brief = await generateContentBrief(businessZip, 25);
          if (brief?.headlines && brief.headlines.length > 0) {
            context = brief.headlines.slice(0, 5).map((h: any) =>
              `${h.title}${h.source ? ` (${h.source})` : ''}`
            ).join('\n');
          }
        }
      } catch {}
      if (!context) {
        context = `Local community news and events in ${businessCity}, ${businessState}.`;
      }
    } else if (lane === 'holiday') {
      try {
        const events = getUpcomingEvents();
        if (events.length > 0) {
          context = events.slice(0, 5).map(e => `${e.name} (${e.date}): ${e.ideas}`).join('\n');
        }
      } catch {}
      if (!context) {
        context = 'Seasonal content \u2014 current season themes, community events';
      }
    }

    console.log(`[generate-more] Creating 3 more ${lane} posts for ${analysisId}`);
    const result = await createLaneMission(analysis.websiteUrl, lane as any, context, 3, undefined, analysis.businessId || undefined);

    if (!result.success || !result.workflowId) {
      return NextResponse.json({ error: 'Failed to start generation' }, { status: 502 });
    }

    // Append new workflow to the analysis missionId
    let laneWorkflows: Record<string, string | string[]> = {};
    try {
      laneWorkflows = JSON.parse(analysis.missionId || '{}');
    } catch {
      // Legacy format — just store the new one
      laneWorkflows = {};
    }

    // Support multiple workflows per lane (array)
    const existing = laneWorkflows[lane];
    if (Array.isArray(existing)) {
      existing.push(result.workflowId);
    } else if (typeof existing === 'string') {
      laneWorkflows[lane] = [existing, result.workflowId];
    } else {
      laneWorkflows[lane] = result.workflowId;
    }

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        missionId: JSON.stringify(laneWorkflows),
        status: 'processing', // Reset to processing to trigger polling
      },
    });

    return NextResponse.json({
      success: true,
      lane,
      workflowId: result.workflowId,
      laneWorkflows,
    });
  } catch (err: any) {
    console.error('[generate-more] Error:', err);
    return NextResponse.json({ error: 'Failed to generate more posts' }, { status: 500 });
  }
}
