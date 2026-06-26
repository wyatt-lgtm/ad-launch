export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createLaneMission, getWorkflowResults } from '@/lib/tombstone';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';

const VALID_LANES = ['website', 'news', 'holiday'] as const;
type LaneType = typeof VALID_LANES[number];

// Map incoming lane_type aliases to canonical lanes
const LANE_ALIAS: Record<string, LaneType> = {
  website: 'website',
  website_brand: 'website',
  news: 'news',
  local_news: 'news',
  holiday: 'holiday',
  upcoming_holiday: 'holiday',
  seasonal: 'holiday',
};

/**
 * POST /api/post-assets/regenerate-lane
 *
 * Regenerates a single post for one specific lane of an analysis.
 * Does NOT restart the full 3-lane workflow.
 *
 * Body: {
 *   analysis_id: string
 *   lane_type: 'website' | 'website_brand' | 'news' | 'local_news' | 'holiday' | 'upcoming_holiday'
 *   existing_asset_id?: string   // the current Ad id to replace
 *   reason?: string              // e.g. 'user_requested_regeneration'
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await request.json().catch(() => ({} as any));
    const { analysis_id, lane_type, existing_asset_id, reason } = body;

    if (!analysis_id) {
      return NextResponse.json({ error: 'analysis_id is required' }, { status: 400 });
    }

    const canonicalLane = LANE_ALIAS[lane_type];
    if (!canonicalLane) {
      return NextResponse.json(
        { error: `Invalid lane_type. Must be one of: ${Object.keys(LANE_ALIAS).join(', ')}` },
        { status: 400 },
      );
    }

    // Load analysis and verify ownership
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysis_id },
      include: { ads: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    if (analysis.userId && analysis.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Build lane-specific context (same logic as generate-more)
    const businessName = analysis.businessName || '';
    const businessCity = analysis.businessCity || '';
    const businessState = analysis.businessState || '';
    const businessZip = analysis.businessZip || '';
    let context = '';

    if (canonicalLane === 'website') {
      context = `Business: ${businessName} in ${businessCity}, ${businessState}`;
    } else if (canonicalLane === 'news') {
      try {
        if (businessZip) {
          const brief = await generateContentBrief(businessZip, 25);
          if (brief?.headlines && brief.headlines.length > 0) {
            context = brief.headlines.slice(0, 5)
              .map((h: any) => `${h.title}${h.source ? ` (${h.source})` : ''}`)
              .join('\n');
          }
        }
      } catch {}
      if (!context) {
        context = `Local community news and events in ${businessCity}, ${businessState}.`;
      }
    } else if (canonicalLane === 'holiday') {
      try {
        const events = getUpcomingEvents();
        if (events.length > 0) {
          context = events.slice(0, 5).map(e => `${e.name} (${e.date}): ${e.ideas}`).join('\n');
        }
      } catch {}
      if (!context) {
        context = 'Seasonal content — current season themes, community events';
      }
    }

    console.log('[regenerate-lane] Starting single-lane regeneration', {
      analysisId: analysis_id,
      businessId: analysis.businessId,
      lane: canonicalLane,
      existingAssetId: existing_asset_id || null,
      reason: reason || 'user_requested_regeneration',
    });

    // Create a single-post lane mission (count=1)
    const result = await createLaneMission(
      analysis.websiteUrl,
      canonicalLane,
      context,
      1, // Only 1 post
      undefined,
      analysis.businessId || undefined,
      businessName,
      analysis.tombstoneBusinessId,
    );

    if (!result.success || !result.workflowId) {
      console.error('[regenerate-lane] createLaneMission failed', { analysisId: analysis_id, lane: canonicalLane });
      return NextResponse.json({ error: 'Failed to start lane regeneration' }, { status: 502 });
    }

    console.log('[regenerate-lane] Lane mission created', {
      analysisId: analysis_id,
      businessId: analysis.businessId,
      lane: canonicalLane,
      workflowId: result.workflowId,
    });

    // Poll for completion (up to ~90 seconds)
    const MAX_POLLS = 18;
    const POLL_INTERVAL = 5000;
    let newAd: { headline: string; caption: string; imageUrl: string | null; cta?: string } | null = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      try {
        const wfResults = await getWorkflowResults([result.workflowId]);
        if (wfResults.ads && wfResults.ads.length > 0) {
          const ad = wfResults.ads[0];
          newAd = {
            headline: ad.headline || '',
            caption: ad.caption || '',
            imageUrl: ad.imageUrl || null,
            cta: ad.cta || '',
          };
          break;
        }
      } catch (err) {
        console.warn('[regenerate-lane] Poll error', { poll: i + 1, error: (err as Error).message });
      }
    }

    if (!newAd) {
      console.error('[regenerate-lane] Timed out waiting for workflow results', {
        analysisId: analysis_id, lane: canonicalLane, workflowId: result.workflowId,
      });
      return NextResponse.json(
        { error: 'Regeneration timed out. The post may still be generating — try refreshing in a minute.' },
        { status: 504 },
      );
    }

    // Determine if the new asset is complete (has image) or degraded (copy only)
    const isComplete = !!newAd.imageUrl;

    // Replace existing ad or create new one
    let savedAd;
    if (existing_asset_id) {
      // Update existing Ad record in place
      savedAd = await prisma.ad.update({
        where: { id: existing_asset_id },
        data: {
          headline: newAd.headline,
          caption: newAd.caption,
          imageUrl: newAd.imageUrl,
          watermarked: true,
        },
      });
    } else {
      // Create new Ad record for this lane
      savedAd = await prisma.ad.create({
        data: {
          analysisId: analysis_id,
          lane: canonicalLane,
          headline: newAd.headline,
          caption: newAd.caption,
          imageUrl: newAd.imageUrl,
          watermarked: true,
        },
      });
    }

    console.log('[regenerate-lane] Regeneration complete', {
      analysisId: analysis_id,
      businessId: analysis.businessId,
      lane: canonicalLane,
      adId: savedAd.id,
      hasImage: isComplete,
      imageUrl: newAd.imageUrl ? 'present' : 'missing',
      headline: newAd.headline?.slice(0, 60),
    });

    return NextResponse.json({
      success: true,
      ad: {
        id: savedAd.id,
        headline: savedAd.headline,
        caption: savedAd.caption,
        imageUrl: savedAd.imageUrl,
        watermarked: savedAd.watermarked,
        lane: savedAd.lane,
      },
      lane: canonicalLane,
      asset_status: isComplete ? 'complete' : 'image_missing',
      regenerated_from_asset_id: existing_asset_id || null,
      workflowId: result.workflowId,
    });
  } catch (err: any) {
    console.error('[regenerate-lane] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to regenerate lane' }, { status: 500 });
  }
}
