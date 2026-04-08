export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createMissions } from '@/lib/tombstone';

/**
 * POST /api/analysis/[id]/confirm-and-launch
 * Step 2: User confirms location, then Tombstone launches.
 * Also fires Clark Kent social scout in the background.
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

    // Fire Clark Kent social scout BEFORE Tombstone (so local news is ready when ads finish)
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    if (analysis.userId && zip) {
      console.log(`[confirm-and-launch] Firing Clark Kent for ${analysisId} (ZIP: ${zip})`);
      fetch(`${baseUrl}/api/rss/clark-kent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId,
          zip,
          _internalUserId: analysis.userId,
        }),
      }).catch((err) => {
        console.error('[confirm-and-launch] Clark Kent trigger failed:', err?.message);
      });
    }

    // Launch Tombstone ad generation
    console.log(`[confirm-and-launch] Launching Tombstone for: ${analysis.websiteUrl}`);
    const result = await createMissions(analysis.websiteUrl);
    console.log(`[confirm-and-launch] Missions created:`, {
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
