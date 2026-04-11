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
    let siteReachable = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(normalizedUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // Use a realistic browser UA to reduce captcha/bot blocks
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }).catch(() => null);
      clearTimeout(timeout);

      if (!res) {
        console.warn(`[analyze] Website unreachable (timeout): ${normalizedUrl}`);
        return NextResponse.json({
          error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
        }, { status: 422 });
      }

      // Treat 4xx/5xx as unreachable, but 2xx/3xx means site exists
      if (res.status >= 400) {
        console.warn(`[analyze] Website error: ${normalizedUrl} (status: ${res.status})`);
        return NextResponse.json({
          error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
        }, { status: 422 });
      }

      siteReachable = true;
      htmlBody = await res.text().catch(() => '');

      // Detect captcha/bot-block responses: tiny HTML, captcha headers, or meta-refresh to captcha
      const isCaptcha =
        res.headers.get('sg-captcha') === 'challenge' ||
        res.headers.get('x-sucuri-id') ||
        (htmlBody.length < 1000 && /captcha|challenge|verify.*human|cf-browser-verification/i.test(htmlBody)) ||
        (htmlBody.length < 500 && /meta\s+http-equiv=["']refresh["'][^>]*sgcaptcha|cloudflare/i.test(htmlBody));

      if (isCaptcha) {
        console.log(`[analyze] Bot/captcha block detected for ${normalizedUrl} — site is reachable but HTML not usable`);
        htmlBody = ''; // Clear so address extraction skips
      } else {
        console.log(`[analyze] Website fetched: ${normalizedUrl} (status: ${res.status}, ${htmlBody.length} bytes)`);
      }
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

    // Resolve business fields from scraped address or Google Places
    const bizFields = hasScrapedAddress ? {
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
    } : {};

    // Upsert a Business record for this user + URL (if authenticated)
    let businessId: string | undefined;
    if (userId) {
      try {
        const business = await prisma.business.upsert({
          where: { userId_websiteUrl: { userId, websiteUrl: normalizedUrl } },
          create: {
            userId,
            websiteUrl: normalizedUrl,
            businessName: bizFields.businessName || null,
            businessAddr: bizFields.businessAddr || null,
            businessCity: bizFields.businessCity || null,
            businessState: bizFields.businessState || null,
            businessZip: bizFields.businessZip || null,
            businessPhone: bizFields.businessPhone || null,
          },
          update: {
            // Update fields if they were previously empty
            ...(bizFields.businessName ? { businessName: bizFields.businessName } : {}),
            ...(bizFields.businessCity ? { businessCity: bizFields.businessCity } : {}),
            ...(bizFields.businessState ? { businessState: bizFields.businessState } : {}),
            ...(bizFields.businessZip ? { businessZip: bizFields.businessZip } : {}),
            ...(bizFields.businessPhone ? { businessPhone: bizFields.businessPhone } : {}),
            ...(bizFields.businessAddr ? { businessAddr: bizFields.businessAddr } : {}),
          },
        });
        businessId = business.id;
        console.log(`[analyze] Business upserted: ${business.id} (${bizFields.businessName || normalizedUrl})`);
      } catch (bizErr: any) {
        console.error('[analyze] Business upsert error (non-fatal):', bizErr?.message);
      }
    }

    const analysis = await prisma.analysis.create({
      data: {
        websiteUrl: normalizedUrl,
        status: 'pending_location',
        userId: userId ?? null,
        businessId: businessId ?? null,
        ...bizFields,
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
