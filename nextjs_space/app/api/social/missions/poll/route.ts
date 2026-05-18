export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Collect ALL workflow IDs from user's analyses (both missionId lanes and socialMissionId).
 */
function collectWorkflowIds(analyses: { missionId: string | null; socialMissionId: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const a of analyses) {
    // Parse lane-based missionId JSON: {"website":"uuid", "news":"uuid", "holiday":"uuid"}
    if (a.missionId) {
      try {
        const parsed = JSON.parse(a.missionId);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const v of Object.values(parsed)) {
            if (typeof v === 'string' && v.trim()) ids.add(v.trim());
            else if (Array.isArray(v)) {
              for (const id of v) if (typeof id === 'string' && id.trim()) ids.add(id.trim());
            }
          }
        }
      } catch {
        for (const part of a.missionId.split(',')) {
          const t = part.trim();
          if (t) ids.add(t);
        }
      }
    }
    // Also include socialMissionId
    if (a.socialMissionId) {
      for (const part of a.socialMissionId.split(',')) {
        const t = part.trim();
        if (t) ids.add(t);
      }
    }
  }
  return Array.from(ids);
}

/**
 * POST /api/social/missions/poll
 *
 * Fetches completed render tasks from Tombstone's content queue (same source
 * as the Publish Queue), enriches each with caption/hashtag data from the
 * detail endpoint, and writes them to the SocialPost table.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    // Get all analyses that have any workflow IDs
    const analyses = await prisma.analysis.findMany({
      where: {
        userId,
        OR: [
          { missionId: { not: null } },
          { socialMissionId: { not: null } },
        ],
      },
      select: { id: true, missionId: true, socialMissionId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (analyses.length === 0) {
      return NextResponse.json({ polled: 0, imported: 0, pending: 0, status: 'no_missions' });
    }

    const workflowIds = collectWorkflowIds(analyses);
    if (workflowIds.length === 0) {
      return NextResponse.json({ polled: 0, imported: 0, pending: 0, status: 'no_workflows' });
    }

    // Get existing tombstoneTaskIds to skip already-imported tasks
    const existingPosts = await prisma.socialPost.findMany({
      where: { userId, tombstoneTaskId: { not: null } },
      select: { tombstoneTaskId: true },
    });
    const importedTaskIds = new Set(existingPosts.map(p => p.tombstoneTaskId));

    console.log(`[missions/poll] Fetching content queue for ${workflowIds.length} workflows (${importedTaskIds.size} already imported)`);

    // Fetch completed render tasks from Tombstone content queue
    const queueRes = await fetch(
      `${TOMBSTONE_URL}/content/queue?limit=50&workflow_ids=${encodeURIComponent(workflowIds.join(','))}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );
    if (!queueRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch content queue' }, { status: 502 });
    }
    const queueItems = await queueRes.json();

    if (!Array.isArray(queueItems) || queueItems.length === 0) {
      return NextResponse.json({
        polled: workflowIds.length, imported: 0, pending: 0,
        status: 'no_content',
        message: 'No completed render tasks found yet. Posts may still be generating.',
      });
    }

    console.log(`[missions/poll] Found ${queueItems.length} queue items, enriching with details...`);

    // Filter out already-imported tasks
    const newItems = queueItems.filter((item: any) => {
      const taskId = String(item.task_id);
      return !importedTaskIds.has(taskId);
    });

    if (newItems.length === 0) {
      return NextResponse.json({
        polled: workflowIds.length, imported: 0, pending: 0,
        status: 'all_imported',
        totalPosts: importedTaskIds.size,
        message: `All ${importedTaskIds.size} posts already imported.`,
      });
    }

    console.log(`[missions/poll] ${newItems.length} new items to enrich (${queueItems.length} total, ${importedTaskIds.size} already imported)`);

    // Enrich each item with caption/hashtag data from the detail endpoint
    const posts: any[] = [];
    const enrichResults = await Promise.all(
      newItems.map(async (item: any) => {
        try {
          const detailRes = await fetch(`${TOMBSTONE_URL}/content/${item.task_id}`, {
            headers: { Accept: 'application/json' }, cache: 'no-store',
          });
          if (!detailRes.ok) return null;
          const detail = await detailRes.json();

          const caption = detail.base_caption || detail.preview_text || item.preview_text || '';
          const cta = detail.cta || '';
          const hashtags = Array.isArray(detail.hashtags) ? detail.hashtags : [];
          const imageUrl = item.first_image_url || '';

          // Resolve image URL through Tombstone artifacts if it's an R2 key
          let resolvedImageUrl = imageUrl;
          if (imageUrl && !imageUrl.startsWith('http')) {
            try {
              const artRes = await fetch(`${TOMBSTONE_URL}/artifacts/resolve?key=${encodeURIComponent(imageUrl)}`);
              if (artRes.ok) {
                const artData = await artRes.json();
                resolvedImageUrl = artData.url || imageUrl;
              }
            } catch { /* keep original */ }
          }

          // Try to determine post type from campaign name or summary
          const pv = detail.platform_variants;
          let campaignName = '';
          if (Array.isArray(pv) && pv.length > 0) {
            campaignName = pv[0]?.campaign_name || '';
          }

          // Skip items without real caption data (e.g. parent multi-campaign renders)
          if (!caption || caption.startsWith('Multi-campaign render')) return null;

          return {
            tombstoneTaskId: String(item.task_id),
            caption: caption + (cta ? `\n\n${cta}` : ''),
            hashtags,
            imageUrl: resolvedImageUrl || null,
            postType: 'general',
            sourceType: campaignName ? 'campaign' : null,
            newsAngle: campaignName || null,
            platforms: ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
          };
        } catch (e: any) {
          console.warn(`[missions/poll] Failed to enrich task ${item.task_id}:`, e.message);
          return null;
        }
      })
    );

    for (const p of enrichResults) {
      if (p && p.caption) posts.push(p);
    }

    if (posts.length === 0) {
      return NextResponse.json({
        polled: workflowIds.length, imported: 0, pending: 0,
        status: 'no_captions',
        message: 'Found render tasks but no caption data yet.',
      });
    }

    // Use first analysis as default
    const defaultAnalysisId = analyses[0].id;

    const createdPosts = await prisma.socialPost.createMany({
      data: posts.map((post) => ({
        userId,
        analysisId: defaultAnalysisId,
        caption: post.caption,
        hashtags: post.hashtags,
        imageUrl: post.imageUrl,
        imagePrompt: null,
        postType: post.postType,
        sourceType: post.sourceType,
        newsAngle: post.newsAngle,
        patternType: null,
        rssItemTitle: null,
        rssItemLink: null,
        platforms: post.platforms,
        status: 'pending_approval',
        tombstoneTaskId: post.tombstoneTaskId || null,
      })),
      skipDuplicates: true,
    });

    console.log(`[missions/poll] Imported ${createdPosts.count} social posts`);

    return NextResponse.json({
      polled: workflowIds.length,
      imported: createdPosts.count,
      pending: 0,
      status: 'imported',
      message: `Successfully imported ${createdPosts.count} social posts!`,
    });
  } catch (error: any) {
    console.error('Social missions poll error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
