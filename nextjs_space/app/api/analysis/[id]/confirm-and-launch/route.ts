export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createProvisionalBusiness, TombstoneError, buildLaneCommands, createAsyncRun } from '@/lib/tombstone';
import { getUpcomingEvents } from '@/lib/social/upcoming-events';
import { generateContentBrief } from '@/lib/rss/trade-area-feed';

/**
 * POST /api/analysis/[id]/confirm-and-launch
 * Step 2: User confirms location, then launches 3 lane-based missions.
 *
 * IMPORTANT: This endpoint returns immediately after saving location.
 * The Tombstone provisioning + async run creation happen in a background
 * fire-and-forget call so the user sees the workflow screen within 2-5 seconds
 * rather than waiting 30-90 seconds for Render cold starts.
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

    // Save confirmed location and set status to processing immediately
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

    // Sync confirmed location to the Business record + BusinessLocation
    if (analysis.businessId) {
      const bName = name || analysis.businessName || '';
      const bAddr = address || analysis.businessAddr || '';
      const bCity = city || analysis.businessCity || '';
      const bState = state || analysis.businessState || '';
      const bZip = zip || analysis.businessZip || '';
      const bPhone = phone || analysis.businessPhone || '';
      await prisma.business.update({
        where: { id: analysis.businessId },
        data: {
          ...(bName ? { businessName: bName } : {}),
          ...(bAddr ? { businessAddr: bAddr } : {}),
          ...(bCity ? { businessCity: bCity } : {}),
          ...(bState ? { businessState: bState } : {}),
          ...(bZip ? { businessZip: bZip } : {}),
          ...(bPhone ? { businessPhone: bPhone } : {}),
        },
      }).catch((e: any) => console.error('[confirm-and-launch] Business sync error (non-fatal):', e?.message));

      // Upsert primary BusinessLocation (location_number=1)
      try {
        await prisma.businessLocation.upsert({
          where: { businessId_locationNumber: { businessId: analysis.businessId, locationNumber: 1 } },
          update: {
            locationName: bName || undefined,
            address1: bAddr || undefined,
            city: bCity || undefined,
            state: bState || undefined,
            postalCode: bZip || undefined,
            phone: bPhone || undefined,
            placeId: placeId || undefined,
            googleMapsUrl: googleMapsUrl || undefined,
            isPrimary: true,
            isConfirmed: true,
            source: placeId ? 'google_places' : 'user_added',
          },
          create: {
            businessId: analysis.businessId,
            locationNumber: 1,
            locationName: bName || null,
            address1: bAddr || null,
            city: bCity || null,
            state: bState || null,
            postalCode: bZip || null,
            phone: bPhone || null,
            placeId: placeId || null,
            googleMapsUrl: googleMapsUrl || null,
            isPrimary: true,
            isConfirmed: true,
            source: placeId ? 'google_places' : 'user_added',
          },
        });
      } catch (locErr: any) {
        console.error('[confirm-and-launch] BusinessLocation upsert error (non-fatal):', locErr?.message);
      }
    }

    console.log(`[confirm-and-launch] Location confirmed for ${analysisId}. Returning immediately, launching pipeline in background.`);

    // ── Fire-and-forget: launch Tombstone pipeline in background ──
    // The frontend will start polling /api/mission-status immediately.
    // mission-status handles the case where missionId is not yet set.
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    fetch(`${baseUrl}/api/analysis/${analysisId}/launch-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysisId }),
    }).catch((err) => {
      console.error(`[confirm-and-launch] Background pipeline launch call failed:`, err?.message);
    });

    // Return immediately — user sees workflow screen within 2-5 seconds
    return NextResponse.json({
      success: true,
      analysisId,
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}