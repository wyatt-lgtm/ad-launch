export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { searchBusinessesByTypeAndLocation } from '@/lib/google-places';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { businessType, location } = body;

    if (!businessType || !location) {
      return NextResponse.json({ error: 'Business type and location are required' }, { status: 400 });
    }

    console.log(`[search-businesses] Searching Google Places: "${businessType}" in "${location}"`);
    const places = await searchBusinessesByTypeAndLocation(businessType, location, 15);

    if (places.length === 0) {
      return NextResponse.json({ error: 'No businesses found. Try a different search.' }, { status: 404 });
    }

    // Map to existing frontend format
    const businesses = places.map((p) => ({
      name: p.name,
      address: p.formattedAddress,
      phone: p.phone,
      website: p.website,
      description: p.rating
        ? `⭐ ${p.rating} (${p.userRatingCount ?? 0} reviews)${p.googleMapsUrl ? '' : ''}`
        : '',
      googleMapsUrl: p.googleMapsUrl,
      placeId: p.placeId,
    }));

    console.log(`[search-businesses] Found ${businesses.length} results via Google Places`);
    return NextResponse.json({ businesses });
  } catch (err: any) {
    console.error('[search-businesses] Error:', err?.message);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
