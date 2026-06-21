export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getMultiWorkflowStatus, getWorkflowResults, getSocialWorkflowResults, pollRunStatus, recoverRunByIdempotencyKey } from '@/lib/tombstone';

const TOMBSTONE_API = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/** Resolve an R2 key (or stale presigned URL) to a fresh presigned URL.
 *  S3 public URLs (from GPT-5.1 generation) are passed through directly.
 *  Data URLs are also passed through.
 */
async function resolveImageUrl(keyOrUrl: string | null): Promise<string | null> {
  if (!keyOrUrl) return null;

  // Pass through data URLs
  if (keyOrUrl.startsWith('data:')) return keyOrUrl;

  // Pass through S3 public URLs (our GPT-5.1 generated images)
  if (keyOrUrl.includes('.s3.') && keyOrUrl.includes('amazonaws.com')) return keyOrUrl;

  let r2Key = keyOrUrl;
  if (r2Key.startsWith('http')) {
    try {
      const parsed = new URL(r2Key);
      let path = parsed.pathname.replace(/^\/+/, '');
      if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
      r2Key = path;
    } catch { return keyOrUrl; }
  }
  try {
    const res = await fetch(
      `${TOMBSTONE_API}/artifacts/resolve?artifact_path=${encodeURIComponent(r2Key)}`,
      { cache: 'no-store' },
    );
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? keyOrUrl;
  } catch { return keyOrUrl; }
}

/** Resolve image URLs for an array of ad objects. */
async function resolveAdImages(ads: any[]): Promise<any[]> {
  return Promise.all(
    ads.map(async (ad: any) => ({
      ...ad,
      imageUrl: await resolveImageUrl(ad?.imageUrl ?? null),
    })),
  );
}
/**
 * Idempotent ad creation: only creates an ad if no record with the same
 * analysisId + lane already exists. Returns the existing record if found.
 * This prevents duplicate ads from concurrent poll requests.
 */
async function createAdIdempotent(data: {
  analysisId: string;
  imageUrl: string | null;
  caption: string;
  headline: string;
  watermarked: boolean;
  lane: string | null;
}) {
  if (data.lane) {
    const existing = await prisma.ad.findFirst({
      where: { analysisId: data.analysisId, lane: data.lane },
    });
    if (existing) {
      return { created: false, ad: existing };
    }
  }
  const ad = await prisma.ad.create({ data });
  return { created: true, ad };
}

import { runSeoAudit } from '@/lib/seo-audit';
import { extractBusinessAddress, parseGeoString, type ExtractedAddress } from '@/lib/address-extractor';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
// GPT-5.1 image generation moved to /api/upgrade-ad-images (async, fire-and-forget)

/**
 * Pipeline phases for the frontend state machine.
 * The frontend must NEVER move backward through these phases.
 *   connecting → pipeline_preparing → generating → finalizing → completed | completed_with_warnings | failed
 */
type PipelinePhase = 'connecting' | 'pipeline_preparing' | 'generating' | 'finalizing' | 'completed' | 'completed_with_warnings' | 'failed';

/** Lane-level status for the frontend */
interface LaneStatus {
  status: 'completed' | 'running' | 'failed' | 'skipped' | 'queued';
  post_text: string | null;
  image_url: string | null;
  error: string | null;
}

function buildLaneStatuses(
  ads: any[],
  laneWorkflows: Record<string, string | string[]>,
  asyncLanes?: any[],
  failedLanes?: string[],
): Record<string, LaneStatus> {
  const LANE_MAP: Record<string, string> = { website_post: 'website', evergreen_post: 'holiday', news_post: 'news' };
  const expected = ['website', 'news', 'holiday'];
  const result: Record<string, LaneStatus> = {};

  // Build from async lane data if available
  if (asyncLanes) {
    for (const lane of asyncLanes) {
      const adLane = LANE_MAP[lane.lane_type];
      if (!adLane) continue;
      const ad = ads.find((a: any) => a.lane === adLane);
      result[adLane] = {
        status: lane.status === 'completed' || lane.status === 'completed_with_warning'
          ? (ad ? 'completed' : 'running') // if completed but no ad yet, still "running" from frontend POV
          : lane.status === 'failed' ? 'failed'
          : lane.status === 'processing' ? 'running'
          : 'queued',
        post_text: ad?.caption ?? null,
        image_url: ad?.imageUrl ?? null,
        error: lane.error_message ?? null,
      };
    }
  }

  // Fill from stored ads / workflows for lanes not covered by async
  for (const lane of expected) {
    if (result[lane]) continue;
    const ad = ads.find((a: any) => {
      let l = a.lane;
      if (l === 'seasonal') l = 'holiday';
      return l === lane;
    });
    if (ad) {
      result[lane] = { status: 'completed', post_text: ad.caption ?? null, image_url: ad.imageUrl ?? null, error: null };
    } else if (failedLanes?.includes(lane)) {
      result[lane] = { status: 'failed', post_text: null, image_url: null, error: 'Lane generation failed' };
    } else if (laneWorkflows[lane]) {
      result[lane] = { status: 'running', post_text: null, image_url: null, error: null };
    } else {
      result[lane] = { status: 'queued', post_text: null, image_url: null, error: null };
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const analysisId = searchParams.get('analysisId');
    if (!analysisId) {
      return NextResponse.json({ error: 'analysisId required' }, { status: 400 });
    }

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { ads: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Parse missionId: detect async format vs legacy lane-workflow map
    let laneWorkflows: Record<string, string | string[]> = {};
    let asyncCommandId: string | null = null;
    if (analysis.missionId) {
      try {
        const parsed = JSON.parse(analysis.missionId);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.command_id && parsed.async) {
            // New async format: { command_id, async: true, website?: 'wf-1', ... }
            asyncCommandId = parsed.command_id;
            // Also extract lane workflow IDs from enriched missionId
            // so the cached-completion path can detect failed lanes
            for (const [key, val] of Object.entries(parsed)) {
              if (key !== 'command_id' && key !== 'async' && key !== 'duplicate' && typeof val === 'string') {
                laneWorkflows[key] = val as string;
              }
            }
          } else {
            // Legacy format: { website: 'wf-1', news: 'wf-2', holiday: 'wf-3' }
            laneWorkflows = parsed;
          }
        }
      } catch { /* legacy comma-separated — no lane info */ }
    }
    // Normalize lane name aliases: 'seasonal' → 'holiday'
    if (laneWorkflows.seasonal && !laneWorkflows.holiday) {
      laneWorkflows.holiday = laneWorkflows.seasonal;
      delete laneWorkflows.seasonal;
    }

    const hasCommandId = !!asyncCommandId || !!analysis.missionId;

    // If already completed with ads, return cached results with fresh image URLs
    if ((analysis.status === 'completed' || analysis.status === 'completing') && (analysis.ads?.length ?? 0) > 0) {
      const freshAds = await resolveAdImages(analysis.ads ?? []);
      const cachedResults = (analysis.results ?? {}) as any;
      // Inject live location data from DB (may have been confirmed/edited by user)
      const seoData = analysis.seoData as any ?? {};
      if (analysis.businessCity || analysis.businessState || analysis.businessZip) {
        seoData.location = {
          address: analysis.businessAddr ?? '',
          city: analysis.businessCity ?? '',
          state: analysis.businessState ?? '',
          zip: analysis.businessZip ?? '',
          phone: analysis.businessPhone ?? '',
          source: analysis.geoSource ?? 'none',
          confidence: 1,
          confirmed: analysis.geoConfirmed ?? false,
        };
      }
      // Check if social workflow is still running
      let socialStatus = 'completed';
      if (analysis.socialMissionId) {
        const socialWfIds = analysis.socialMissionId.split(',').filter(Boolean);
        try {
          const sr = await getSocialWorkflowResults(socialWfIds);
          socialStatus = sr.status;
          // Store posts if they just completed and haven't been stored yet
          if (sr.status === 'completed' && sr.posts.length > 0 && analysis.userId) {
            const existingCount = await prisma.socialPost.count({ where: { analysisId: analysis.id } });
            if (existingCount === 0) {
              const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
              for (const post of sr.posts) {
                await prisma.socialPost.create({
                  data: {
                    userId: analysis.userId,
                    analysisId: analysis.id,
                    caption: post.caption || '',
                    hashtags: post.hashtags || [],
                    imageUrl: post.imageUrl || null,
                    imagePrompt: post.imagePrompt || null,
                    sourceType: post.sourceType || null,
                    newsAngle: post.newsAngle || null,
                    platforms: post.platforms || ALL_PLATFORMS,
                    postType: post.postType || 'general',
                    status: 'pending_approval',
                    tradeAreaZip: analysis.businessZip || null,
                    patternType: post.patternType || null,
                    rssItemTitle: post.rssItemTitle || null,
                    rssItemLink: post.rssItemLink || null,
                  },
                });
              }
              console.log(`[mission-status] Late-stored ${sr.posts.length} social posts`);
            }
          }
        } catch { /* ignore */ }
      }

      // Detect lanes that failed (have no ads stored)
      const cachedFailedLanes: string[] = [];
      if (Object.keys(laneWorkflows).length > 0) {
        const storedLanes = new Set((analysis.ads ?? []).map((a: any) => a.lane).filter(Boolean));
        for (const lane of Object.keys(laneWorkflows)) {
          if (!storedLanes.has(lane)) cachedFailedLanes.push(lane);
        }
      }

      const pipelinePhase: PipelinePhase = cachedFailedLanes.length > 0 ? 'completed_with_warnings' : 'completed';

      return NextResponse.json({
        status: 'completed',
        pipelinePhase,
        ads: freshAds,
        seoData,
        postingPlan: analysis.postingPlan ?? null,
        googleAdsData: cachedResults.googleAds ?? null,
        websiteConceptData: cachedResults.websiteConcept ?? null,
        budgetData: cachedResults.budget ?? null,
        socialStatus,
        laneWorkflows,
        laneStatuses: buildLaneStatuses(freshAds, laneWorkflows, undefined, cachedFailedLanes),
        tasks: [], // No need to poll tasks anymore
        ...(cachedFailedLanes.length > 0 ? { failedLanes: cachedFailedLanes } : {}),
      });
    }

    // If status is 'completed' but NO ads exist, this is a completed_no_outputs situation
    // Do NOT return 'completed' to the frontend — return 'finalizing' so UI doesn't show empty results
    if (analysis.status === 'completed' && (analysis.ads?.length ?? 0) === 0) {
      console.warn(`[mission-status] analysisId=${analysisId} status=completed but 0 ads — reporting as finalizing (completed_no_outputs)`);
      return NextResponse.json({
        status: 'processing',
        pipelinePhase: 'finalizing' as PipelinePhase,
        tasks: [],
        laneStatuses: buildLaneStatuses([], laneWorkflows),
        message: 'Finalizing your generated posts...',
        diagnostics: {
          analysisId,
          commandId: asyncCommandId,
          businessId: analysis.businessId,
          dbStatus: analysis.status,
          adCount: 0,
          issue: 'completed_no_outputs',
        },
      });
    }

    // If pending location confirmation, return current status
    if (analysis.status === 'pending_location') {
      return NextResponse.json({ status: analysis.status, tasks: [] });
    }

    // ── NEW ASYNC FLOW: poll the async command run for lane progress ──
    if (asyncCommandId) {
      const runStatus = await pollRunStatus(asyncCommandId);
      if (!runStatus) {
        // Command not found or Tombstone down — keep polling
        return NextResponse.json({
          status: 'processing',
          pipelinePhase: 'pipeline_preparing' as PipelinePhase,
          tasks: [],
          laneStatuses: buildLaneStatuses([], laneWorkflows),
          message: 'Waiting for analysis pipeline...',
        });
      }

      // Map async lane types to ad lane names
      const LANE_MAP: Record<string, string> = {
        website_post: 'website',
        evergreen_post: 'holiday',
        news_post: 'news',
      };

      // Build laneWorkflows from completed lanes (for downstream ad creation)
      const asyncLaneWorkflows: Record<string, string> = {};
      for (const lane of runStatus.lanes) {
        const adLane = LANE_MAP[lane.lane_type];
        if (adLane && lane.workflow_id) {
          asyncLaneWorkflows[adLane] = lane.workflow_id;
        }
      }

      // Update missionId with workflow IDs once we have them (so legacy path can pick up)
      if (Object.keys(asyncLaneWorkflows).length > 0) {
        const enrichedMissionId = JSON.stringify({
          command_id: asyncCommandId,
          async: true,
          ...asyncLaneWorkflows,
        });
        // Only write if we actually gained new workflow IDs
        const currentMission = analysis.missionId ?? '';
        if (enrichedMissionId.length > currentMission.length) {
          await prisma.analysis.update({
            where: { id: analysisId },
            data: { missionId: enrichedMissionId },
          }).catch(() => {});
        }
        // Set laneWorkflows for downstream ad extraction
        laneWorkflows = asyncLaneWorkflows;
      }

      // Determine overall status
      const allLaneStatuses = runStatus.lanes.map(l => l.status);
      const allCompleted = allLaneStatuses.every(s => s === 'completed' || s === 'completed_with_warning');
      const anyFailed = allLaneStatuses.some(s => s === 'failed');
      const allDone = allLaneStatuses.every(s => s === 'completed' || s === 'completed_with_warning' || s === 'failed');

      // Build task items for the UI from lane statuses
      const asyncTasks = runStatus.lanes
        .filter(l => LANE_MAP[l.lane_type]) // skip scout_news_retrieval
        .map((l, i) => ({
          id: i,
          workflowId: l.workflow_id || '',
          department: LANE_MAP[l.lane_type] || l.lane_type,
          label: l.lane_type === 'website_post' ? 'Website / Brand Post'
               : l.lane_type === 'evergreen_post' ? 'Holiday / Seasonal Post'
               : l.lane_type === 'news_post' ? 'Local News Post'
               : l.lane_type,
          description: l.status === 'processing' ? 'Generating...' : l.status === 'queued' ? 'Waiting...' : '',
          status: l.status === 'completed' || l.status === 'completed_with_warning' ? 'complete' as const
                : l.status === 'processing' ? 'active' as const
                : l.status === 'failed' ? 'error' as const
                : 'waiting' as const,
          rawStatus: l.status,
        }));

      // If all lanes are done, extract workflow IDs and feed into existing completion path
      if (allDone) {
        const completedWfIds = runStatus.lanes
          .filter(l => (l.status === 'completed' || l.status === 'completed_with_warning') && l.workflow_id && LANE_MAP[l.lane_type])
          .map(l => l.workflow_id!);

        const failedLaneNames = runStatus.lanes
          .filter(l => l.status === 'failed' && LANE_MAP[l.lane_type])
          .map(l => LANE_MAP[l.lane_type]);

        if (completedWfIds.length === 0) {
          // All lanes failed
          await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'error' } }).catch(() => {});
          const firstErr = runStatus.lanes.find(l => l.error_message);
          return NextResponse.json({
            status: 'error',
            pipelinePhase: 'failed' as PipelinePhase,
            tasks: asyncTasks,
            laneWorkflows: asyncLaneWorkflows,
            laneStatuses: buildLaneStatuses([], asyncLaneWorkflows, runStatus.lanes),
            errorReason: firstErr?.error_message ?? 'All post generation lanes failed. Please try again.',
          });
        }

        // Feed completed workflow IDs into the existing full-completion logic
        // Simulate the same statusResult shape the legacy path expects
        const syntheticStatusResult = {
          status: allCompleted ? 'completed' : 'error',
          tasks: asyncTasks,
          completedWorkflows: completedWfIds,
        };

        // Use the same completion path as the legacy flow (lock + ad creation)
        // We set workflowIds and laneWorkflows, then fall through to the existing code
        // To avoid duplicating 200 lines, we redirect via a self-call with the legacy format
        // Actually, let's just inline the completion call here using the helper functions

        const lockResult = await prisma.analysis.updateMany({
          where: { id: analysisId, status: { notIn: ['completed', 'completing'] } },
          data: { status: 'completing' },
        });

        if (lockResult.count === 0) {
          // Already completing/completed
          const refetched = await prisma.analysis.findUnique({ where: { id: analysisId }, include: { ads: true } });
          if (refetched?.status === 'completed' && (refetched.ads?.length ?? 0) > 0) {
            const freshAds = await resolveAdImages(refetched.ads ?? []);
            const cachedResults = (refetched.results ?? {}) as any;
            const phase: PipelinePhase = failedLaneNames.length > 0 ? 'completed_with_warnings' : 'completed';
            return NextResponse.json({
              status: 'completed', pipelinePhase: phase, ads: freshAds, seoData: refetched.seoData ?? null,
              postingPlan: refetched.postingPlan ?? null, googleAdsData: cachedResults.googleAds ?? null,
              websiteConceptData: cachedResults.websiteConcept ?? null, budgetData: cachedResults.budget ?? null,
              tasks: asyncTasks, laneWorkflows: asyncLaneWorkflows,
              laneStatuses: buildLaneStatuses(freshAds, asyncLaneWorkflows, runStatus.lanes, failedLaneNames),
              ...(failedLaneNames.length > 0 ? { failedLanes: failedLaneNames } : {}),
            });
          }
          return NextResponse.json({
            status: 'processing',
            pipelinePhase: 'finalizing' as PipelinePhase,
            tasks: asyncTasks, laneWorkflows: asyncLaneWorkflows,
            laneStatuses: buildLaneStatuses([], asyncLaneWorkflows, runStatus.lanes),
            message: 'Finalizing your generated posts...',
          });
        }

        try {
          const results = await getWorkflowResults(completedWfIds);
          const seoData = await buildSeoData(results.research, results.creative, results.marketing, analysis.websiteUrl, analysisId);
          const postingPlan = buildPostingPlan(results.research, results.creative, results.marketing, analysis.websiteUrl);
          const googleAdsData = buildGoogleAds(results.research, results.creative, analysis.websiteUrl, {
            businessName: (analysis as any).businessName ?? '', city: analysis.businessCity ?? '', state: analysis.businessState ?? '',
          });
          const websiteConceptData = buildWebsiteConcept(results.research, results.creative, analysis.websiteUrl, {
            businessId: analysis.businessId ?? '', location: [analysis.businessCity, analysis.businessState].filter(Boolean).join(', '),
            industry: results.research?.business_summary?.category ?? '',
          });
          const budgetData = buildBudgetRecommendations(results.research, analysis.websiteUrl);

          const wfToLane: Record<string, string> = {};
          for (const [lane, wfId] of Object.entries(asyncLaneWorkflows)) {
            wfToLane[wfId] = lane;
          }

          // Log lane→workflow mapping for diagnostics
          console.log(`[mission-status] Async completion: ${completedWfIds.length} workflows completed, ${results.ads.length} ads extracted, wfToLane=${JSON.stringify(wfToLane)}`);

          let createdCount = 0;
          const unmappedLanes: string[] = [];
          for (const ad of results.ads) {
            let imageKey = ad?.imageUrl ?? null;
            if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
              try { const p = new URL(imageKey); let path = p.pathname.replace(/^\/+/, ''); if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length); imageKey = path; } catch {}
            }
            const assignedLane = wfToLane[ad?.workflowId] ?? null;
            if (!assignedLane) unmappedLanes.push(ad?.workflowId ?? 'unknown');
            const { created } = await createAdIdempotent({
              analysisId: analysis.id, imageUrl: imageKey, caption: ad?.caption ?? '',
              headline: ad?.headline ?? 'Ad', watermarked: true, lane: assignedLane,
            });
            if (created) createdCount++;
          }
          if (unmappedLanes.length > 0) {
            console.warn(`[mission-status] ${unmappedLanes.length} ads had no lane mapping (workflows: ${unmappedLanes.join(', ')})`);
          }
          console.log(`[mission-status] Async completion: created ${createdCount} ads for ${Object.keys(wfToLane).length} lanes`);

          await prisma.analysis.update({
            where: { id: analysisId },
            data: {
              status: 'completed',
              results: { ...results as any, googleAds: googleAdsData, websiteConcept: websiteConceptData, budget: budgetData } as any,
              seoData: seoData as any, postingPlan: postingPlan as any,
            },
          });

          const updatedAnalysis = await prisma.analysis.findUnique({ where: { id: analysisId }, include: { ads: true } });
          const freshAds = await resolveAdImages(updatedAnalysis?.ads ?? []);

          // Fire-and-forget image upgrade
          const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
          fetch(`${baseUrl}/api/upgrade-ad-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId }) }).catch(() => {});

          // Determine phase: if we created ads, it's truly completed; if 0 ads, it's output_hydration_failed
          const hasUsableAds = (freshAds?.length ?? 0) > 0;
          if (!hasUsableAds) {
            console.warn(`[mission-status] Async completion created 0 ads from ${completedWfIds.length} workflows — output_hydration_failed`);
            // Reset to processing so we don't show empty completed state
            await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'processing' } });
            return NextResponse.json({
              status: 'processing',
              pipelinePhase: 'finalizing' as PipelinePhase,
              tasks: asyncTasks, laneWorkflows: asyncLaneWorkflows,
              laneStatuses: buildLaneStatuses([], asyncLaneWorkflows, runStatus.lanes, failedLaneNames),
              message: 'Finalizing your generated posts...',
              diagnostics: {
                analysisId, commandId: asyncCommandId, businessId: analysis.businessId,
                completedWorkflows: completedWfIds, adCount: 0, issue: 'output_hydration_failed',
              },
            });
          }

          const phase: PipelinePhase = failedLaneNames.length > 0 ? 'completed_with_warnings' : 'completed';
          return NextResponse.json({
            status: 'completed', pipelinePhase: phase, ads: freshAds, seoData, postingPlan, googleAdsData, websiteConceptData, budgetData,
            tasks: asyncTasks, laneWorkflows: asyncLaneWorkflows,
            laneStatuses: buildLaneStatuses(freshAds, asyncLaneWorkflows, runStatus.lanes, failedLaneNames),
            ...(failedLaneNames.length > 0 ? { failedLanes: failedLaneNames } : {}),
          });
        } catch (err: any) {
          console.error('[mission-status] Async completion failed, resetting:', err?.message);
          await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'processing' } });
          return NextResponse.json({
            status: 'processing',
            pipelinePhase: 'finalizing' as PipelinePhase,
            tasks: asyncTasks,
            laneStatuses: buildLaneStatuses([], asyncLaneWorkflows, runStatus.lanes),
            message: 'Finalizing your generated posts...',
            diagnostics: {
              analysisId, commandId: asyncCommandId, businessId: analysis.businessId,
              issue: 'completion_exception', error: err?.message,
            },
          });
        }
      }

      // ── Still processing: extract any completed lane ads progressively ──
      let partialAds: any[] = [];
      const completedLaneWfs = runStatus.lanes
        .filter(l => (l.status === 'completed' || l.status === 'completed_with_warning') && l.workflow_id && LANE_MAP[l.lane_type])
        .map(l => ({ wfId: l.workflow_id!, lane: LANE_MAP[l.lane_type] }));

      if (completedLaneWfs.length > 0) {
        const existingAds = await prisma.ad.findMany({ where: { analysisId: analysis.id }, select: { lane: true } });
        const existingLanes = new Set(existingAds.map(a => a.lane).filter(Boolean));

        const newLaneWfs = completedLaneWfs.filter(l => !existingLanes.has(l.lane));
        if (newLaneWfs.length > 0) {
          console.log(`[mission-status] Async progressive: ${newLaneWfs.length} lanes newly completed`);
          try {
            const partialResults = await getWorkflowResults(newLaneWfs.map(l => l.wfId));
            const wfToLane: Record<string, string> = {};
            for (const l of newLaneWfs) wfToLane[l.wfId] = l.lane;

            for (const ad of partialResults.ads) {
              let imageKey = ad?.imageUrl ?? null;
              if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
                try { const p = new URL(imageKey); let path = p.pathname.replace(/^\/+/, ''); if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length); imageKey = path; } catch {}
              }
              const { created, ad: createdAd } = await createAdIdempotent({
                analysisId: analysis.id, imageUrl: imageKey, caption: ad?.caption ?? '',
                headline: ad?.headline ?? 'Ad', watermarked: true, lane: wfToLane[ad?.workflowId] ?? null,
              });
              if (created) partialAds.push(createdAd);
            }
            if (partialAds.length > 0) {
              console.log(`[mission-status] Async progressive: stored ${partialAds.length} early ads`);
              const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
              fetch(`${baseUrl}/api/upgrade-ad-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId }) }).catch(() => {});
            }
          } catch (err: any) {
            console.error('[mission-status] Async progressive ad extraction error:', err?.message);
          }
        }

        // Return all stored ads
        if (existingAds.length > 0 || partialAds.length > 0) {
          const allAds = await prisma.ad.findMany({ where: { analysisId: analysis.id } });
          partialAds = await resolveAdImages(allAds);
        }
      }

      // Determine generating phase based on lane statuses
      const anyLaneRunning = runStatus.lanes.some(l => l.status === 'processing');
      const anyLaneQueued = runStatus.lanes.some(l => l.status === 'queued');
      const asyncPhase: PipelinePhase = anyLaneRunning ? 'generating'
        : anyLaneQueued ? 'pipeline_preparing'
        : 'generating';

      return NextResponse.json({
        status: 'processing',
        pipelinePhase: asyncPhase,
        tasks: asyncTasks,
        laneWorkflows: asyncLaneWorkflows,
        laneStatuses: buildLaneStatuses(partialAds, asyncLaneWorkflows, runStatus.lanes),
        ...(partialAds.length > 0 ? { ads: partialAds } : {}),
      });
    }

    // No missionId yet — missions are being created or creation failed
    if (!analysis.missionId) {
      const ageMs = Date.now() - new Date(analysis.updatedAt).getTime();
      const ageSec = Math.round(ageMs / 1000);

      // If analysis is in 'error' state with no missionId, pipeline creation failed
      if (analysis.status === 'error') {
        return NextResponse.json({
          status: 'error',
          pipelinePhase: 'failed' as PipelinePhase,
          tasks: [],
          laneStatuses: buildLaneStatuses([], laneWorkflows),
          errorReason: 'Analysis pipeline could not be created. Please try again.',
        });
      }

      // After 90 seconds with no missionId, try recovery before giving up
      if (ageSec > 90) {
        console.warn(`[mission-status] analysisId=${analysisId} has no missionId after ${ageSec}s — attempting recovery`);

        // The analysisId was used as the idempotency_key in createAsyncRun.
        // Tombstone may have completed the run even though the frontend never received the response.
        const recovered = await recoverRunByIdempotencyKey(analysisId);
        if (recovered?.command_id) {
          console.log(`[mission-status] Recovered command_id=${recovered.command_id} for analysisId=${analysisId} (status=${recovered.status})`);
          const recoveredMissionId = JSON.stringify({ command_id: recovered.command_id, async: true });
          await prisma.analysis.update({
            where: { id: analysisId },
            data: { missionId: recoveredMissionId, status: 'processing' },
          });
          // Return processing so the frontend re-polls and picks up the recovered run
          return NextResponse.json({
            status: 'processing',
            pipelinePhase: 'pipeline_preparing' as PipelinePhase,
            tasks: [],
            laneStatuses: buildLaneStatuses([], laneWorkflows),
            message: 'Recovered analysis pipeline — resuming...',
          });
        }

        // Recovery failed — truly no run exists
        console.warn(`[mission-status] Recovery failed for analysisId=${analysisId} — marking as error`);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'error' },
        });
        return NextResponse.json({
          status: 'error',
          pipelinePhase: 'failed' as PipelinePhase,
          tasks: [],
          laneStatuses: buildLaneStatuses([], laneWorkflows),
          errorReason: 'Analysis pipeline was not created. Please try again.',
        });
      }

      // Still within timeout — missions are being launched
      return NextResponse.json({
        status: 'processing',
        pipelinePhase: 'connecting' as PipelinePhase,
        tasks: [],
        laneStatuses: buildLaneStatuses([], laneWorkflows),
        message: 'Launching analysis pipeline...',
      });
    }

    // Build flat array of workflow IDs from laneWorkflows or legacy comma-separated
    let workflowIds: string[] = [];
    if (Object.keys(laneWorkflows).length > 0) {
      // Flatten — each lane value can be a string or array of strings (from generate-more)
      for (const v of Object.values(laneWorkflows)) {
        if (Array.isArray(v)) workflowIds.push(...v);
        else if (v) workflowIds.push(v);
      }
    } else if (analysis.missionId) {
      workflowIds = analysis.missionId.split(',').filter(Boolean);
    }

    // Poll Tombstone for status
    const statusResult = await getMultiWorkflowStatus(workflowIds);
    const overallStatus = statusResult?.status ?? 'processing';

    console.log(`[mission-status] analysisId=${analysisId} workflows=${workflowIds.length} overallStatus=${overallStatus} tasks=${statusResult.tasks?.length ?? 0}`);

    if (overallStatus === 'completed') {
      // Guard: prevent duplicate ad creation from concurrent poll requests.
      // Use an atomic status update — only proceed if we successfully transition from non-completed to 'completed'.
      const lockResult = await prisma.analysis.updateMany({
        where: { id: analysisId, status: { notIn: ['completed', 'completing'] } },
        data: { status: 'completing' },
      });

      if (lockResult.count === 0) {
        // Another request already started completion — check if it finished or timed out
        const refetched = await prisma.analysis.findUnique({
          where: { id: analysisId },
          include: { ads: true },
        });

        if (refetched?.status === 'completed' && (refetched.ads?.length ?? 0) > 0) {
          const freshAds = await resolveAdImages(refetched.ads ?? []);
          const cachedResults = (refetched.results ?? {}) as any;
          return NextResponse.json({
            status: 'completed',
            pipelinePhase: 'completed' as PipelinePhase,
            ads: freshAds,
            seoData: refetched.seoData ?? null,
            postingPlan: refetched.postingPlan ?? null,
            googleAdsData: cachedResults.googleAds ?? null,
            websiteConceptData: cachedResults.websiteConcept ?? null,
            budgetData: cachedResults.budget ?? null,
            laneStatuses: buildLaneStatuses(freshAds, laneWorkflows),
            tasks: [],
          });
        }

        // Timeout recovery: if stuck in 'completing' for > 5 minutes, reset to allow retry
        if (refetched?.status === 'completing' && refetched.updatedAt) {
          const stuckMs = Date.now() - new Date(refetched.updatedAt).getTime();
          if (stuckMs > 5 * 60 * 1000) {
            console.warn(`[mission-status] analysisId=${analysisId} stuck in 'completing' for ${Math.round(stuckMs / 1000)}s — resetting to processing`);
            await prisma.analysis.update({
              where: { id: analysisId },
              data: { status: 'processing' },
            });
          }
        }

        // Still completing — tell frontend to keep polling
        console.log(`[mission-status] analysisId=${analysisId} completion in progress, returning pending`);
        return NextResponse.json({
          status: 'processing',
          pipelinePhase: 'finalizing' as PipelinePhase,
          tasks: statusResult.tasks ?? [],
          laneStatuses: buildLaneStatuses([], laneWorkflows),
          message: 'Finalizing your generated posts...',
        });
      }

      // We won the lock — proceed with ad creation (FAST path: use Tombstone images first)
      try {
        // Fetch full results
        const results = await getWorkflowResults(workflowIds);

        // Build SEO data from Zig's audit (or fallback to live audit)
        const seoData = await buildSeoData(results.research, results.creative, results.marketing, analysis.websiteUrl, analysisId);
        const postingPlan = buildPostingPlan(results.research, results.creative, results.marketing, analysis.websiteUrl);
        const googleAdsData = buildGoogleAds(results.research, results.creative, analysis.websiteUrl, {
          businessName: (analysis as any).businessName ?? '',
          city: analysis.businessCity ?? '',
          state: analysis.businessState ?? '',
        });
        const websiteConceptData = buildWebsiteConcept(results.research, results.creative, analysis.websiteUrl, {
          businessId: analysis.businessId ?? '',
          location: [analysis.businessCity, analysis.businessState].filter(Boolean).join(', '),
          industry: results.research?.business_summary?.category ?? '',
        });
        const budgetData = buildBudgetRecommendations(results.research, analysis.websiteUrl);

        // Build reverse map: workflowId → lane name
        const wfToLane: Record<string, string> = {};
        for (const [lane, wfIdOrArr] of Object.entries(laneWorkflows)) {
          if (Array.isArray(wfIdOrArr)) {
            for (const wfId of wfIdOrArr) wfToLane[wfId] = lane;
          } else if (wfIdOrArr) {
            wfToLane[wfIdOrArr] = lane;
          }
        }

        // Create ad records IMMEDIATELY with Tombstone images (fast — no GPT-5.1 blocking)
        // Uses idempotent creation to prevent duplicates from concurrent polls
        let createdCount = 0;
        let skippedCount = 0;
        for (const ad of results.ads) {
          let imageKey = ad?.imageUrl ?? null;
          if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
            try {
              const parsed = new URL(imageKey);
              let path = parsed.pathname.replace(/^\/+/, '');
              if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
              imageKey = path;
            } catch {}
          }
          const { created } = await createAdIdempotent({
            analysisId: analysis.id,
            imageUrl: imageKey,
            caption: ad?.caption ?? '',
            headline: ad?.headline ?? 'Ad',
            watermarked: true,
            lane: wfToLane[ad?.workflowId] ?? null,
          });
          if (created) createdCount++; else skippedCount++;
        }
        console.log(`[mission-status] Completion: created ${createdCount} ads, skipped ${skippedCount} duplicates`);

        await prisma.analysis.update({
          where: { id: analysisId },
          data: {
            status: 'completed',
            results: { ...results as any, googleAds: googleAdsData, websiteConcept: websiteConceptData, budget: budgetData } as any,
            seoData: seoData as any,
            postingPlan: postingPlan as any,
          },
        });

        const updatedAnalysis = await prisma.analysis.findUnique({
          where: { id: analysisId },
          include: { ads: true },
        });

        // Resolve fresh presigned URLs for ads just stored
        const freshAds = await resolveAdImages(updatedAnalysis?.ads ?? []);

        // Fire-and-forget: upgrade Tombstone images to GPT-5.1 in background
        const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
        console.log(`[mission-status] Firing background GPT-5.1 upgrade for analysisId=${analysisId}`);
        fetch(`${baseUrl}/api/upgrade-ad-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId }),
        }).catch((err) => {
          console.error('[mission-status] Failed to trigger image upgrade:', err?.message);
        });

        // Check social workflow progress (runs in parallel with ads)
        let socialStatus = 'pending';
        if (analysis.socialMissionId) {
          const socialWorkflowIds = analysis.socialMissionId.split(',').filter(Boolean);
          try {
            const socialResult = await getSocialWorkflowResults(socialWorkflowIds);
            socialStatus = socialResult.status;

            if (socialResult.status === 'completed' && socialResult.posts.length > 0) {
              // Store Tombstone-generated social posts
              const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
              for (const post of socialResult.posts) {
                await prisma.socialPost.create({
                  data: {
                    userId: analysis.userId!,
                    analysisId: analysis.id,
                    caption: post.caption || '',
                    hashtags: post.hashtags || [],
                    imageUrl: post.imageUrl || null,
                    imagePrompt: post.imagePrompt || null,
                    sourceType: post.sourceType || null,
                    newsAngle: post.newsAngle || null,
                    platforms: post.platforms || ALL_PLATFORMS,
                    postType: post.postType || 'general',
                    status: 'pending_approval',
                    tradeAreaZip: analysis.businessZip || null,
                    patternType: post.patternType || null,
                    rssItemTitle: post.rssItemTitle || null,
                    rssItemLink: post.rssItemLink || null,
                  },
                });
              }
              console.log(`[mission-status] Stored ${socialResult.posts.length} social posts from Tombstone`);
            }
          } catch (err: any) {
            console.error('[mission-status] Social workflow check failed:', err?.message);
          }
        }

        // Check if we actually have ads
        const hasUsableAdsLegacy = (freshAds?.length ?? 0) > 0;
        if (!hasUsableAdsLegacy) {
          console.warn(`[mission-status] Legacy completion created 0 ads from ${workflowIds.length} workflows — output_hydration_failed`);
          await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'processing' } });
          return NextResponse.json({
            status: 'processing',
            pipelinePhase: 'finalizing' as PipelinePhase,
            tasks: statusResult.tasks ?? [],
            laneStatuses: buildLaneStatuses([], laneWorkflows),
            message: 'Finalizing your generated posts...',
            diagnostics: {
              analysisId, businessId: analysis.businessId,
              workflowIds, adCount: 0, issue: 'output_hydration_failed',
            },
          });
        }

        return NextResponse.json({
          status: 'completed',
          pipelinePhase: 'completed' as PipelinePhase,
          ads: freshAds,
          seoData,
          postingPlan,
          googleAdsData,
          websiteConceptData,
          budgetData,
          socialStatus,
          laneWorkflows,
          laneStatuses: buildLaneStatuses(freshAds, laneWorkflows),
          tasks: statusResult.tasks ?? [],
        });
      } catch (err: any) {
        // If completion fails, reset status so it can be retried
        console.error('[mission-status] Completion failed, resetting status:', err?.message);
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: 'processing' },
        });
        return NextResponse.json({
          status: 'processing',
          pipelinePhase: 'finalizing' as PipelinePhase,
          tasks: statusResult.tasks ?? [],
          laneStatuses: buildLaneStatuses([], laneWorkflows),
          message: 'Finalizing your generated posts...',
          diagnostics: {
            analysisId, businessId: analysis.businessId,
            issue: 'completion_exception', error: err?.message,
          },
        });
      }
    }

    // Determine if this is a partial success: some lanes completed, some failed
    const completedWfSetForStatus = new Set(statusResult.completedWorkflows ?? []);
    const hasCompletedLanes = completedWfSetForStatus.size > 0;
    const isPartialSuccess = overallStatus === 'error' && hasCompletedLanes && Object.keys(laneWorkflows).length > 0;

    // Update status in DB if changed (never overwrite 'completing' or 'completed')
    // Partial success: treat as 'completed' with partial results rather than 'error'
    let mappedStatus: string;
    if (isPartialSuccess) {
      mappedStatus = 'completed';
    } else {
      mappedStatus = overallStatus === 'error' ? 'error' : overallStatus === 'generating' ? 'generating' : 'processing';
    }

    // Extract error reason and failed lane names from failed tasks
    let errorReason: string | null = null;
    const failedLanes: string[] = [];
    if (overallStatus === 'error') {
      // Build reverse map for lane name lookup
      const wfToLaneName: Record<string, string> = {};
      for (const [lane, wfIdOrArr] of Object.entries(laneWorkflows)) {
        if (Array.isArray(wfIdOrArr)) {
          for (const wfId of wfIdOrArr) wfToLaneName[wfId] = lane;
        } else if (wfIdOrArr) {
          wfToLaneName[wfIdOrArr] = lane;
        }
      }
      // Identify which lanes failed
      for (const [wfId, laneName] of Object.entries(wfToLaneName)) {
        if (!completedWfSetForStatus.has(wfId)) {
          const wfTasks = (statusResult.tasks ?? []).filter((t: any) => t.workflowId === wfId);
          const hasFailed = wfTasks.some((t: any) => t.status === 'error');
          if (hasFailed && !failedLanes.includes(laneName)) failedLanes.push(laneName);
        }
      }

      if (!isPartialSuccess) {
        const failedTask = (statusResult.tasks ?? []).find((t: any) => t.status === 'error' && t.lastError);
        if (failedTask?.lastError) {
          const raw = failedTask.lastError as string;
          if (raw.includes('terms violation')) {
            errorReason = 'This website could not be analyzed. It may be too large or have access restrictions. Please try a different URL.';
          } else if (raw.includes('timeout') || raw.includes('Timeout')) {
            errorReason = 'The website took too long to respond. Please try again.';
          } else {
            errorReason = 'Post generation encountered an issue. Please try again.';
          }
          console.log(`[mission-status] Error reason: ${raw}`);
        }
      } else {
        console.log(`[mission-status] Partial success: ${completedWfSetForStatus.size} lanes completed, ${failedLanes.length} failed (${failedLanes.join(', ')})`);
      }
    }

    // ── Partial success: run completion path for completed lanes only ──
    if (isPartialSuccess && analysis.status !== 'completing' && analysis.status !== 'completed') {
      const completedWfIds = Array.from(completedWfSetForStatus);
      console.log(`[mission-status] Running partial-success completion for ${completedWfIds.length} workflows`);

      const lockResult = await prisma.analysis.updateMany({
        where: { id: analysisId, status: { notIn: ['completed', 'completing'] } },
        data: { status: 'completing' },
      });

      if (lockResult.count > 0) {
        try {
          const results = await getWorkflowResults(completedWfIds);
          const seoData = await buildSeoData(results.research, results.creative, results.marketing, analysis.websiteUrl, analysisId);
          const postingPlan = buildPostingPlan(results.research, results.creative, results.marketing, analysis.websiteUrl);
          const googleAdsData = buildGoogleAds(results.research, results.creative, analysis.websiteUrl, {
            businessName: (analysis as any).businessName ?? '',
            city: analysis.businessCity ?? '',
            state: analysis.businessState ?? '',
          });
          const websiteConceptData = buildWebsiteConcept(results.research, results.creative, analysis.websiteUrl, {
            businessId: analysis.businessId ?? '',
            location: [analysis.businessCity, analysis.businessState].filter(Boolean).join(', '),
            industry: results.research?.business_summary?.category ?? '',
          });
          const budgetData = buildBudgetRecommendations(results.research, analysis.websiteUrl);

          const wfToLane: Record<string, string> = {};
          for (const [lane, wfIdOrArr] of Object.entries(laneWorkflows)) {
            if (Array.isArray(wfIdOrArr)) {
              for (const wfId of wfIdOrArr) wfToLane[wfId] = lane;
            } else if (wfIdOrArr) {
              wfToLane[wfIdOrArr] = lane;
            }
          }

          // Idempotent ad creation for partial-success path
          for (const ad of results.ads) {
            let imageKey = ad?.imageUrl ?? null;
            if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
              try {
                const parsed = new URL(imageKey);
                let path = parsed.pathname.replace(/^\/+/, '');
                if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
                imageKey = path;
              } catch {}
            }
            await createAdIdempotent({
              analysisId: analysis.id,
              imageUrl: imageKey,
              caption: ad?.caption ?? '',
              headline: ad?.headline ?? 'Ad',
              watermarked: true,
              lane: wfToLane[ad?.workflowId] ?? null,
            });
          }

          await prisma.analysis.update({
            where: { id: analysisId },
            data: {
              status: 'completed',
              results: { ...results as any, googleAds: googleAdsData, websiteConcept: websiteConceptData, budget: budgetData } as any,
              seoData: seoData as any,
              postingPlan: postingPlan as any,
            },
          });

          const updatedAnalysis = await prisma.analysis.findUnique({
            where: { id: analysisId },
            include: { ads: true },
          });
          const freshAds = await resolveAdImages(updatedAnalysis?.ads ?? []);

          // Fire background image upgrade
          const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
          fetch(`${baseUrl}/api/upgrade-ad-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisId }),
          }).catch(() => {});

          return NextResponse.json({
            status: 'completed',
            pipelinePhase: (failedLanes.length > 0 ? 'completed_with_warnings' : 'completed') as PipelinePhase,
            ads: freshAds,
            seoData,
            postingPlan,
            googleAdsData,
            websiteConceptData,
            budgetData,
            laneWorkflows,
            laneStatuses: buildLaneStatuses(freshAds, laneWorkflows, undefined, failedLanes),
            failedLanes,
            tasks: statusResult.tasks ?? [],
          });
        } catch (err: any) {
          console.error('[mission-status] Partial-success completion failed:', err?.message);
          await prisma.analysis.update({
            where: { id: analysisId },
            data: { status: 'processing' },
          });
        }
      }
    }

    // Update status in DB if not already handled by partial success
    if (!isPartialSuccess && analysis.status !== mappedStatus && analysis.status !== 'completing' && analysis.status !== 'completed') {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: mappedStatus },
      });
    }

    // ── Progressive lane results: show completed lane ads while others still generate ──
    let partialAds: any[] = [];
    const completedWfSet = new Set(statusResult.completedWorkflows ?? []);
    if (completedWfSet.size > 0 && Object.keys(laneWorkflows).length > 0) {
      // Fresh DB query for existing lanes — stale analysis.ads from top of function
      // would miss ads created by concurrent poll requests
      const freshExistingAds = await prisma.ad.findMany({
        where: { analysisId: analysis.id },
        select: { id: true, lane: true },
      });
      const existingLanes = new Set(freshExistingAds.map((a: any) => a.lane).filter(Boolean));

      // Build reverse map: workflowId → lane
      const wfToLane: Record<string, string> = {};
      for (const [lane, wfIdOrArr] of Object.entries(laneWorkflows)) {
        if (Array.isArray(wfIdOrArr)) {
          for (const wfId of wfIdOrArr) wfToLane[wfId] = lane;
        } else if (wfIdOrArr) {
          wfToLane[wfIdOrArr as string] = lane;
        }
      }

      // Find newly completed lanes (workflow done + no ads stored for that lane yet)
      const newlyCompletedLaneWfs: string[] = [];
      for (const wfId of completedWfSet) {
        const lane = wfToLane[wfId];
        if (lane && !existingLanes.has(lane)) {
          newlyCompletedLaneWfs.push(wfId);
        }
      }

      if (newlyCompletedLaneWfs.length > 0) {
        console.log(`[mission-status] Progressive: ${newlyCompletedLaneWfs.length} lanes newly completed, extracting ads`);
        try {
          const partialResults = await getWorkflowResults(newlyCompletedLaneWfs);
          for (const ad of partialResults.ads) {
            let imageKey = ad?.imageUrl ?? null;
            if (imageKey && imageKey.startsWith('http') && !imageKey.includes('.s3.')) {
              try {
                const parsed = new URL(imageKey);
                let path = parsed.pathname.replace(/^\/+/, '');
                if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
                imageKey = path;
              } catch {}
            }
            const { created, ad: createdAd } = await createAdIdempotent({
              analysisId: analysis.id,
              imageUrl: imageKey,
              caption: ad?.caption ?? '',
              headline: ad?.headline ?? 'Ad',
              watermarked: true,
              lane: wfToLane[ad?.workflowId] ?? null,
            });
            if (created) partialAds.push(createdAd);
          }
          if (partialAds.length > 0) {
            console.log(`[mission-status] Progressive: stored ${partialAds.length} early ads for lanes: ${newlyCompletedLaneWfs.map(w => wfToLane[w]).join(', ')}`);
            // Fire background image upgrade for the early ads
            const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
            fetch(`${baseUrl}/api/upgrade-ad-images`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ analysisId }),
            }).catch(() => {});
          }
        } catch (err: any) {
          console.error('[mission-status] Progressive ad extraction error:', err?.message);
        }
      }

      // Return all stored ads (fresh query to include both old and newly created)
      if (freshExistingAds.length > 0 || partialAds.length > 0) {
        const allAds = await prisma.ad.findMany({ where: { analysisId: analysis.id } });
        partialAds = await resolveAdImages(allAds);
      }
    }

    // Determine pipeline phase for non-completed statuses
    const legacyPhase: PipelinePhase = mappedStatus === 'error'
      ? 'failed'
      : (statusResult.tasks ?? []).length > 0 ? 'generating' : 'pipeline_preparing';

    return NextResponse.json({
      status: mappedStatus,
      pipelinePhase: legacyPhase,
      tasks: statusResult.tasks ?? [],
      laneWorkflows,
      laneStatuses: buildLaneStatuses(partialAds, laneWorkflows, undefined, failedLanes),
      ...(partialAds.length > 0 ? { ads: partialAds } : {}),
      ...(errorReason ? { errorReason } : {}),
      ...(failedLanes.length > 0 ? { failedLanes } : {}),
    });
  } catch (err: any) {
    console.error('Mission status error:', err);
    return NextResponse.json({ error: 'Failed to check status', tasks: [] }, { status: 500 });
  }
}

/**
 * Build SEO data from Zig's pipeline audit (preferred) or fallback to live audit.
 */
async function buildSeoData(research: any, creative: any, marketing: any, websiteUrl: string, analysisId?: string) {
  // Prefer Zig's SEO audit from the pipeline (already ran in parallel with creative)
  let audit = marketing?.audit ?? null;
  let auditHtml = '';
  if (audit) {
    console.log(`[seo-audit] Using Zig pipeline audit: score=${audit.score} grade=${audit.grade}`);
  } else {
    // Fallback: run live SEO audit (adds latency at completion time)
    try {
      audit = await runSeoAudit(websiteUrl);
      console.log(`[seo-audit] Fallback live audit ${websiteUrl}: score=${audit.score} grade=${audit.grade}`);
    } catch (err: any) {
      console.error('[seo-audit] Error:', err?.message);
    }
  }

  // --- Address extraction ---
  // Try to fetch HTML for address extraction (reuse if audit already has it)
  let location: ExtractedAddress | null = null;
  try {
    const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(baseUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'AdLaunch-SEO-Audit/1.0' },
        cache: 'no-store',
      });
      auditHtml = await res.text().catch(() => '');
    } finally {
      clearTimeout(timer);
    }
    if (auditHtml) {
      location = extractBusinessAddress(auditHtml);
      console.log(`[address-extractor] source=${location.source} confidence=${location.confidence} city=${location.city} state=${location.state} zip=${location.zip}`);
    }
  } catch (err: any) {
    console.error('[address-extractor] Fetch error:', err?.message);
  }

  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const constraints = research?.messaging_constraints ?? {};
  const geoString = biz?.geo ?? '';

  // Merge: HTML extraction wins, research pipeline geo is fallback
  if ((!location || location.source === 'none') && geoString) {
    const parsed = parseGeoString(geoString);
    if (parsed.state) {
      location = {
        businessName: biz?.name ?? '',
        address: '',
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        phone: '',
        source: 'none', // will be recorded as 'research_pipeline' in DB
        confidence: 0.3,
      };
      console.log(`[address-extractor] Using research pipeline geo: "${geoString}" → city=${parsed.city} state=${parsed.state}`);
    }
  }

  // Store extracted location in Analysis record
  if (analysisId && location && location.source !== 'none') {
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          businessName: location.businessName || biz?.name || null,
          businessAddr: location.address || null,
          businessCity: location.city || null,
          businessState: location.state || null,
          businessZip: location.zip || null,
          businessPhone: location.phone || null,
          geoSource: location.source,
          geoConfirmed: false,
        },
      });
      console.log(`[address-extractor] Saved to Analysis ${analysisId}`);
    } catch (err: any) {
      console.error('[address-extractor] DB save error:', err?.message);
    }
  } else if (analysisId && geoString) {
    // Even if extraction failed, save the raw geo from research pipeline
    const parsed = parseGeoString(geoString);
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          businessName: biz?.name || null,
          businessCity: parsed.city || null,
          businessState: parsed.state || null,
          businessZip: parsed.zip || null,
          geoSource: 'research_pipeline',
          geoConfirmed: false,
        },
      });
    } catch (err: any) {
      console.error('[address-extractor] DB fallback save error:', err?.message);
    }
  }

  return {
    businessName: biz?.name || 'Your Business',
    industry: biz?.category && biz.category.toLowerCase() !== 'unknown' ? biz.category : 'local business',
    coreOffer: biz?.core_offer ?? '',
    targetCustomer: biz?.target_customer ?? '',
    products: biz?.products ?? [],
    geo: geoString,
    location: location ? {
      address: location.address,
      city: location.city,
      state: location.state,
      zip: location.zip,
      phone: location.phone,
      source: location.source,
      confidence: location.confidence,
      confirmed: false,
    } : null,
    brandVoice: {
      tone: voice?.tone ?? '',
      style: voice?.style ?? '',
    },
    keyTopics: constraints?.allowed_topics ?? [],
    avoidTopics: constraints?.forbidden_topics ?? [],
    websiteUrl,
    audit, // <-- Full SEO audit with score 0-100, grade, and items
    recommendations: audit?.items
      ?.filter((i: any) => i.status === 'fail' || i.status === 'warn')
      .map((i: any) => `${i.status === 'fail' ? '🔴' : '🟡'} ${i.label}: ${i.detail}`) ?? [],
  };
}

// getUpcomingEvents is imported from @/lib/social/upcoming-events

/**
 * Build a 90-day posting plan from research data with calendar-aware events.
 */
function buildPostingPlan(research: any, creative: any, marketing?: any, websiteUrl?: string) {
  // Extract business info from research, marketing content, or creative — whichever is available
  const biz = research?.business_summary ?? {};
  const topics = research?.messaging_constraints?.allowed_topics ?? [];

  // Fallback: try to extract a business name from marketing content or website URL
  let businessName = biz?.name ?? '';
  let coreOffer = biz?.core_offer ?? '';
  let targetCustomer = biz?.target_customer ?? '';

  if (!businessName && marketing?.content) {
    // Try to extract from marketing content header (e.g. "3 Minimal Facebook Ad Concepts for SimNet Wireless")
    const headerMatch = marketing.content.match(/(?:for|For)\s+([A-Z][A-Za-z0-9\s&'.-]+?)(?:\n|$)/);
    if (headerMatch) businessName = headerMatch[1].trim();
  }
  if (!businessName && websiteUrl) {
    try {
      const host = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '');
      businessName = host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
    } catch { /* ignore */ }
  }
  if (!businessName) businessName = 'Your Business';

  // Fallback: extract topics from creative ads headlines/captions
  if (topics.length === 0 && creative?.ads?.length) {
    for (const ad of creative.ads) {
      if (ad?.headline) topics.push(ad.headline);
    }
  }

  if (!coreOffer) coreOffer = 'your products/services';
  if (!targetCustomer) targetCustomer = 'your target audience';

  const upcomingEvents = getUpcomingEvents();
  const phase1Events = upcomingEvents.filter(e => e.week <= 4);
  const phase2Events = upcomingEvents.filter(e => e.week > 4 && e.week <= 8);
  const phase3Events = upcomingEvents.filter(e => e.week > 8 && e.week <= 12);

  function buildEventScheduleItems(events: typeof upcomingEvents) {
    return events.map(e => ({
      day: e.date,
      type: '\u{1F389} ' + e.name,
      example: e.ideas,
    }));
  }

  return {
    businessName,
    overview: `A strategic 90-day social media plan for ${businessName} targeting ${targetCustomer}. This plan builds awareness, drives engagement, and converts followers into customers \u2014 with upcoming holidays and events built in for timely content.`,
    upcomingEvents: upcomingEvents.slice(0, 10),
    phases: [
      {
        name: 'Phase 1: Foundation & Awareness',
        weeks: 'Weeks 1-4',
        goal: 'Establish brand presence and build initial audience',
        frequency: '4 posts per week',
        contentMix: [
          { type: 'Brand Story', percent: 30, description: `Introduce ${businessName} \u2014 who you are, what you do, and why you do it` },
          { type: 'Value Posts', percent: 40, description: `Educational content about ${coreOffer} that solves problems for ${targetCustomer}` },
          { type: 'Social Proof', percent: 20, description: 'Customer testimonials, reviews, and success stories' },
          { type: 'Behind the Scenes', percent: 10, description: 'Team photos, process videos, day-in-the-life content' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Value Post', example: topics[0] ? `Tip: ${topics[0]}` : 'Educational tip related to your industry' },
          { day: 'Wednesday', type: 'Brand Story', example: `Why ${businessName} exists and the problem we solve` },
          { day: 'Friday', type: 'Social Proof', example: 'Customer spotlight or testimonial' },
          { day: 'Saturday', type: 'Engagement', example: 'Poll, question, or community-building post' },
          ...buildEventScheduleItems(phase1Events),
        ],
      },
      {
        name: 'Phase 2: Engagement & Authority',
        weeks: 'Weeks 5-8',
        goal: 'Deepen relationships and establish expertise',
        frequency: '5 posts per week',
        contentMix: [
          { type: 'Educational Content', percent: 35, description: `Deep dives on ${coreOffer} \u2014 how-tos, guides, comparisons` },
          { type: 'Customer Stories', percent: 25, description: 'Detailed case studies and transformation stories' },
          { type: 'Promotional', percent: 20, description: 'Product features, limited offers, and clear CTAs' },
          { type: 'Interactive', percent: 20, description: 'Q&A sessions, polls, live videos, community engagement' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Educational', example: topics[1] ? `Guide: ${topics[1]}` : 'How-to guide' },
          { day: 'Tuesday', type: 'Customer Story', example: 'Before/after or success story' },
          { day: 'Wednesday', type: 'Promotional', example: `Feature spotlight: ${coreOffer}` },
          { day: 'Friday', type: 'Interactive', example: 'Q&A or poll about industry topic' },
          { day: 'Saturday', type: 'Behind Scenes', example: 'Team or process spotlight' },
          ...buildEventScheduleItems(phase2Events),
        ],
      },
      {
        name: 'Phase 3: Conversion & Scale',
        weeks: 'Weeks 9-12',
        goal: 'Drive sales and scale what works',
        frequency: '5-6 posts per week',
        contentMix: [
          { type: 'Conversion Posts', percent: 35, description: 'Direct offers, urgency-driven CTAs, limited-time deals' },
          { type: 'Social Proof', percent: 25, description: 'Reviews, UGC, metrics, and results showcases' },
          { type: 'Retargeting Content', percent: 20, description: 'Objection-handling, FAQ posts, comparison content' },
          { type: 'Community', percent: 20, description: 'User-generated content, celebrations, milestone posts' },
        ],
        weeklySchedule: [
          { day: 'Monday', type: 'Social Proof', example: 'Customer review or result metrics' },
          { day: 'Tuesday', type: 'Conversion', example: `Special offer for ${coreOffer}` },
          { day: 'Wednesday', type: 'Retargeting', example: 'Addressing common objections or FAQs' },
          { day: 'Thursday', type: 'Educational', example: topics[2] ? `Pro tip: ${topics[2]}` : 'Expert insight' },
          { day: 'Friday', type: 'Conversion', example: 'Weekend special or limited-time CTA' },
          { day: 'Saturday', type: 'Community', example: 'Customer spotlight or milestone celebration' },
          ...buildEventScheduleItems(phase3Events),
        ],
      },
    ],
    kpis: [
      { metric: 'Follower Growth', target: '+25-40% over 90 days', description: 'Organic audience building' },
      { metric: 'Engagement Rate', target: '3-6% per post', description: 'Likes, comments, shares' },
      { metric: 'Click-Through Rate', target: '1.5-3%', description: 'Traffic to website from posts' },
      { metric: 'Lead Generation', target: '10-30 qualified leads/month', description: 'From social to pipeline' },
      { metric: 'Conversion Rate', target: '2-5% of social traffic', description: 'Social visitors who become customers' },
    ],
    ctaMessage: `Ready to execute this plan? Our team can manage your entire social media presence \u2014 content creation, scheduling, community management, and performance reporting \u2014 so you can focus on running ${businessName}.`,
  };
}


/**
 * Truncate text to fit within a character limit at a word boundary.
 * Spaces count as characters (Google Ads counts all characters including spaces).
 * Never cuts mid-word — trims to the last complete word that fits.
 */
function fitToCharLimit(text: string, maxChars: number): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  // Find the last space at or before maxChars
  const truncated = trimmed.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace <= 0) {
    // Single long word — just truncate (rare edge case)
    return truncated;
  }
  return truncated.slice(0, lastSpace).trim();
}

function buildGoogleAds(research: any, creative: any, websiteUrl: string, extra?: { businessName?: string; city?: string; state?: string }) {
  const biz = research?.business_summary ?? {};
  const constraints = research?.messaging_constraints ?? {};
  const ads = creative?.ads ?? [];

  const H_MAX = 30;
  const D_MAX = 90;

  // ── Placeholder detection ─────────────────────────────────────────
  const POISON_WORDS = ['unknown', 'undefined', 'null', 'none', 'n/a', '[placeholder]', 'your business'];
  const isPoisoned = (s: string | undefined | null): boolean => {
    if (!s) return true;
    const lower = s.trim().toLowerCase();
    if (!lower) return true;
    return POISON_WORDS.some(p => lower === p || lower.includes(p));
  };

  // ── Resolve business name (strip page-title junk) ─────────────────
  const cleanPageTitle = (raw: string): string => {
    if (!raw) return '';
    // Strip common prefixes: "Home - ", "Welcome to ", "Home | "
    let cleaned = raw.replace(/^(home\s*[-–|:]\s*)/i, '').trim();
    cleaned = cleaned.replace(/^(welcome\s+to\s+)/i, '').trim();
    // Strip trailing " | Page Name" or " - Page Name"
    cleaned = cleaned.replace(/\s*[|–-]\s*(home|about|contact|services).*$/i, '').trim();
    return cleaned;
  };

  let businessName = '';
  // Priority: analysis record > research summary > page title cleanup
  if (extra?.businessName && !isPoisoned(extra.businessName)) {
    businessName = extra.businessName;
  } else if (biz?.name && !isPoisoned(biz.name)) {
    businessName = cleanPageTitle(biz.name);
  }
  if (!businessName) {
    // Last resort: derive from domain
    try {
      const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      const host = parsed.hostname.replace(/^www\./, '').replace(/\.(com|net|org|co|io|biz|us|shop)$/i, '');
      businessName = host.charAt(0).toUpperCase() + host.slice(1);
    } catch {
      businessName = 'Our Business';
    }
  }
  console.log(`[buildGoogleAds] resolved businessName="${businessName}" (source: ${extra?.businessName ? 'analysis' : biz?.name ? 'research' : 'domain'})`);

  // ── Resolve category (NEVER use "Unknown") ────────────────────────
  const inferCategoryFromName = (name: string, domain: string): string => {
    const combined = `${name} ${domain}`.toLowerCase();
    const categoryMap: [RegExp, string][] = [
      [/pretzel|bake|bakery|bread|dough/, 'pretzel bakery'],
      [/pizza|pie|slice/, 'pizza restaurant'],
      [/internet|isp|broadband|fiber|wireless|hog/, 'internet service provider'],
      [/turf|lawn|landscape|mow|grass|yard/, 'landscaping & lawn care'],
      [/plumb/, 'plumbing services'],
      [/hvac|heat|cool|air\s*condition/, 'HVAC services'],
      [/roofing|roof/, 'roofing services'],
      [/electric/, 'electrical services'],
      [/dental|dentist/, 'dental practice'],
      [/auto|car|mechanic|tire/, 'auto services'],
      [/restaurant|diner|grill|cafe|coffee|bar|tavern|pub/, 'restaurant'],
      [/salon|barber|hair|beauty|spa/, 'salon & beauty'],
      [/fitness|gym|workout|yoga|crossfit/, 'fitness center'],
      [/real\s*estate|realtor|realty|property/, 'real estate'],
      [/insurance|insure/, 'insurance services'],
      [/law|legal|attorney/, 'legal services'],
      [/clean|maid|janitorial/, 'cleaning services'],
      [/pet|vet|veterinary|grooming/, 'pet services'],
      [/photo|video|media/, 'photography & media'],
      [/market|advertis|agency|creative/, 'marketing agency'],
    ];
    for (const [rx, cat] of categoryMap) {
      if (rx.test(combined)) return cat;
    }
    return '';
  };

  let category = '';
  if (biz?.category && !isPoisoned(biz.category)) {
    category = biz.category;
  }
  if (!category) {
    category = inferCategoryFromName(businessName, websiteUrl);
  }
  if (!category) {
    // Try products/services
    const products = biz?.products ?? [];
    if (products.length > 0) {
      const firstProduct = typeof products[0] === 'string' ? products[0] : products[0]?.name ?? '';
      if (firstProduct && !isPoisoned(firstProduct)) category = firstProduct;
    }
  }
  if (!category) category = 'local business';
  console.log(`[buildGoogleAds] resolved category="${category}"`);

  // ── Resolve other fields ──────────────────────────────────────────
  let coreOffer = (biz?.core_offer && !isPoisoned(biz.core_offer)) ? biz.core_offer : '';
  if (!coreOffer) coreOffer = category;

  let targetCustomer = (biz?.target_customer && !isPoisoned(biz.target_customer)) ? biz.target_customer : '';

  const geo = [extra?.city, extra?.state].filter(Boolean).join(', ') || biz?.geo || '';

  // ── Display URL ───────────────────────────────────────────────────
  let displayUrl = websiteUrl;
  try {
    const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    displayUrl = parsed.hostname.replace(/^www\./, '');
  } catch { /* keep as-is */ }

  console.log(`[buildGoogleAds] coreOffer="${coreOffer}" targetCustomer="${targetCustomer}" geo="${geo}" displayUrl="${displayUrl}"`);

  // ── Sanitize a single ad copy string ──────────────────────────────
  const sanitize = (s: string): string | null => {
    if (!s || !s.trim()) return null;
    let cleaned = s.trim();
    // Fix double spaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    // Fix empty template fragments: "for ." "offers for ." "for customers."
    cleaned = cleaned.replace(/\bfor\s*\./g, '.').replace(/\boffers\s+for\s*\./g, '.').trim();
    // Remove trailing prepositions (incomplete sentences)
    cleaned = cleaned.replace(/\s+(with|for|and|the|to|in|of|at|by|from|on|or|a|an)\s*$/i, '').trim();
    // Check for poison words
    if (isPoisoned(cleaned)) return null;
    return cleaned;
  };

  // ── Validate a headline ───────────────────────────────────────────
  const isValidHeadline = (h: string | null): h is string => {
    if (!h) return false;
    if (h.length < 8) return false;  // too short
    if (h.length > H_MAX) return false;
    if (isPoisoned(h)) return false;
    return true;
  };

  // ── Validate a description ────────────────────────────────────────
  const isValidDescription = (d: string | null): d is string => {
    if (!d) return false;
    if (d.length < 30) return false;  // too short for a useful description
    if (d.length > D_MAX) return false;
    if (isPoisoned(d)) return false;
    // Check for incomplete endings
    const lastWord = d.split(/\s+/).pop()?.toLowerCase() ?? '';
    if (['with', 'for', 'and', 'the', 'to', 'in', 'of', 'a', 'an'].includes(lastWord)) return false;
    return true;
  };

  // ── Build headlines ───────────────────────────────────────────────
  const rawHeadlines: (string | null)[] = [];

  // From upstream creative
  for (const ad of ads.slice(0, 3)) {
    if (ad?.headline) rawHeadlines.push(sanitize(fitToCharLimit(cleanPageTitle(ad.headline), H_MAX)));
  }

  // Template headlines (only if fields are clean)
  rawHeadlines.push(sanitize(fitToCharLimit(`${businessName} | ${category}`, H_MAX)));
  if (geo) rawHeadlines.push(sanitize(fitToCharLimit(`Top ${category} in ${geo}`, H_MAX)));
  if (coreOffer && coreOffer !== category) rawHeadlines.push(sanitize(fitToCharLimit(`Get ${coreOffer} Today`, H_MAX)));
  rawHeadlines.push(sanitize(fitToCharLimit(`Trusted ${category}`, H_MAX)));
  rawHeadlines.push(sanitize(fitToCharLimit(`${businessName} — Learn More`, H_MAX)));
  rawHeadlines.push(sanitize(fitToCharLimit(`Quality ${category}`, H_MAX)));
  rawHeadlines.push(sanitize(fitToCharLimit(`Visit ${businessName} Today`, H_MAX)));

  const validHeadlines = [...new Set(rawHeadlines.filter(isValidHeadline))].slice(0, 6);

  // Ensure minimum 3 headlines with safe fallbacks
  const fallbackHeadlines = [
    fitToCharLimit(`${businessName}`, H_MAX),
    fitToCharLimit(`Discover ${businessName}`, H_MAX),
    fitToCharLimit(`${businessName} — Contact Us`, H_MAX),
    fitToCharLimit(`Your Local ${category}`, H_MAX),
    fitToCharLimit(`${category} You Can Trust`, H_MAX),
  ].filter(isValidHeadline);

  while (validHeadlines.length < 3 && fallbackHeadlines.length > 0) {
    const fb = fallbackHeadlines.shift()!;
    if (!validHeadlines.includes(fb)) validHeadlines.push(fb);
  }

  // ── Build descriptions ────────────────────────────────────────────
  const rawDescriptions: (string | null)[] = [];

  // From upstream creative
  for (const ad of ads.slice(0, 2)) {
    if (ad?.body_copy) rawDescriptions.push(sanitize(fitToCharLimit(ad.body_copy, D_MAX)));
  }

  // Template descriptions (only use fields that are clean)
  if (targetCustomer) {
    rawDescriptions.push(sanitize(fitToCharLimit(
      `${businessName} provides quality ${coreOffer} for ${targetCustomer}. Contact us today!`, D_MAX
    )));
  } else {
    rawDescriptions.push(sanitize(fitToCharLimit(
      `${businessName} provides quality ${coreOffer}. Contact us today!`, D_MAX
    )));
  }
  rawDescriptions.push(sanitize(fitToCharLimit(
    `Looking for a great ${category}? ${businessName} delivers quality results.`, D_MAX
  )));
  if (geo) {
    rawDescriptions.push(sanitize(fitToCharLimit(
      `${businessName} is your trusted ${category} in ${geo}. Visit us today!`, D_MAX
    )));
  }

  const validDescriptions = [...new Set(rawDescriptions.filter(isValidDescription))].slice(0, 4);

  // Ensure minimum 2 descriptions
  const fallbackDescriptions = [
    fitToCharLimit(`Visit ${businessName} for quality ${coreOffer}. See why customers trust us!`, D_MAX),
    fitToCharLimit(`Discover what makes ${businessName} the right choice. Learn more today!`, D_MAX),
    fitToCharLimit(`${businessName} offers excellent ${category} service. Get started now!`, D_MAX),
  ].filter(isValidDescription);

  while (validDescriptions.length < 2 && fallbackDescriptions.length > 0) {
    const fb = fallbackDescriptions.shift()!;
    if (!validDescriptions.includes(fb)) validDescriptions.push(fb);
  }

  // ── Build keywords ────────────────────────────────────────────────
  const rawKeywords: string[] = [];
  const allowedTopics = constraints?.allowed_topics ?? [];

  rawKeywords.push(businessName.toLowerCase());
  rawKeywords.push(category.toLowerCase());
  if (geo) rawKeywords.push(`${category} ${geo}`.toLowerCase());
  rawKeywords.push(`${category} near me`);
  rawKeywords.push(`best ${category}`);
  if (coreOffer && coreOffer !== category) rawKeywords.push(coreOffer.toLowerCase());
  for (const topic of allowedTopics.slice(0, 5)) {
    if (typeof topic === 'string' && !isPoisoned(topic)) rawKeywords.push(topic.toLowerCase());
  }
  rawKeywords.push(`local ${category}`);

  const validKeywords = [...new Set(rawKeywords)]
    .filter(kw => kw.length >= 3 && !isPoisoned(kw))
    .slice(0, 10);

  // ── Sitelinks ─────────────────────────────────────────────────────
  const sitelinks = [
    { title: 'Our Services', description: `Explore ${category} options from ${businessName}` },
    { title: 'About Us', description: `Learn why customers choose ${businessName}` },
    { title: 'Contact Us', description: 'Get in touch for a free consultation' },
    { title: 'Reviews', description: 'See what our customers say about us' },
  ];

  // ── Final quality gate: reject any item that still has poison ─────
  const finalHeadlines = validHeadlines.filter(h => !isPoisoned(h) && h.length >= 8);
  const finalDescriptions = validDescriptions.filter(d => !isPoisoned(d) && d.length >= 30);
  const finalKeywords = validKeywords.filter(kw => !isPoisoned(kw));

  const rejectedCount = (validHeadlines.length - finalHeadlines.length)
    + (validDescriptions.length - finalDescriptions.length)
    + (validKeywords.length - finalKeywords.length);
  if (rejectedCount > 0) {
    console.log(`[buildGoogleAds] quality gate rejected ${rejectedCount} item(s)`);
  }

  console.log(`[buildGoogleAds] final: ${finalHeadlines.length} headlines, ${finalDescriptions.length} descriptions, ${finalKeywords.length} keywords`);

  return {
    businessName,
    websiteUrl,
    displayUrl,
    headlines: finalHeadlines,
    descriptions: finalDescriptions,
    keywords: finalKeywords,
    sitelinks,
  };
}

/**
 * Build website concept copy from research data.
 */
function buildWebsiteConcept(research: any, creative: any, websiteUrl: string, extra?: { businessId?: string; location?: string; industry?: string }) {
  const biz = research?.business_summary ?? {};
  const voice = research?.brand_voice ?? {};
  const ads = creative?.ads ?? [];

  const businessName = biz?.name ?? 'Your Business';
  const coreOffer = biz?.core_offer ?? 'our services';
  const targetCustomer = biz?.target_customer ?? 'customers';
  const category = biz?.category ?? '';
  const products = biz?.products ?? [];
  const tone = voice?.tone ?? 'Professional and friendly';

  // Hero section
  const heroHeadline = ads[0]?.headline ?? `Welcome to ${businessName}`;
  const heroDescription = ads[0]?.body_copy
    ?? `We help ${targetCustomer} with ${coreOffer}. Experience the difference that comes from working with a team that genuinely cares about your success.`;
  const heroCta = ads[0]?.cta ?? 'Get Started Today';

  // About section
  const aboutDescription = `${businessName} is dedicated to providing exceptional ${coreOffer} for ${targetCustomer}. Our ${tone.toLowerCase()} approach ensures every client receives personalized attention and outstanding results. We believe in building lasting relationships based on trust, transparency, and tangible outcomes.`;

  // Services section
  const serviceItems = products.length > 0
    ? products.slice(0, 6).map((p: any) => typeof p === 'string' ? p : p?.name ?? '')
    : [`${category} consultation`, `Custom ${coreOffer}`, 'Ongoing support & maintenance'];

  // CTA section
  const ctaHeadline = ads[2]?.headline ?? `Ready to Get Started with ${businessName}?`;
  const ctaDescription = `Take the first step toward better ${coreOffer}. Contact us today for a free consultation and discover how ${businessName} can help ${targetCustomer} achieve their goals.`;

  const sections = [
    {
      title: 'Hero Section',
      headline: heroHeadline,
      description: heroDescription,
      cta: heroCta,
    },
    {
      title: 'About Us',
      headline: `About ${businessName}`,
      description: aboutDescription,
      cta: 'Learn More About Us',
    },
    {
      title: 'Services / Offerings',
      headline: `What We Offer`,
      description: `Explore our comprehensive range of ${category || 'services'} designed to meet your needs.`,
      items: serviceItems,
      cta: 'View All Services',
    },
    {
      title: 'Call to Action',
      headline: ctaHeadline,
      description: ctaDescription,
      cta: 'Contact Us Now',
    },
  ];

  // Suggested color palette based on brand voice
  const colorPalette = [
    { hex: '#2563EB', name: 'Primary' },
    { hex: '#1E293B', name: 'Dark' },
    { hex: '#F8FAFC', name: 'Light' },
    { hex: '#0EA5E9', name: 'Accent' },
    { hex: '#10B981', name: 'Success' },
  ];

  return {
    businessName,
    sections,
    colorPalette,
    // Extra fields for Tombstone concept-website workflow
    websiteUrl: websiteUrl || '',
    industry: extra?.industry || category || '',
    location: extra?.location || '',
    businessId: extra?.businessId || '',
  };
}

/**
 * Build budget recommendations.
 */
function buildBudgetRecommendations(research: any, websiteUrl: string) {
  const biz = research?.business_summary ?? {};
  const businessName = biz?.name ?? 'Your Business';

  return {
    businessName,
    tiers: [
      {
        name: 'Starter',
        range: '$500-$1,000/mo',
        description: 'Ideal for businesses just starting with digital advertising. Focus on brand awareness and testing.',
        expectedResults: '5K-15K impressions/mo, 100-500 clicks',
      },
      {
        name: 'Growth',
        range: '$1,000-$3,000/mo',
        description: 'For businesses ready to scale. Balanced approach with prospecting and retargeting.',
        expectedResults: '15K-50K impressions/mo, 500-2K clicks, 10-50 leads',
      },
      {
        name: 'Scale',
        range: '$3,000-$5,000+/mo',
        description: 'Full-funnel strategy with aggressive prospecting, retargeting, and conversion optimization.',
        expectedResults: '50K-150K impressions/mo, 2K-8K clicks, 50-200 leads',
      },
    ],
    allocation: [
      { category: 'Prospecting', percent: 50, description: 'Reach new potential customers with targeted ads' },
      { category: 'Retargeting', percent: 25, description: 'Re-engage website visitors who didn\'t convert' },
      { category: 'Brand Awareness', percent: 15, description: 'Build recognition and trust in your market' },
      { category: 'Local Offers', percent: 10, description: 'Promote special deals to nearby customers' },
    ],
    tips: [
      'Start with a smaller budget, test different audiences for 2-3 weeks, then scale what works.',
      'Allocate at least 10% of budget to creative testing \u2014 try different images, headlines, and CTAs.',
      'Monitor your cost-per-lead (CPL) weekly. If CPL rises above your target, pause underperforming ads.',
      'Use lookalike audiences based on your best customers for highest-quality prospecting.',
      'Schedule ads during peak hours for your audience \u2014 typically 7-9 AM and 6-9 PM local time.',
    ],
  };
}