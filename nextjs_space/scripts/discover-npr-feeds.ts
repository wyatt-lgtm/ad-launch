/**
 * NPR Member Station RSS Feed Discovery
 *
 * Discovers RSS feeds from NPR member stations in the 5 pilot states.
 * Strategy:
 *   1. Curated seed list of station websites per state
 *   2. For each station:
 *      a. Fetch homepage HTML
 *      b. Extract physical address via address-extractor.ts → ZIP → county geo-tagging
 *      c. Discover RSS feeds via lib/rss/discovery.ts (HTML link + path probe)
 *   3. Store feeds in RssFeed with sourceType='public_radio', sourceQuality='trusted'
 *   4. Create FeedGeo rows scoped to the station's county (ZIP-based, not state fallback)
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/discover-npr-feeds.ts           # all pilot states
 *   cd nextjs_space && npx tsx scripts/discover-npr-feeds.ts CO TX     # specific states
 */
import { PrismaClient } from '@prisma/client';
import { discoverFeedsFromSite, type DiscoveredFeed } from '../lib/rss/discovery';
import { extractBusinessAddress, type ExtractedAddress } from '../lib/address-extractor';

const prisma = new PrismaClient();

const USER_AGENT = 'AdLaunch-NPRDiscovery/1.0 (+https://connect.launchmarketing.com)';
const FETCH_TIMEOUT = 12000;
const CONCURRENCY = 3;

// ── Station seed data ───────────────────────────────────────────────────────
interface StationSeed {
  callSign: string;
  name: string;
  url: string;
  city: string;
  state: string;
}

const STATIONS: Record<string, StationSeed[]> = {
  CO: [
    { callSign: 'CPR',  name: 'Colorado Public Radio',           url: 'https://www.cpr.org',   city: 'Centennial', state: 'CO' },
    { callSign: 'KUNC', name: 'KUNC - Northern Colorado',        url: 'https://www.kunc.org',  city: 'Greeley',    state: 'CO' },
    { callSign: 'KRCC', name: 'KRCC - Southern Colorado',        url: 'https://www.krcc.org',  city: 'Colorado Springs', state: 'CO' },
    { callSign: 'KUVO', name: 'KUVO - Denver Jazz/News',         url: 'https://www.kuvo.org',  city: 'Denver',     state: 'CO' },
    { callSign: 'KSJD', name: 'KSJD - Four Corners Community',   url: 'https://www.ksjd.org',  city: 'Cortez',     state: 'CO' },
    { callSign: 'KDNK', name: 'KDNK - Roaring Fork Valley',     url: 'https://www.kdnk.org',  city: 'Carbondale', state: 'CO' },
  ],
  TX: [
    { callSign: 'KERA', name: 'KERA - North Texas',              url: 'https://www.kera.org',            city: 'Dallas',     state: 'TX' },
    { callSign: 'KUT',  name: 'KUT - Austin NPR',                url: 'https://www.kut.org',             city: 'Austin',     state: 'TX' },
    { callSign: 'KUHF', name: 'Houston Public Media',            url: 'https://www.houstonpublicmedia.org', city: 'Houston', state: 'TX' },
    { callSign: 'KSTX', name: 'Texas Public Radio - San Antonio', url: 'https://www.tpr.org',            city: 'San Antonio', state: 'TX' },
    { callSign: 'KTEP', name: 'KTEP - El Paso',                  url: 'https://www.ktep.org',            city: 'El Paso',    state: 'TX' },
    { callSign: 'KACU', name: 'KACU - Abilene',                  url: 'https://www.kacu.org',            city: 'Abilene',    state: 'TX' },
    { callSign: 'KAMU', name: 'KAMU - College Station',          url: 'https://www.kamu.tamu.edu',       city: 'College Station', state: 'TX' },
    { callSign: 'KEDT', name: 'KEDT - Corpus Christi',           url: 'https://www.kedt.org',            city: 'Corpus Christi', state: 'TX' },
    { callSign: 'KOHM', name: 'KOHM - Lubbock',                  url: 'https://www.kohm.org',            city: 'Lubbock',    state: 'TX' },
  ],
  FL: [
    { callSign: 'WUFT', name: 'WUFT - Gainesville',              url: 'https://www.wuft.org',   city: 'Gainesville', state: 'FL' },
    { callSign: 'WUSF', name: 'WUSF - Tampa Bay',                url: 'https://www.wusf.org',   city: 'Tampa',       state: 'FL' },
    { callSign: 'WLRN', name: 'WLRN - South Florida',            url: 'https://www.wlrn.org',   city: 'Miami',       state: 'FL' },
    { callSign: 'WJCT', name: 'WJCT - Jacksonville',             url: 'https://www.wjct.org',   city: 'Jacksonville', state: 'FL' },
    { callSign: 'WMFE', name: 'WMFE - Orlando',                  url: 'https://www.wmfe.org',   city: 'Orlando',     state: 'FL' },
    { callSign: 'WFSU', name: 'WFSU - Tallahassee',              url: 'https://www.wfsu.org',   city: 'Tallahassee', state: 'FL' },
    { callSign: 'WGCU', name: 'WGCU - Fort Myers',               url: 'https://www.wgcu.org',   city: 'Fort Myers',  state: 'FL' },
    { callSign: 'WUWF', name: 'WUWF - Pensacola',                url: 'https://www.wuwf.org',   city: 'Pensacola',   state: 'FL' },
    { callSign: 'WQCS', name: 'WQCS - Fort Pierce',              url: 'https://www.wqcs.org',   city: 'Fort Pierce', state: 'FL' },
    { callSign: 'WUCF', name: 'WUCF - UCF Orlando',              url: 'https://www.wucf.org',   city: 'Orlando',     state: 'FL' },
  ],
  NC: [
    { callSign: 'WUNC', name: 'WUNC - NC Public Radio',          url: 'https://www.wunc.org',   city: 'Chapel Hill',   state: 'NC' },
    { callSign: 'WFAE', name: 'WFAE - Charlotte',                url: 'https://www.wfae.org',   city: 'Charlotte',     state: 'NC' },
    { callSign: 'WFDD', name: 'WFDD - Winston-Salem',            url: 'https://www.wfdd.org',   city: 'Winston-Salem', state: 'NC' },
    { callSign: 'WCQS', name: 'WCQS - Asheville',                url: 'https://www.bpr.org',    city: 'Asheville',     state: 'NC' },
    { callSign: 'WHQR', name: 'WHQR - Wilmington',               url: 'https://www.whqr.org',   city: 'Wilmington',    state: 'NC' },
    { callSign: 'WNCW', name: 'WNCW - Spindale',                 url: 'https://www.wncw.org',   city: 'Spindale',      state: 'NC' },
  ],
  MT: [
    { callSign: 'KUFM', name: 'Montana Public Radio',            url: 'https://www.mtpr.org',     city: 'Missoula',  state: 'MT' },
    { callSign: 'KEMC', name: 'Yellowstone Public Radio',        url: 'https://www.ypradio.org',  city: 'Billings',  state: 'MT' },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────────
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface StationResult {
  station: StationSeed;
  feeds: DiscoveredFeed[];
  address: ExtractedAddress | null;
  error?: string;
}

async function processStation(station: StationSeed): Promise<StationResult> {
  console.log(`  🔍 ${station.callSign} (${station.name}) — ${station.url}`);

  // 1. Discover RSS feeds
  let feeds: DiscoveredFeed[] = [];
  try {
    feeds = await discoverFeedsFromSite(station.url);
    console.log(`     Found ${feeds.length} feed(s)`);
  } catch (err: any) {
    console.log(`     ⚠ Feed discovery error: ${err.message}`);
  }

  // 2. Extract physical address from homepage for geo-tagging
  let address: ExtractedAddress | null = null;
  try {
    const html = await fetchHtml(station.url);
    if (html) {
      address = extractBusinessAddress(html);
      if (address.zip) {
        console.log(`     📍 Address: ${address.city}, ${address.state} ${address.zip} (${address.source}, conf=${address.confidence})`);
      } else {
        console.log(`     📍 No ZIP found — will try /about and /contact pages`);
        // Try /about and /contact pages as fallback
        for (const path of ['/about', '/contact', '/about-us', '/contact-us', '/about/']) {
          const fallbackHtml = await fetchHtml(station.url.replace(/\/$/, '') + path);
          if (fallbackHtml) {
            const fallbackAddr = extractBusinessAddress(fallbackHtml);
            if (fallbackAddr.zip && fallbackAddr.confidence > (address?.confidence ?? 0)) {
              address = fallbackAddr;
              console.log(`     📍 Found on ${path}: ${address.city}, ${address.state} ${address.zip}`);
              break;
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.log(`     ⚠ Address extraction error: ${err.message}`);
  }

  return { station, feeds, address };
}

// ── Geo-tagging: ZIP code → county → FeedGeo rows ──────────────────────────
async function geoTagByZip(feedId: string, zipCode: string, _stateCode: string) {
  // Find the GeoZip record
  const geoZip = await prisma.geoZip.findUnique({
    where: { code: zipCode },
    select: {
      id: true,
      code: true,
      cityZips: {
        select: {
          city: {
            select: {
              county: { select: { id: true, name: true, fipsCode: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  if (!geoZip) {
    console.log(`     ⚠ ZIP ${zipCode} not found in GeoZip table`);
    return 0;
  }

  const county = geoZip.cityZips[0]?.city?.county;
  if (county) {
    // Get all GeoZip IDs in the same county
    const countyZipIds = await prisma.geoZip.findMany({
      where: {
        cityZips: {
          some: {
            city: { countyId: county.id },
          },
        },
      },
      select: { id: true, code: true },
    });

    // Create FeedGeo rows for all ZIPs in the county
    let created = 0;
    for (const z of countyZipIds) {
      try {
        await prisma.feedGeo.create({
          data: {
            feedId,
            zipId: z.id,
            coverageType: 'confirmed',
            confidence: 0.85,
            source: 'npr_station_address',
          },
        });
        created++;
      } catch {
        // unique constraint violation — already exists
      }
    }

    console.log(`     🌍 Geo-tagged to ${county.name} (${created} new ZIPs of ${countyZipIds.length} total)`);
    return created;
  } else {
    // Fallback: geo-tag just the single ZIP
    try {
      await prisma.feedGeo.create({
        data: {
          feedId,
          zipId: geoZip.id,
          coverageType: 'inferred',
          confidence: 0.6,
          source: 'npr_station_zip_only',
        },
      });
      console.log(`     🌍 Geo-tagged to single ZIP ${zipCode} (county lookup failed)`);
      return 1;
    } catch {
      return 0;
    }
  }
}

// If ZIP extraction failed, use the station's city + state to find a ZIP code
async function fallbackZipFromCity(city: string, stateCode: string): Promise<string | null> {
  // GeoCity → GeoCounty → GeoState, then get a ZIP via GeoCityZip
  const cityRow = await prisma.geoCity.findFirst({
    where: {
      name: { equals: city, mode: 'insensitive' },
      county: {
        state: { code: stateCode },
      },
    },
    select: {
      cityZips: {
        select: { zip: { select: { code: true } } },
        where: { isPrimary: true },
        take: 1,
      },
    },
  });
  if (cityRow?.cityZips[0]?.zip?.code) return cityRow.cityZips[0].zip.code;

  // If no primary ZIP, try any ZIP for the city
  const anyCity = await prisma.geoCity.findFirst({
    where: {
      name: { equals: city, mode: 'insensitive' },
      county: { state: { code: stateCode } },
    },
    select: {
      cityZips: {
        select: { zip: { select: { code: true } } },
        take: 1,
      },
    },
  });
  return anyCity?.cityZips[0]?.zip?.code ?? null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const targetStates = args.length > 0
    ? args.map(s => s.toUpperCase()).filter(s => STATIONS[s])
    : Object.keys(STATIONS);

  console.log(`\n🎙️  NPR Member Station RSS Feed Discovery`);
  console.log(`   Target states: ${targetStates.join(', ')}`);
  console.log(`   Total stations: ${targetStates.reduce((n, s) => n + STATIONS[s].length, 0)}`);
  console.log('');

  let totalFeeds = 0;
  let totalNew = 0;
  let totalGeoTagged = 0;
  const stationSummary: { station: string; feeds: number; zip: string; county: string }[] = [];

  for (const state of targetStates) {
    const stations = STATIONS[state];
    console.log(`\n── ${state} (${stations.length} station${stations.length > 1 ? 's' : ''}) ${'─'.repeat(50)}`);

    // Process stations in batches
    for (let i = 0; i < stations.length; i += CONCURRENCY) {
      const batch = stations.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(s => processStation(s))
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { station, feeds, address } = r.value;

        // Determine ZIP for geo-tagging (trim ZIP+4 suffix)
        let geoZip = address?.zip?.replace(/-\d+$/, '') ?? null;
        if (!geoZip) {
          geoZip = await fallbackZipFromCity(station.city, station.state);
          if (geoZip) {
            console.log(`     📍 City fallback: ${station.city}, ${station.state} → ZIP ${geoZip}`);
          }
        }

        for (const feed of feeds) {
          totalFeeds++;
          // Upsert into RssFeed
          const existing = await prisma.rssFeed.findUnique({ where: { url: feed.url } });
          if (existing) {
            console.log(`     ⏭ Already exists: ${feed.url}`);
            // Still geo-tag if we have a ZIP and it's not already tagged
            if (geoZip) {
              const existingGeo = await prisma.feedGeo.findFirst({ where: { feedId: existing.id } });
              if (!existingGeo) {
                await geoTagByZip(existing.id, geoZip, station.state);
                totalGeoTagged++;
              }
            }
            continue;
          }

          // Ensure description is a plain string (Atom feeds sometimes return objects)
          const descStr = typeof feed.description === 'string'
            ? feed.description
            : (feed.description && typeof feed.description === 'object' && '#text' in (feed.description as any))
              ? String((feed.description as any)['#text'])
              : `RSS feed from ${station.name} (${station.callSign}), NPR member station in ${station.city}, ${station.state}`;

          const created = await prisma.rssFeed.create({
            data: {
              url: feed.url,
              title: feed.title ?? `${station.callSign} - ${station.name}`,
              description: descStr,
              siteUrl: station.url,
              language: feed.language ?? 'en',
              sourceType: 'community',  // public_radio fits under community
              sourceQuality: 'trusted',
              status: 'pending',
              discoveredBy: 'npr_station_discovery',
              discoveryMethod: feed.discoveryMethod,
              feedFormat: feed.feedFormat,
              pilotState: station.state,
              geoScope: 'local',
              notes: `NPR member station ${station.callSign} (${station.name}). City: ${station.city}, ${station.state}.${address?.zip ? ` Station address ZIP: ${address.zip}. Address source: ${address.source}.` : ''}`,
            },
          });
          totalNew++;
          console.log(`     ✅ NEW: ${feed.url} (${feed.discoveryMethod})`);

          // Geo-tag by station ZIP
          if (geoZip) {
            await geoTagByZip(created.id, geoZip, station.state);
            totalGeoTagged++;
          } else {
            console.log(`     ⚠ No ZIP available for geo-tagging — state fallback only`);
          }
        }

        stationSummary.push({
          station: `${station.callSign} (${station.state})`,
          feeds: feeds.length,
          zip: geoZip ?? '—',
          county: address?.city ?? station.city,
        });
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 NPR Discovery Summary`);
  console.log(`   Stations scanned:  ${stationSummary.length}`);
  console.log(`   Feeds discovered:  ${totalFeeds}`);
  console.log(`   New feeds stored:  ${totalNew}`);
  console.log(`   Geo-tagged feeds:  ${totalGeoTagged}`);
  console.log('');
  console.log('   Station breakdown:');
  for (const s of stationSummary) {
    console.log(`     ${s.station.padEnd(25)} feeds=${s.feeds}  zip=${s.zip}  city=${s.county}`);
  }
  console.log(`${'═'.repeat(70)}\n`);
}

main()
  .catch(e => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
