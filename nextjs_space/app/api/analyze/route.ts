export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidUrl } from '@/lib/email-validation';
import { lookupBusinessByUrl } from '@/lib/google-places';

/**
 * POST /api/analyze
 * Step 1: Create analysis record + Google Places lookup.
 * Does NOT launch Tombstone — that happens after user confirms location via /api/analysis/[id]/confirm-and-launch.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { websiteUrl, userId } = body ?? {};
    if (!websiteUrl) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }
    if (!isValidUrl(websiteUrl)) {
      return NextResponse.json({ error: 'Please enter a valid website URL' }, { status: 400 });
    }

    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    // Pre-flight: check if the website is reachable before spending resources
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const probe = await fetch(normalizedUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      }).catch(() => null);
      clearTimeout(timeout);

      if (!probe || !probe.ok) {
        // Try GET as fallback (some servers reject HEAD)
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 10000);
        const probe2 = await fetch(normalizedUrl, {
          signal: controller2.signal,
          redirect: 'follow',
        }).catch(() => null);
        clearTimeout(timeout2);

        if (!probe2 || !probe2.ok) {
          console.warn(`[analyze] Website unreachable: ${normalizedUrl} (status: ${probe?.status ?? probe2?.status ?? 'timeout'})`);
          return NextResponse.json({
            error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
          }, { status: 422 });
        }
      }
      console.log(`[analyze] Website reachable: ${normalizedUrl} (status: ${probe?.status ?? 200})`);
    } catch (probeErr: any) {
      console.warn(`[analyze] Website probe failed: ${normalizedUrl}`, probeErr?.message);
      return NextResponse.json({
        error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
      }, { status: 422 });
    }

    // Google Places lookup — find the business location
    console.log(`[analyze] Looking up business on Google Places: ${normalizedUrl}`);
    const places = await lookupBusinessByUrl(normalizedUrl);
    console.log(`[analyze] Google Places returned ${places.length} results`);

    // Create analysis record (no Tombstone yet — user must confirm location first)
    const topPlace = places[0];
    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        status: 'pending_location', // New status: waiting for location confirmation
        userId: userId ?? null,
        // Pre-fill location from Google Places if found
        ...(topPlace ? {
          businessName: topPlace.name,
          businessAddr: topPlace.formattedAddress,
          businessCity: topPlace.city,
          businessState: topPlace.state,
          businessZip: topPlace.zip,
          businessPhone: topPlace.phone,
          geoSource: 'google_places',
        } : {}),
      },
    });

    return NextResponse.json({
      analysisId: analysis.id,
      status: 'pending_location',
      places: places.slice(0, 5), // Return top 5 candidates
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
