export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { isValidUrl } from '@/lib/email-validation';
import { extractBusinessAddress } from '@/lib/address-extractor';
import { lookupBusinessByUrl, searchPlaces, PlaceResult } from '@/lib/google-places';

/**
 * POST /api/analyze
 * Step 1: Fetch website → scrape address → fallback to Google Places → create analysis record.
 * Does NOT launch Tombstone — that happens after user confirms location via /api/analysis/[id]/confirm-and-launch.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { websiteUrl } = body ?? {};

    // Resolve userId from session (server-side) — never trust client-supplied userId
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      if (session?.user) {
        userId = (session.user as any).id ?? null;
      }
    } catch { /* unauthenticated — userId stays null */ }
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

      // Bot-protection / WAF detection — many hosting providers return 403 to datacenter IPs.
      // Treat these as "reachable but bot-blocked" rather than truly unreachable.
      const serverHeader = res.headers.get('server')?.toLowerCase() || '';
      const botBlocked = res.status === 403 && (
        // Cloudflare
        res.headers.get('cf-mitigated') === 'challenge' ||
        serverHeader.includes('cloudflare') ||
        res.headers.get('cf-ray') ||
        // Hostinger CDN
        serverHeader.includes('hcdn') ||
        res.headers.get('platform')?.toLowerCase() === 'hostinger' ||
        // Sucuri WAF
        res.headers.get('x-sucuri-id') ||
        serverHeader.includes('sucuri') ||
        // Wordfence / generic WordPress WAF
        serverHeader.includes('wordfence') ||
        // StackPath / Highwinds / MaxCDN
        serverHeader.includes('stackpath') ||
        serverHeader.includes('highwinds') ||
        // Imperva / Incapsula
        res.headers.get('x-iinfo') ||
        serverHeader.includes('incapsula') ||
        // Akamai
        res.headers.get('x-akamai-transformed') ||
        // AWS WAF
        res.headers.get('x-amzn-waf-action') ||
        // Generic: any 403 with a known CDN/hosting server header likely means bot-blocked
        serverHeader.includes('nginx') ||
        serverHeader.includes('apache') ||
        serverHeader.includes('litespeed') ||
        serverHeader.includes('openresty')
      );

      // Treat non-blocked 4xx/5xx as unreachable, but 2xx/3xx means site exists
      if (res.status >= 400 && !botBlocked) {
        console.warn(`[analyze] Website error: ${normalizedUrl} (status: ${res.status}, server: ${serverHeader || 'unknown'})`);
        return NextResponse.json({
          error: `We couldn't reach ${normalizedUrl}. Please check the URL and make sure the website is online, then try again.`,
        }, { status: 422 });
      }

      siteReachable = true;

      if (botBlocked) {
        console.log(`[analyze] Bot/WAF block detected for ${normalizedUrl} (status: ${res.status}, server: ${serverHeader}) — treating as reachable, skipping HTML`);
        htmlBody = '';
      } else {
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

    // Step 3: Google Places lookup — either as cross-validation or primary source
    let places: PlaceResult[] = [];
    if (hasScrapedAddress) {
      // Cross-validate scraped address against Google Places for canonical formatting
      console.log(`[analyze] Address found on website (${scraped.source}), cross-validating with Google Places`);
      try {
        // Strategy A: search by business name + address fragments
        const queryParts = [
          scraped.businessName,
          scraped.address,
          scraped.city,
          scraped.state,
          scraped.zip,
        ].filter(Boolean);
        const validationQuery = queryParts.length >= 2
          ? queryParts.join(' ')
          : normalizedUrl;
        const validationResults = await searchPlaces(validationQuery, 3);

        // Strategy B: also search by URL/domain to find the exact business
        // This catches cases where the scraped businessName is empty (footer/regex parse)
        // and the address-only query returns nearby competitors instead.
        const urlResults = await lookupBusinessByUrl(normalizedUrl);

        // Merge and deduplicate by placeId, preferring URL-matched results
        const seenIds = new Set<string>();
        const merged: PlaceResult[] = [];

        // Helper: does this result's website match the input URL?
        const inputDomain = (() => {
          try {
            return new URL(normalizedUrl).hostname.replace(/^www\./, '').toLowerCase();
          } catch { return ''; }
        })();
        const websiteMatches = (p: PlaceResult) => {
          if (!p.website || !inputDomain) return false;
          try {
            return new URL(p.website).hostname.replace(/^www\./, '').toLowerCase() === inputDomain;
          } catch { return false; }
        };

        // First pass: add results whose website matches the input URL (highest confidence)
        for (const r of [...urlResults, ...validationResults]) {
          if (r.placeId && !seenIds.has(r.placeId) && websiteMatches(r)) {
            seenIds.add(r.placeId);
            merged.push(r);
          }
        }
        // Second pass: add remaining results
        for (const r of [...validationResults, ...urlResults]) {
          if (r.placeId && !seenIds.has(r.placeId)) {
            seenIds.add(r.placeId);
            merged.push(r);
          }
        }

        if (merged.length > 0) {
          places = merged.slice(0, 5);
          const topMatch = places[0];
          console.log(`[analyze] Cross-validation found ${merged.length} results. Top: "${topMatch.name}" (website-match: ${websiteMatches(topMatch)})`);
        } else {
          console.log(`[analyze] Cross-validation returned no results, keeping scraped address`);
        }
      } catch (err: any) {
        console.warn(`[analyze] Google Places cross-validation failed (non-fatal):`, err?.message);
      }
    } else {
      // No scraped address — Google Places is the primary source
      console.log(`[analyze] No address found on website, falling back to Google Places: ${normalizedUrl}`);
      places = await lookupBusinessByUrl(normalizedUrl);
      console.log(`[analyze] Google Places returned ${places.length} results`);
    }

    // Step 4: Create analysis record (no Tombstone yet — user must confirm location first)
    const topPlace = places[0];

    // Resolve business fields: prefer Google Places (canonical) over raw scrape
    // If both scraped and Google Places exist, Google Places wins for address/city/state/zip
    // but scraped businessName is kept as fallback if Google doesn't have one.
    const bizFields = topPlace ? {
      businessName: topPlace.name || scraped.businessName || undefined,
      businessAddr: topPlace.formattedAddress || scraped.address || undefined,
      businessCity: topPlace.city || scraped.city || undefined,
      businessState: topPlace.state || scraped.state || undefined,
      businessZip: topPlace.zip || scraped.zip || undefined,
      businessPhone: topPlace.phone || scraped.phone || undefined,
      geoSource: hasScrapedAddress ? 'cross_validated' : 'google_places',
    } : hasScrapedAddress ? {
      businessName: scraped.businessName || undefined,
      businessAddr: scraped.address || undefined,
      businessCity: scraped.city || undefined,
      businessState: scraped.state || undefined,
      businessZip: scraped.zip || undefined,
      businessPhone: scraped.phone || undefined,
      geoSource: scraped.source,
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

        // Auto-grant starter credits (idempotent — safe on every upsert)
        try {
          const { grantStarterCredits } = await import('@/lib/credits');
          const starterResult = await grantStarterCredits(business.id, { userId });
          if (starterResult.success && !starterResult.alreadyCharged) {
            console.log(`[analyze] Starter credits granted to business ${business.id}`);
          }
        } catch (creditErr: any) {
          console.error('[analyze] Starter credit grant error (non-fatal):', creditErr?.message);
        }
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
      // Return scraped address and/or Google Places results to the frontend
      // When cross-validated, scraped is still sent for reference but places has the canonical data
      scrapedAddress: hasScrapedAddress ? scraped : null,
      places: places.slice(0, 5),
    });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 });
  }
}
