export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

type AnalysisRef = { id: string; missionId: string | null; socialMissionId: string | null; businessId: string | null };

/**
 * Collect ALL workflow IDs from user's analyses (both missionId lanes and socialMissionId).
 */
function collectWorkflowIds(analyses: AnalysisRef[]): string[] {
  const ids = new Set<string>();
  for (const a of analyses) {
    for (const wf of extractWorkflowsFromAnalysis(a)) ids.add(wf);
  }
  return Array.from(ids);
}

/** Extract individual workflow IDs from an analysis record. */
function extractWorkflowsFromAnalysis(a: AnalysisRef): string[] {
  const ids: string[] = [];
  if (a.missionId) {
    try {
      const parsed = JSON.parse(a.missionId);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const v of Object.values(parsed)) {
          if (typeof v === 'string' && v.trim()) ids.push(v.trim());
          else if (Array.isArray(v)) {
            for (const id of v) if (typeof id === 'string' && id.trim()) ids.push(id.trim());
          }
        }
      }
    } catch {
      for (const part of a.missionId.split(',')) {
        const t = part.trim();
        if (t) ids.push(t);
      }
    }
  }
  if (a.socialMissionId) {
    for (const part of a.socialMissionId.split(',')) {
      const t = part.trim();
      if (t) ids.push(t);
    }
  }
  return ids;
}

/** Build a map: workflowId → { analysisId, businessId } */
function buildWorkflowMap(analyses: AnalysisRef[]): Map<string, { analysisId: string; businessId: string | null }> {
  const map = new Map<string, { analysisId: string; businessId: string | null }>();
  for (const a of analyses) {
    for (const wf of extractWorkflowsFromAnalysis(a)) {
      map.set(wf, { analysisId: a.id, businessId: a.businessId });
    }
  }
  return map;
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
      select: { id: true, missionId: true, socialMissionId: true, businessId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (analyses.length === 0) {
      return NextResponse.json({ polled: 0, imported: 0, pending: 0, status: 'no_missions' });
    }

    const workflowIds = collectWorkflowIds(analyses);
    const workflowMap = buildWorkflowMap(analyses);
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
          const rawImageUrl = item.first_image_url || '';

          // Extract the R2 key from presigned URLs so we can resolve fresh URLs on-demand.
          // Presigned R2 URLs look like: https://<bucket>.r2.cloudflarestorage.com/<bucket-name>/<key>?X-Amz-...
          // We strip the query string and the bucket prefix to get just the artifact key.
          let imageKey = rawImageUrl;
          if (rawImageUrl.startsWith('http')) {
            try {
              const parsed = new URL(rawImageUrl);
              // Path is like /tombstoner2/renders/task_1559/file.png
              // Remove leading slash and bucket prefix
              let pathPart = parsed.pathname.replace(/^\//, '');
              // Remove bucket name prefix if present (e.g. "tombstoner2/")
              const bucketPrefix = 'tombstoner2/';
              if (pathPart.startsWith(bucketPrefix)) {
                pathPart = pathPart.slice(bucketPrefix.length);
              }
              imageKey = pathPart;
            } catch {
              imageKey = rawImageUrl;
            }
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
            workflowId: item.workflow_id || null,
            caption: caption + (cta ? `\n\n${cta}` : ''),
            hashtags,
            imageUrl: imageKey || null,
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

    // Map each post to the correct analysis/business via its workflowId
    // If the workflowMap lookup fails (e.g. content queue didn't return workflow_id),
    // try to find the analysis that MOST RECENTLY had its socialMissionId set
    // (i.e. the one that triggered this generation).
    const defaultAnalysisId = analyses[0].id;
    const defaultBusinessId = analyses[0].businessId || null;

    // Find the most recent analysis that has a socialMissionId (the one that triggered generation)
    const socialAnalysis = analyses.find(a => a.socialMissionId);
    const socialDefaultAnalysisId = socialAnalysis?.id || defaultAnalysisId;
    const socialDefaultBusinessId = socialAnalysis?.businessId || defaultBusinessId;

    const createdPosts = await prisma.socialPost.createMany({
      data: posts.map((post) => {
        const ref = post.workflowId ? workflowMap.get(post.workflowId) : null;
        if (!ref && post.workflowId) {
          console.warn(`[missions/poll] workflowMap miss for wf=${post.workflowId} task=${post.tombstoneTaskId} — using socialDefault (${socialDefaultBusinessId})`);
        }
        return {
        userId,
        analysisId: ref?.analysisId || socialDefaultAnalysisId,
        businessId: ref?.businessId || socialDefaultBusinessId,
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
      };
      }),
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
