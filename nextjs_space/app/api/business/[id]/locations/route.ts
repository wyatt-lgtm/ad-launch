export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/business/[id]/locations
 * Returns all locations for a business.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = params.id;
    const locations = await prisma.businessLocation.findMany({
      where: { businessId },
      orderBy: [{ isPrimary: 'desc' }, { locationNumber: 'asc' }],
    });

    return NextResponse.json({ locations });
  } catch (err: any) {
    console.error('[locations] GET error:', err?.message);
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 });
  }
}

/**
 * POST /api/business/[id]/locations
 * Save or replace all locations for a business (multi-location confirmation).
 *
 * Body:
 *   Single-location (backward-compatible):
 *   { selectedLocation: { name, address, city, state, zip, phone, placeId, googleMapsUrl } }
 *
 *   Multi-location:
 *   { hasMultipleLocations: true, primaryLocationIndex: 0, locations: [...] }
 *
 * Each location in the array:
 *   { locationName?, address1, address2?, city, state, postalCode, county?, country?,
 *     phone?, placeId?, googleMapsUrl?, source?, latitude?, longitude? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = params.id;
    const body = await request.json().catch(() => ({} as any));

    // Verify business exists
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // ── Single-location path (backward-compatible) ──────────────────
    if (!body.hasMultipleLocations && body.selectedLocation) {
      const loc = body.selectedLocation;
      const result = await upsertSingleLocation(businessId, loc);

      // Sync primary to Business record
      await syncPrimaryToBusiness(businessId, loc);

      return NextResponse.json({
        businessId,
        primaryLocationId: result.id,
        locations: [formatLocation(result)],
      });
    }

    // ── Multi-location path ─────────────────────────────────────────
    if (body.hasMultipleLocations && Array.isArray(body.locations)) {
      const incoming = body.locations as any[];
      if (incoming.length === 0) {
        return NextResponse.json({ error: 'At least one location is required' }, { status: 400 });
      }

      const primaryIdx = typeof body.primaryLocationIndex === 'number'
        ? body.primaryLocationIndex
        : 0;

      // Get existing locations to determine next location_number
      const existing = await prisma.businessLocation.findMany({
        where: { businessId },
        orderBy: { locationNumber: 'asc' },
      });
      const existingByPlaceId = new Map(existing.filter(l => l.placeId).map(l => [l.placeId!, l]));
      const usedNumbers = new Set(existing.map(l => l.locationNumber));
      let nextNumber = existing.length > 0 ? Math.max(...existing.map(l => l.locationNumber)) + 1 : 1;

      const results: any[] = [];
      let primaryLocationId: string | null = null;

      // First pass: reset all isPrimary to false
      await prisma.businessLocation.updateMany({
        where: { businessId },
        data: { isPrimary: false },
      });

      for (let i = 0; i < incoming.length; i++) {
        const loc = incoming[i];
        const isPrimary = i === primaryIdx;

        // Dedup by placeId if present
        const existingLoc = loc.placeId ? existingByPlaceId.get(loc.placeId) : null;

        if (existingLoc) {
          // Update existing
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
              latitude: loc.latitude ?? existingLoc.latitude,
              longitude: loc.longitude ?? existingLoc.longitude,
              isPrimary,
              isConfirmed: true,
              source: loc.source || existingLoc.source,
            },
          });
          results.push(updated);
          if (isPrimary) primaryLocationId = updated.id;
        } else {
          // Create new
          const locNumber = nextNumber++;
          const created = await prisma.businessLocation.create({
            data: {
              businessId,
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
              latitude: loc.latitude ?? null,
              longitude: loc.longitude ?? null,
              source: loc.source || 'user_added',
              isPrimary,
              isConfirmed: true,
              pageSlug: loc.pageSlug || generatePageSlug(loc),
            },
          });
          results.push(created);
          if (isPrimary) primaryLocationId = created.id;
        }
      }

      // Set hasMultipleLocations on Business
      const primaryLoc = results.find(l => l.isPrimary) || results[0];
      await prisma.business.update({
        where: { id: businessId },
        data: {
          hasMultipleLocations: results.length > 1,
          ...(primaryLoc ? {
            businessAddr: primaryLoc.address1 || business.businessAddr,
            businessCity: primaryLoc.city || business.businessCity,
            businessState: primaryLoc.state || business.businessState,
            businessZip: primaryLoc.postalCode || business.businessZip,
            businessPhone: primaryLoc.phone || business.businessPhone,
          } : {}),
        },
      });

      return NextResponse.json({
        businessId,
        primaryLocationId,
        locations: results.map(formatLocation),
      });
    }

    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  } catch (err: any) {
    console.error('[locations] POST error:', err?.message);
    return NextResponse.json({ error: 'Failed to save locations' }, { status: 500 });
  }
}

// ── Helpers ─────────────────────────────────────────────────────

async function upsertSingleLocation(businessId: string, loc: any) {
  // Find or create location_number=1
  const existing = await prisma.businessLocation.findUnique({
    where: { businessId_locationNumber: { businessId, locationNumber: 1 } },
  });

  if (existing) {
    return prisma.businessLocation.update({
      where: { id: existing.id },
      data: {
        locationName: loc.name || loc.locationName || existing.locationName,
        address1: loc.address || loc.address1 || existing.address1,
        city: loc.city || existing.city,
        state: loc.state || existing.state,
        postalCode: loc.zip || loc.postalCode || existing.postalCode,
        phone: loc.phone || existing.phone,
        placeId: loc.placeId || existing.placeId,
        googleMapsUrl: loc.googleMapsUrl || existing.googleMapsUrl,
        isPrimary: true,
        isConfirmed: true,
        source: loc.placeId ? 'google_places' : (loc.source || 'user_added'),
      },
    });
  }

  return prisma.businessLocation.create({
    data: {
      businessId,
      locationNumber: 1,
      locationName: loc.name || loc.locationName || null,
      address1: loc.address || loc.address1 || null,
      city: loc.city || null,
      state: loc.state || null,
      postalCode: loc.zip || loc.postalCode || null,
      phone: loc.phone || null,
      placeId: loc.placeId || null,
      googleMapsUrl: loc.googleMapsUrl || null,
      source: loc.placeId ? 'google_places' : (loc.source || 'user_added'),
      isPrimary: true,
      isConfirmed: true,
    },
  });
}

async function syncPrimaryToBusiness(businessId: string, loc: any) {
  const data: Record<string, any> = {};
  if (loc.city) data.businessCity = loc.city;
  if (loc.state) data.businessState = loc.state;
  if (loc.zip || loc.postalCode) data.businessZip = loc.zip || loc.postalCode;
  if (loc.address || loc.address1) data.businessAddr = loc.address || loc.address1;
  if (loc.phone) data.businessPhone = loc.phone;
  if (Object.keys(data).length > 0) {
    await prisma.business.update({ where: { id: businessId }, data }).catch(() => {});
  }
}

function formatLocation(loc: any) {
  return {
    id: loc.id,
    locationNumber: loc.locationNumber,
    locationName: loc.locationName,
    address1: loc.address1,
    address2: loc.address2,
    city: loc.city,
    state: loc.state,
    postalCode: loc.postalCode,
    county: loc.county,
    country: loc.country,
    phone: loc.phone,
    latitude: loc.latitude,
    longitude: loc.longitude,
    placeId: loc.placeId,
    googleMapsUrl: loc.googleMapsUrl,
    isPrimary: loc.isPrimary,
    isConfirmed: loc.isConfirmed,
    source: loc.source,
    pageSlug: loc.pageSlug,
  };
}

function generatePageSlug(loc: any): string | null {
  const parts = [loc.city, loc.state].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
}
