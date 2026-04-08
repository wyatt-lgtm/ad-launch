export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidUrl } from '@/lib/email-validation';
import { extractBusinessAddress } from '@/lib/address-extractor';
import { lookupBusinessByUrl, PlaceResult } from '@/lib/google-places';

/**
 * POST /api/analyze
 * Step 1: Fetch website → scrape address → fallback to Google Places → create analysis record.
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

    // Step 1: Fetch the website HTML (serves as both reachability check and address scraping)
    let htmlBody = '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(normalizedUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AdLaunchBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      }).catch(() => null);
      clearTimeout(timeout);

      if (!res || !res.ok) {
        console.warn(`[analyze] Website unreachable: ${normalizedUrl} (status: ${res?.status ?? 'timeout'})`);
        return NextResponse.json({
          error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
        }, { status: 422 });
      }

      htmlBody = await res.text().catch(() => '');
      console.log(`[analyze] Website fetched: ${normalizedUrl} (status: ${res.status}, ${htmlBody.length} bytes)`);
    } catch (fetchErr: any) {
      console.warn(`[analyze] Website fetch failed: ${normalizedUrl}`, fetchErr?.message);
      return NextResponse.json({
        error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
      }, { status: 422 });
    }

    // Step 2: Try to extract address from the website HTML first
    const scraped = extractBusinessAddress(htmlBody);
    const hasScrapedAddress = scraped.source !== 'none' && (scraped.city || scraped.zip);
    console.log(`[analyze] Website address extraction: source=${scraped.source}, confidence=${scraped.confidence}, city=${scraped.city}, state=${scraped.state}, zip=${scraped.zip}`);

    // Step 3: If no address found on website, fall back to Google Places
    let places: PlaceResult[] = [];
    if (!hasScrapedAddress) {
      console.log(`[analyze] No address found on website, falling back to Google Places: ${normalizedUrl}`);
      places = await lookupBusinessByUrl(normalizedUrl);
      console.log(`[analyze] Google Places returned ${places.length} results`);
    } else {
      console.log(`[analyze] Address found on website (${scraped.source}), skipping Google Places lookup`);
    }

    // Step 4: Create analysis record (no Tombstone yet — user must confirm location first)
    const topPlace = places[0];
    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        status: 'pending_location',
        userId: userId ?? null,
        // Pre-fill from scraped website address (highest priority) or Google Places
        ...(hasScrapedAddress ? {
          businessName: scraped.businessName || undefined,
          businessAddr: scraped.address || undefined,
          businessCity: scraped.city || undefined,
          businessState: scraped.state || undefined,
          businessZip: scraped.zip || undefined,
          businessPhone: scraped.phone || undefined,
          geoSource: scraped.source,
        } : topPlace ? {
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
      // Return scraped address or Google Places results to the frontend
      scrapedAddress: hasScrapedAddress ? scraped : null,
      places: hasScrapedAddress ? [] : places.slice(0, 5),
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
