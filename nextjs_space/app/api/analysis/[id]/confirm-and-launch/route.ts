export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createMissions, createSocialMissions } from '@/lib/tombstone';

/**
 * POST /api/analysis/[id]/confirm-and-launch
 * Step 2: User confirms location, then:
 *   1. Clark Kent scouts local intel (RSS + events + business context)
 *   2. Scout brief is sent to Tombstone as a social content mission
 *   3. Tombstone ad generation launches in parallel
 *
 * Clark Kent is SCOUT ONLY — Tombstone's creative chain
 * (Zig → Ogilvy → Don → Andy → Claude) produces the actual posts.
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
      // Already launched — return current state
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
        status: 'processing', // Transition to processing
      },
    });

    console.log(`[confirm-and-launch] Location confirmed for ${analysisId}: ${name} in ${city}, ${state} ${zip}`);

    // ── Clark Kent Scout → Tombstone Social Mission ─────────────────
    // Fire scout + social mission in background (don't block ad launch)
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    if (analysis.userId && zip) {
      console.log(`[confirm-and-launch] Firing Clark Kent scout for ${analysisId} (ZIP: ${zip})`);

      // Run scout in background, then send brief to Tombstone
      (async () => {
        try {
          // Step 1: Clark Kent gathers intelligence
          const scoutRes = await fetch(`${baseUrl}/api/rss/clark-kent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              analysisId,
              zip,
              _internalUserId: analysis.userId,
            }),
          });

          if (!scoutRes.ok) {
            console.error(`[confirm-and-launch] Clark Kent scout failed: ${scoutRes.status}`);
            return;
          }

          const scoutData = await scoutRes.json();
          const scoutSummary = scoutData?.brief?.scoutSummary;

          if (!scoutSummary) {
            console.error('[confirm-and-launch] Clark Kent returned no scout summary');
            return;
          }

          console.log(`[confirm-and-launch] Scout brief ready (${scoutData.meta?.rssItemCount} RSS items, ${scoutData.meta?.eventCount} events)`);

          // Step 2: Send scout brief to Tombstone as social content mission
          const websiteUrl = analysis.websiteUrl;
          const socialResult = await createSocialMissions(websiteUrl, scoutSummary);

          if (socialResult.success) {
            const socialMissionId = socialResult.workflowIds.join(',');
            await prisma.analysis.update({
              where: { id: analysisId },
              data: { socialMissionId },
            });
            console.log(`[confirm-and-launch] Social mission created: ${socialMissionId} (${socialResult.allTaskIds.length} tasks)`);
          } else {
            console.error('[confirm-and-launch] Tombstone social mission creation failed');
          }
        } catch (err: any) {
          console.error('[confirm-and-launch] Scout → social pipeline error:', err?.message);
        }
      })();
    }

    // ── Launch Tombstone ad generation (parallel) ───────────────────
    console.log(`[confirm-and-launch] Launching Tombstone ads for: ${analysis.websiteUrl}`);
    const result = await createMissions(analysis.websiteUrl);
    console.log(`[confirm-and-launch] Ad missions created:`, {
      success: result.success,
      workflowIds: result.workflowIds,
      taskCount: result.allTaskIds.length,
      angles: result.angles,
    });

    if (!result.success) {
      console.error('[confirm-and-launch] Tombstone API failed');
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: 'error' },
      });
      return NextResponse.json({ error: 'Failed to start ad generation. Please try again.' }, { status: 502 });
    }

    const missionId = result.workflowIds.join(',');
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { missionId },
    });

    return NextResponse.json({
      success: true,
      analysisId,
      missionId,
      workflowCount: result.workflowIds.length,
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}
