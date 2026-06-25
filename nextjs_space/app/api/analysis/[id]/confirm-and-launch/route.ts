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
 * Body (single-location — backward-compatible):
 *   { name, address, city, state, zip, phone, placeId?, googleMapsUrl? }
 *
 * Body (multi-location — new):
 *   { name, address, city, state, zip, phone, placeId?, googleMapsUrl?,
 *     multiLocation: {
 *       hasMultipleLocations: true,
 *       primaryLocationIndex: 0,
 *       locations: [{ locationName, address1, address2?, city, state, postalCode,
 *                     county?, phone?, placeId?, googleMapsUrl?, source? }, ...]
 *     }
 *   }
 *
 * Locations (if present) are saved transactionally BEFORE the workflow launches.
 *
 * IMPORTANT: This endpoint returns immediately after saving location(s).
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
    const { name, address, city, state, zip, phone, placeId, googleMapsUrl, multiLocation, serviceAreaMode, isNationwide } = body;

    // Validate analysis exists and is in pending_location state
    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    if (analysis.status !== 'pending_location') {
      return NextResponse.json({
        success: true,
        analysisId,
        businessId: analysis.businessId,
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

    // ── Persist location(s) to Business + BusinessLocation BEFORE launching ──
    if (analysis.businessId) {
      const bName = name || analysis.businessName || '';
      const bAddr = address || analysis.businessAddr || '';
      const bCity = city || analysis.businessCity || '';
      const bState = state || analysis.businessState || '';
      const bZip = zip || analysis.businessZip || '';
      const bPhone = phone || analysis.businessPhone || '';

      // ── Multi-location path ──────────────────────────────────────
      if (multiLocation?.hasMultipleLocations && Array.isArray(multiLocation.locations) && multiLocation.locations.length > 0) {
        const incoming = multiLocation.locations as any[];
        const primaryIdx = typeof multiLocation.primaryLocationIndex === 'number'
          ? multiLocation.primaryLocationIndex
          : 0;

        // Get existing locations to determine next location_number
        const existing = await prisma.businessLocation.findMany({
          where: { businessId: analysis.businessId },
          orderBy: { locationNumber: 'asc' },
        });
        const existingByPlaceId = new Map(existing.filter(l => l.placeId).map(l => [l.placeId!, l]));
        let nextNumber = existing.length > 0 ? Math.max(...existing.map(l => l.locationNumber)) + 1 : 1;

        // Reset all isPrimary to false
        await prisma.businessLocation.updateMany({
          where: { businessId: analysis.businessId },
          data: { isPrimary: false },
        });

        const results: any[] = [];
        for (let i = 0; i < incoming.length; i++) {
          const loc = incoming[i];
          const isPrimary = i === primaryIdx;

          // Dedup by placeId if present
          const existingLoc = loc.placeId ? existingByPlaceId.get(loc.placeId) : null;

          if (existingLoc) {
            const updated = await prisma.businessLocation.update({
              where: { id: existingLoc.id },
              data: {
                locationName: loc.locationName || existingLoc.locationName,
                address1: loc.address1 || existingLoc.address1,
                address2: loc.address2 ?? existingLoc.address2,
                city: loc.city || existingLoc.city,
                state: loc.state || existingLoc.state,
                postalCode: loc.postalCode || existingLoc.postalCode,
                county: loc.county ?? existingLoc.county,
                phone: loc.phone ?? existingLoc.phone,
                googleMapsUrl: loc.googleMapsUrl ?? existingLoc.googleMapsUrl,
                isPrimary,
                isConfirmed: true,
                source: loc.source || existingLoc.source,
              },
            });
            results.push(updated);
          } else {
            const locNumber = nextNumber++;
            const created = await prisma.businessLocation.create({
              data: {
                businessId: analysis.businessId,
                locationNumber: locNumber,
                locationName: loc.locationName || null,
                address1: loc.address1 || null,
                address2: loc.address2 || null,
                city: loc.city || null,
                state: loc.state || null,
                postalCode: loc.postalCode || null,
                county: loc.county || null,
                country: loc.country || 'US',
                phone: loc.phone || null,
                placeId: loc.placeId || null,
                googleMapsUrl: loc.googleMapsUrl || null,
                source: loc.source || 'user_added',
                isPrimary,
                isConfirmed: true,
                pageSlug: generatePageSlug(loc),
              },
            });
            results.push(created);
          }
        }

        // Sync primary + hasMultipleLocations to Business record
        const primaryLoc = results.find(l => l.isPrimary) || results[0];
        await prisma.business.update({
          where: { id: analysis.businessId },
          data: {
            hasMultipleLocations: results.length > 1,
            ...(bName ? { businessName: bName } : {}),
            ...(primaryLoc ? {
              businessAddr: primaryLoc.address1 || bAddr,
              businessCity: primaryLoc.city || bCity,
              businessState: primaryLoc.state || bState,
              businessZip: primaryLoc.postalCode || bZip,
              businessPhone: primaryLoc.phone || bPhone,
            } : {}),
            // Service area mode
            ...(serviceAreaMode ? { serviceAreaMode } : {}),
            ...(typeof isNationwide === 'boolean' ? { isNationwide } : {}),
            // For national businesses, treat confirmed address as HQ
            ...(serviceAreaMode === 'national' || serviceAreaMode === 'multi_location' ? {
              hqCity: primaryLoc?.city || bCity || undefined,
              hqState: primaryLoc?.state || bState || undefined,
            } : {}),
          },
        });

        console.log(`[confirm-and-launch] ${results.length} locations saved for business ${analysis.businessId}`);

      // ── Single-location path (default / legacy) ──────────────────
      } else {
        await prisma.business.update({
          where: { id: analysis.businessId },
          data: {
            ...(bName ? { businessName: bName } : {}),
            ...(bAddr ? { businessAddr: bAddr } : {}),
            ...(bCity ? { businessCity: bCity } : {}),
            ...(bState ? { businessState: bState } : {}),
            ...(bZip ? { businessZip: bZip } : {}),
            ...(bPhone ? { businessPhone: bPhone } : {}),
            // Service area mode
            ...(serviceAreaMode ? { serviceAreaMode } : {}),
            ...(typeof isNationwide === 'boolean' ? { isNationwide } : {}),
            ...(serviceAreaMode === 'national' || serviceAreaMode === 'multi_location' ? {
              hqCity: bCity || undefined,
              hqState: bState || undefined,
            } : {}),
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
    }

    console.log(`[confirm-and-launch] Location(s) confirmed for ${analysisId}. Returning immediately, launching pipeline in background.`);

    // ── Fire-and-forget: launch Tombstone pipeline in background ──
    // Locations are already saved above — workflow can safely read them.
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
      businessId: analysis.businessId,
      status: 'processing',
    });
  } catch (err: any) {
    console.error('[confirm-and-launch] Error:', err);
    return NextResponse.json({ error: 'Failed to launch analysis' }, { status: 500 });
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function generatePageSlug(loc: any): string | null {
  const parts = [loc.city, loc.state].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
}