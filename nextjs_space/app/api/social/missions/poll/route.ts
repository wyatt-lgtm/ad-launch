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
 *
 * Discovery happens via TWO lanes:
 *  1) Workflow-based: workflow IDs stored on Analysis.missionId / socialMissionId
 *  2) Business-based: businesses with tombstoneBusinessId → /content/queue?business_id=…
 *     This catches Tombstone-originated workflows that weren't created through Launch OS.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    // Parse optional businessId filter from request body
    let requestBusinessId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      requestBusinessId = body?.businessId || null;
    } catch { /* no body */ }

    console.log(`[missions/poll] ====== POLL START ======`);
    console.log(`[missions/poll] userId=${userId}, requestBusinessId=${requestBusinessId}`);

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

    // ── Business-level discovery: businesses with tombstoneBusinessId ──
    const businessesWithTombstone = await prisma.business.findMany({
      where: {
        userId,
        tombstoneBusinessId: { not: null },
      },
      select: { id: true, tombstoneBusinessId: true, businessName: true },
    });
    // Map tombstoneBusinessId → Launch OS businessId for attribution
    const tombstoneBizMap = new Map<number, string>();
    for (const biz of businessesWithTombstone) {
      if (biz.tombstoneBusinessId != null) {
        tombstoneBizMap.set(biz.tombstoneBusinessId, biz.id);
      }
    }

    // Log business mapping details
    for (const biz of businessesWithTombstone) {
      console.log(`[missions/poll] Business: name="${biz.businessName}" launchId=${biz.id} tombstoneBusinessId=${biz.tombstoneBusinessId}`);
    }

    const workflowIds = collectWorkflowIds(analyses);
    const workflowMap = buildWorkflowMap(analyses);

    const hasWorkflows = workflowIds.length > 0;
    const hasBusinessIds = tombstoneBizMap.size > 0;

    console.log(`[missions/poll] Lane 1 enabled=${hasWorkflows} (${workflowIds.length} workflow IDs)`);
    console.log(`[missions/poll] Lane 2 enabled=${hasBusinessIds} (${tombstoneBizMap.size} tombstone businesses)`);
    if (hasWorkflows) console.log(`[missions/poll] Lane 1 workflow IDs: ${workflowIds.slice(0, 10).join(', ')}${workflowIds.length > 10 ? '...' : ''}`);

    if (!hasWorkflows && !hasBusinessIds && analyses.length === 0) {
      console.log(`[missions/poll] No workflows and no tombstone businesses — returning no_missions`);
      return NextResponse.json({ polled: 0, imported: 0, skipped: 0, pending: 0, status: 'no_missions' });
    }

    // Get existing tombstoneTaskIds to skip already-imported tasks
    const existingPosts = await prisma.socialPost.findMany({
      where: { userId, tombstoneTaskId: { not: null } },
      select: { tombstoneTaskId: true },
    });
    const importedTaskIds = new Set(existingPosts.map(p => p.tombstoneTaskId));

    console.log(`[missions/poll] Already imported task IDs: ${importedTaskIds.size} (sample: ${[...importedTaskIds].slice(0, 5).join(', ')})`);

    // ── Lane 1: Workflow-based discovery ──
    let workflowQueueItems: any[] = [];
    if (hasWorkflows) {
      try {
        const queueRes = await fetch(
          `${TOMBSTONE_URL}/content/queue?limit=50&workflow_ids=${encodeURIComponent(workflowIds.join(','))}`,
          { headers: { Accept: 'application/json' }, cache: 'no-store' }
        );
        if (queueRes.ok) {
          const items = await queueRes.json();
          if (Array.isArray(items)) {
            workflowQueueItems = items;
            console.log(`[missions/poll] Lane 1 returned ${items.length} items from workflow query`);
          }
        } else {
          console.warn(`[missions/poll] Workflow queue fetch failed: ${queueRes.status}`);
        }
      } catch (e: any) {
        console.warn(`[missions/poll] Workflow queue fetch error:`, e.message);
      }
    }

    // ── Lane 2: Business-based discovery (catches Tombstone-originated workflows) ──
    let businessQueueItems: any[] = [];
    const taskToBizMap = new Map<string, string>(); // taskId → Launch OS businessId
    if (hasBusinessIds) {
      const bizFetches = Array.from(tombstoneBizMap.entries()).map(async ([tsBizId, launchBizId]) => {
        try {
          const bizQueueRes = await fetch(
            `${TOMBSTONE_URL}/content/queue?limit=50&business_id=${tsBizId}`,
            { headers: { Accept: 'application/json' }, cache: 'no-store' }
          );
          if (bizQueueRes.ok) {
            const items = await bizQueueRes.json();
            if (Array.isArray(items)) {
              console.log(`[missions/poll] Lane 2 biz=${tsBizId} (launchId=${launchBizId}) returned ${items.length} items: task_ids=[${items.map((i: any) => i.task_id).join(',')}]`);
              for (const item of items) {
                taskToBizMap.set(String(item.task_id), launchBizId);
              }
              return items;
            }
          } else {
            console.warn(`[missions/poll] Business queue fetch failed for biz=${tsBizId}: ${bizQueueRes.status}`);
          }
        } catch (e: any) {
          console.warn(`[missions/poll] Business queue fetch error for biz=${tsBizId}:`, e.message);
        }
        return [];
      });
      const results = await Promise.all(bizFetches);
      businessQueueItems = results.flat();
    }

    // ── Merge & deduplicate by task_id ──
    const seenTaskIds = new Set<string>();
    const queueItems: any[] = [];
    // Workflow items first (they have richer attribution via workflowMap)
    for (const item of workflowQueueItems) {
      const tid = String(item.task_id);
      if (!seenTaskIds.has(tid)) {
        seenTaskIds.add(tid);
        queueItems.push(item);
      }
    }
    // Then business-discovered items (new tasks from Tombstone-originated workflows)
    for (const item of businessQueueItems) {
      const tid = String(item.task_id);
      if (!seenTaskIds.has(tid)) {
        seenTaskIds.add(tid);
        item._discoveredViaBusiness = true;
        queueItems.push(item);
      }
    }

    // Log all discovered task IDs
    const allDiscoveredTaskIds = queueItems.map((item: any) => String(item.task_id));
    console.log(`[missions/poll] All discovered task IDs (${allDiscoveredTaskIds.length}): ${allDiscoveredTaskIds.join(', ')}`);

    if (queueItems.length === 0) {
      console.log(`[missions/poll] No queue items found from either lane — returning no_content`);
      return NextResponse.json({
        polled: workflowIds.length, imported: 0, skipped: 0, pending: 0,
        status: 'no_content',
        message: 'No completed render tasks found yet. Posts may still be generating.',
      });
    }

    console.log(`[missions/poll] Found ${queueItems.length} queue items, enriching with details...`);

    // Filter out already-imported tasks
    const skippedTaskIds: string[] = [];
    const newItems = queueItems.filter((item: any) => {
      const taskId = String(item.task_id);
      if (importedTaskIds.has(taskId)) {
        skippedTaskIds.push(taskId);
        return false;
      }
      return true;
    });

    if (skippedTaskIds.length > 0) {
      console.log(`[missions/poll] Skipped (already imported): ${skippedTaskIds.join(', ')}`);
    }

    if (newItems.length === 0) {
      console.log(`[missions/poll] All ${queueItems.length} tasks already imported — returning all_imported`);
      return NextResponse.json({
        polled: workflowIds.length, imported: 0, skipped: skippedTaskIds.length, pending: 0,
        status: 'all_imported',
        totalPosts: importedTaskIds.size,
        message: `All ${importedTaskIds.size} posts already imported.`,
      });
    }

    const newTaskIds = newItems.map((item: any) => String(item.task_id));
    console.log(`[missions/poll] New items to enrich (${newItems.length}): ${newTaskIds.join(', ')}`);
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

          // Extract source attribution (from Jim Bridger / Ogilvy upstream)
          const srcAttr = detail.source_attribution || {};
          const sourceName = srcAttr.source_name || null;
          const sourceArticleTitle = srcAttr.article_title || null;
          const sourceArticleUrl = srcAttr.article_url || null;
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

          // Look up workflow_id from Tombstone task endpoint if content queue didn't include it
          let resolvedWorkflowId = item.workflow_id || null;
          if (!resolvedWorkflowId) {
            try {
              const taskRes = await fetch(`${TOMBSTONE_URL}/tasks/${item.task_id}`, {
                headers: { Accept: 'application/json' }, cache: 'no-store',
              });
              if (taskRes.ok) {
                const taskData = await taskRes.json();
                resolvedWorkflowId = taskData.workflow_id || null;
                if (resolvedWorkflowId) {
                  console.log(`[missions/poll] Resolved workflow_id=${resolvedWorkflowId} for task ${item.task_id} via /tasks endpoint`);
                }
              }
            } catch (e: any) {
              console.warn(`[missions/poll] Failed to look up workflow_id for task ${item.task_id}:`, e.message);
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
            workflowId: resolvedWorkflowId,
            caption: caption + (cta ? `\n\n${cta}` : ''),
            hashtags,
            imageUrl: imageKey || null,
            postType: 'general',
            sourceType: campaignName ? 'campaign' : null,
            newsAngle: campaignName || null,
            platforms: ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
            sourceName,
            sourceArticleTitle,
            sourceArticleUrl,
            cta: cta || null,
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

    // Find matching GenerationRun for these workflow IDs
    const postWorkflowIds = [...new Set(posts.map((p: any) => p.workflowId).filter(Boolean))];
    let generationRun: any = null;
    if (postWorkflowIds.length > 0) {
      generationRun = await prisma.generationRun.findFirst({
        where: {
          userId,
          workflowIds: { hasSome: postWorkflowIds },
          status: { not: 'completed' },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Fallback: if no workflow match, find the most recent pending GenerationRun for this user
    if (!generationRun) {
      generationRun = await prisma.generationRun.findFirst({
        where: {
          userId,
          status: { not: 'completed' },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (generationRun) {
        console.log(`[missions/poll] No workflow match — using most recent GenerationRun ${generationRun.id} (biz=${generationRun.businessId})`);
      }
    }

    const now = new Date();

    // Validate required fields and separate complete from incomplete/failed
    const completePosts: any[] = [];
    const incompletePosts: any[] = [];
    for (const post of posts) {
      const missing: string[] = [];
      if (!post.caption?.trim()) missing.push('caption');
      if (!post.imageUrl) missing.push('imageUrl');
      if (!post.cta) missing.push('cta');
      if (!post.sourceName && !post.sourceArticleTitle) missing.push('source_attribution');
      if (!post.sourceArticleUrl) missing.push('sourceArticleUrl');

      post._missingFields = missing;
      post._importError = null;

      const hasCaption = !!post.caption?.trim();
      const hasImage = !!post.imageUrl;

      if (hasCaption || hasImage) {
        // Has at least some renderable content — mark as complete but track missing fields
        if (missing.length > 0 && !hasCaption) {
          // Has image but no caption — generation_incomplete
          post._importStatus = 'generation_incomplete';
          post._importError = `Missing required fields: ${missing.join(', ')}`;
          incompletePosts.push(post);
        } else {
          completePosts.push(post);
        }
      } else {
        // No caption AND no image — generation_failed
        post._importStatus = 'generation_failed';
        post._importError = `No usable output — missing: ${missing.join(', ')}`;
        incompletePosts.push(post);
        console.warn(`[missions/poll] Failed post: wf=${post.workflowId} task=${post.tombstoneTaskId} — ${post._importError}`);
      }
    }

    const createdPosts = await prisma.socialPost.createMany({
      data: completePosts.map((post) => {
        const ref = post.workflowId ? workflowMap.get(post.workflowId) : null;
        // For business-discovered tasks, use taskToBizMap for attribution
        const bizDiscoveredBusinessId = taskToBizMap.get(post.tombstoneTaskId) || null;
        // Fallback priority: workflowMap > business-discovery > generationRun > socialDefault
        const fallbackBusinessId = bizDiscoveredBusinessId || generationRun?.businessId || socialDefaultBusinessId;
        if (!ref && post.workflowId) {
          console.warn(`[missions/poll] workflowMap miss for wf=${post.workflowId} task=${post.tombstoneTaskId} — using fallback biz=${fallbackBusinessId} (bizDiscovered=${!!bizDiscoveredBusinessId}, genRun=${generationRun?.id || 'none'})`);
        }
        return {
          userId,
          analysisId: ref?.analysisId || socialDefaultAnalysisId,
          businessId: ref?.businessId || fallbackBusinessId,
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
          workflowId: post.workflowId || null,
          sourceName: post.sourceName || null,
          sourceArticleTitle: post.sourceArticleTitle || null,
          sourceArticleUrl: post.sourceArticleUrl || null,
          cta: post.cta || null,
          generationRunId: generationRun?.id || null,
          generationStartedAt: generationRun?.clickedAt || null,
          generationCompletedAt: now,
          totalGenerationTimeMs: generationRun?.clickedAt
            ? now.getTime() - new Date(generationRun.clickedAt).getTime()
            : null,
        };
      }),
      skipDuplicates: true,
    });

    // Create shell records for incomplete/failed posts so they're visible with diagnostic info
    let incompleteCreated = 0;
    if (incompletePosts.length > 0) {
      const result = await prisma.socialPost.createMany({
        data: incompletePosts.map((post) => {
          const ref = post.workflowId ? workflowMap.get(post.workflowId) : null;
          const incBizDiscoveredId = taskToBizMap.get(post.tombstoneTaskId) || null;
          const status = post._importStatus || 'generation_failed';
          // Build caption with diagnostic info for failed/incomplete posts
          const diagCaption = post.caption?.trim()
            ? post.caption
            : `[${status === 'generation_incomplete' ? 'Generation incomplete' : 'Generation failed'} — ${post._importError || 'no usable output'}]`;
          return {
            userId,
            analysisId: ref?.analysisId || socialDefaultAnalysisId,
            businessId: ref?.businessId || incBizDiscoveredId || socialDefaultBusinessId,
            caption: diagCaption,
            hashtags: [],
            imageUrl: post.imageUrl || null,
            imagePrompt: null,
            postType: post.postType || 'general',
            sourceType: post.sourceType || null,
            newsAngle: post.newsAngle || null,
            patternType: null,
            rssItemTitle: post.sourceArticleTitle || null,
            rssItemLink: post.sourceArticleUrl || null,
            platforms: post.platforms || [],
            status,
            tombstoneTaskId: post.tombstoneTaskId || null,
            workflowId: post.workflowId || null,
            sourceName: post.sourceName || null,
            sourceArticleTitle: post.sourceArticleTitle || null,
            sourceArticleUrl: post.sourceArticleUrl || null,
            cta: post.cta || null,
            generationRunId: generationRun?.id || null,
            generationStartedAt: generationRun?.clickedAt || null,
            generationCompletedAt: now,
            totalGenerationTimeMs: generationRun?.clickedAt
              ? now.getTime() - new Date(generationRun.clickedAt).getTime()
              : null,
          };
        }),
        skipDuplicates: true,
      });
      incompleteCreated = result.count;
      console.warn(`[missions/poll] Created ${incompleteCreated} incomplete/failed shell records (${incompletePosts.map(p => p._importStatus).join(', ')})`);
    }

    // Update GenerationRun to completed
    if (generationRun && createdPosts.count > 0) {
      const totalMs = generationRun.clickedAt
        ? now.getTime() - new Date(generationRun.clickedAt).getTime()
        : null;
      await prisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: 'completed',
          socialPostCreatedAt: now,
          completedAt: now,
          totalTimeMs: totalMs,
        },
      });
      console.log(`[missions/poll] GenerationRun ${generationRun.id} completed in ${totalMs}ms`);
    }

    const totalImported = createdPosts.count + incompleteCreated;
    console.log(`[missions/poll] Imported ${createdPosts.count} complete + ${incompleteCreated} incomplete social posts (runId=${generationRun?.id || 'none'})`);
    console.log(`[missions/poll] ====== POLL END: imported=${totalImported}, skipped=${skippedTaskIds.length} ======`);

    // ── Fetch render failure events for all relevant businesses ──
    let renderFailures: any[] = [];
    try {
      const bizIds = Array.from(tombstoneBizMap.keys());
      if (bizIds.length > 0) {
        const failureFetches = bizIds.map(async (tsBizId) => {
          try {
            const res = await fetch(
              `${TOMBSTONE_URL}/render-failures?business_id=${tsBizId}&limit=10`,
              { headers: { Accept: 'application/json' }, cache: 'no-store' }
            );
            if (res.ok) return await res.json();
          } catch { /* non-critical */ }
          return [];
        });
        const results = await Promise.all(failureFetches);
        renderFailures = results.flat();
      }
    } catch (e: any) {
      console.warn('[missions/poll] Render failure fetch error:', e.message);
    }

    return NextResponse.json({
      polled: workflowIds.length,
      imported: totalImported,
      importedComplete: createdPosts.count,
      importedIncomplete: incompleteCreated,
      skipped: skippedTaskIds.length,
      pending: 0,
      status: 'imported',
      message: `Imported ${createdPosts.count} post${createdPosts.count !== 1 ? 's' : ''}` +
        (incompleteCreated > 0 ? ` (${incompleteCreated} incomplete/failed)` : '') + '.',
      renderFailures: renderFailures.length > 0 ? renderFailures : undefined,
      renderFailureCount: renderFailures.length > 0 ? renderFailures.length : undefined,
      diagnostics: incompletePosts.map(p => ({
        tombstoneTaskId: p.tombstoneTaskId,
        workflowId: p.workflowId,
        status: p._importStatus,
        missingFields: p._missingFields,
        importError: p._importError,
        hasCaption: !!p.caption?.trim(),
        hasImage: !!p.imageUrl,
      })),
    });
  } catch (error: any) {
    console.error('Social missions poll error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
