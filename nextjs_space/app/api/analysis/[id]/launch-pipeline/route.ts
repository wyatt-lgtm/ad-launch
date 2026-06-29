export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createProvisionalBusiness, TombstoneError, buildLaneCommands, createAsyncRun } from '@/lib/tombstone';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';
import { buildPreviewLightResearchContract } from '@/lib/research-tiers';

/**
 * POST /api/analysis/[id]/launch-pipeline
 * Background endpoint called by confirm-and-launch via fire-and-forget.
 * Handles the slow Tombstone provisioning + async run creation.
 * Not meant to be called directly by the frontend.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const analysisId = params.id;
  const t0 = Date.now();
  console.log(`[launch-pipeline] Starting for analysisId=${analysisId}`);

  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      console.error(`[launch-pipeline] Analysis not found: ${analysisId}`);
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // If missionId already exists, skip (idempotent)
    if (analysis.missionId) {
      console.log(`[launch-pipeline] Analysis ${analysisId} already has missionId — skipping`);
      return NextResponse.json({ success: true, skipped: true });
    }

    const businessName = analysis.businessName || analysis.websiteUrl;
    const businessCity = analysis.businessCity || '';
    const businessState = analysis.businessState || '';
    const businessZip = analysis.businessZip || '';
    const businessAddr = analysis.businessAddr || '';
    const businessPhone = analysis.businessPhone || '';

    // ── Step 1: Ensure Tombstone provisional business exists ──
    let tombstoneBusinessId: number | null = analysis.tombstoneBusinessId ?? null;
    let tombstoneBusinessUuid: string | null = analysis.tombstoneBusinessUuid ?? null;

    if (tombstoneBusinessId == null && analysis.businessId) {
      try {
        const biz = await prisma.business.findUnique({
          where: { id: analysis.businessId },
          select: { tombstoneBusinessId: true, tombstoneBusinessUuid: true },
        });
        if (biz?.tombstoneBusinessId != null) {
          tombstoneBusinessId = biz.tombstoneBusinessId;
          tombstoneBusinessUuid = biz.tombstoneBusinessUuid ?? null;
        }
      } catch (e: any) {
        console.error('[launch-pipeline] Business lookup failed (non-fatal):', e?.message);
      }
    }

    if (tombstoneBusinessId == null) {
      try {
        console.log(`[launch-pipeline] Creating provisional Tombstone business for: ${businessName}`);
        const provisional = await createProvisionalBusiness({
          businessName: businessName || analysis.websiteUrl,
          address: [businessAddr, businessCity, businessState, businessZip].filter(Boolean).join(', ') || undefined,
          website: analysis.websiteUrl,
          phone: businessPhone || undefined,
        });
        tombstoneBusinessId = provisional.businessId;
        tombstoneBusinessUuid = provisional.businessUuid;

        await prisma.analysis.update({
          where: { id: analysisId },
          data: { tombstoneBusinessId, tombstoneBusinessUuid },
        });
        if (analysis.businessId) {
          await prisma.business.update({
            where: { id: analysis.businessId },
            data: { tombstoneBusinessId, tombstoneBusinessUuid },
          }).catch((e: any) => console.error('[launch-pipeline] Business sync failed (non-fatal):', e?.message));
        }
        console.log(`[launch-pipeline] Provisional business ready: business_id=${tombstoneBusinessId} (${Date.now() - t0}ms)`);
      } catch (err: any) {
        const isTomb = err instanceof TombstoneError;
        const backendError = isTomb ? err.backendError : String(err?.message || err);
        console.error('[launch-pipeline] Provisional business creation FAILED:', backendError);
        await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'error' } }).catch(() => {});
        return NextResponse.json({ error: 'Provisional business creation failed' }, { status: 502 });
      }
    }

    // ── Step 2: Gather news + holiday context (parallel) ──
    const [newsContextResult, holidayContextResult] = await Promise.allSettled([
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
          console.error('[launch-pipeline] Failed to get local news:', err?.message);
        }
        return '';
      })(),
      (async () => {
        try {
          const events = getUpcomingEvents();
          if (events.length > 0) {
            return events.slice(0, 5).map(e => `${e.name} (${e.date}): ${e.ideas}`).join('\n');
          }
        } catch (err: any) {
          console.error('[launch-pipeline] Failed to get upcoming events:', err?.message);
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

    console.log(`[launch-pipeline] Context gathered (${Date.now() - t0}ms)`);

    // ── Step 3: Launch async multi-lane run ──
    try {
      const lanes = await buildLaneCommands(
        analysis.websiteUrl,
        businessName,
        businessCity,
        businessState,
        analysis.businessId || undefined,
        newsContext,
        holidayContext,
      );

      // Preview flow is Tier 1 (Light Research) ONLY. Send the explicit Light
      // Research contract so the backend never runs deep crawl / competitor /
      // pixel inspection / provider lookup / ongoing search intelligence for the
      // first 3 preview posts — instead of relying on a backend default.
      const researchContract = buildPreviewLightResearchContract();
      console.log(
        `[launch-pipeline] Sending Light Research contract (depth=${researchContract.research_depth}, scope=${researchContract.research_scope}, max_pages=${researchContract.max_pages}, deep_allowed=${researchContract.deep_research_allowed})`,
      );

      const asyncResult = await createAsyncRun(
        tombstoneBusinessId,
        businessName,
        analysis.websiteUrl,
        lanes,
        analysisId, // idempotency key
        researchContract,
      );

      const missionId = JSON.stringify({
        command_id: asyncResult.command_id,
        async: true,
        duplicate: asyncResult.duplicate,
      });

      await prisma.analysis.update({
        where: { id: analysisId },
        data: { missionId },
      });

      console.log(`[launch-pipeline] Async run created: command_id=${asyncResult.command_id} duplicate=${asyncResult.duplicate} total_time=${Date.now() - t0}ms`);

      return NextResponse.json({ success: true, commandId: asyncResult.command_id });
    } catch (err: any) {
      const isTomb = err instanceof TombstoneError;
      const backendError = isTomb ? err.backendError : String(err?.message || err);
      console.error('[launch-pipeline] Async run creation FAILED:', backendError);
      await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'error' } }).catch(() => {});
      return NextResponse.json({ error: 'Pipeline creation failed' }, { status: 502 });
    }
  } catch (err: any) {
    console.error('[launch-pipeline] Unexpected error:', err);
    await prisma.analysis.update({ where: { id: analysisId }, data: { status: 'error' } }).catch(() => {});
    return NextResponse.json({ error: 'Pipeline launch failed' }, { status: 500 });
  }
}
