// @ts-nocheck
/**
 * Phase 7: County Gov Geo-Precision Fix
 *
 * Problem: 154+ county gov feeds are tagged to ALL ZIPs in their state,
 * causing irrelevant feeds to appear in trade area queries.
 *
 * Fix strategy (multi-layer):
 *   1. Parse county name from feed title/URL/siteUrl
 *   2. Match county name to GeoCounty table for the feed's pilotState
 *   3. If matched, replace state-wide FeedGeo rows with county-scoped ZIPs
 *   4. If not matched, try extractBusinessAddress() on the county website
 *   5. If address yields a ZIP, use ZIP → county lookup
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/fix-county-geo-precision.ts           # all
 *   cd nextjs_space && npx tsx scripts/fix-county-geo-precision.ts --dry-run # preview
 *   cd nextjs_space && npx tsx scripts/fix-county-geo-precision.ts --active  # active feeds only
 */
import { PrismaClient } from '@prisma/client';
import { extractBusinessAddress } from '../lib/address-extractor';

const prisma = new PrismaClient();

const USER_AGENT = 'AdLaunch-GeoFix/1.0 (+https://ad-launch-1nfyr8.abacusai.app)';
const FETCH_TIMEOUT = 10000;

// ── County name extraction from feed metadata ──────────────────────────
function extractCountyName(title: string | null, siteUrl: string | null): string | null {
  // Strategy 1: Title often contains "Xxx County" or "County of Xxx"
  if (title) {
    // "Adams County, CO" → "Adams"
    // "News – Baca County Colorado" → "Baca"
    // "Alamance County North Carolina" → "Alamance"
    // "Jackson County, Florida" → "Jackson"
    const patterns = [
      /^(?:News\s*[–\-]\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+County/i,
      /County\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+County/i,
    ];
    for (const p of patterns) {
      const m = title.match(p);
      if (m?.[1]) {
        const name = m[1].trim();
        // Filter out state names and generic words
        if (!['North', 'South', 'West', 'East', 'New', 'The'].includes(name)) {
          return name.toUpperCase();
        }
        // Handle multi-word like "Clear Creek"
        // Try the full title match for multi-word counties
      }
    }

    // Multi-word county: "Clear Creek County Tourism Bureau" → "CLEAR CREEK"
    const multiWord = title.match(/^(?:News\s*[–\-]\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+County/i);
    if (multiWord?.[1]) {
      const name = multiWord[1].trim();
      // Exclude trailing state names
      const cleaned = name.replace(/\s+(Colorado|Texas|Florida|Montana|North\s+Carolina|NC|CO|TX|FL|MT)$/i, '').trim();
      if (cleaned.length > 1) return cleaned.toUpperCase();
    }
  }

  // Strategy 2: Parse from siteUrl domain
  if (siteUrl) {
    // https://www.adamscountyco.gov → try to extract county name
    // https://www.co.atascosa.tx.us → "atascosa"
    // https://www.jacksoncountyfl.gov → "jackson"
    try {
      const hostname = new URL(siteUrl).hostname.replace(/^www\./, '');
      
      // Pattern: co.NAME.STATE.us
      const coDotMatch = hostname.match(/^co\.([a-z]+)\.\w{2}\.us$/);
      if (coDotMatch?.[1]) return coDotMatch[1].toUpperCase();

      // Pattern: NAMEcountySTATE.gov or NAMEcounty.gov
      const countyDomain = hostname.match(/^([a-z]+)county(?:nc|tx|fl|co|mt)?\.(?:gov|org)$/);
      if (countyDomain?.[1]) return countyDomain[1].toUpperCase();

      // Pattern: NAME.county.STATE
      const subDomain = hostname.match(/^([a-z]+)\.county\./i);
      if (subDomain?.[1]) return subDomain[1].toUpperCase();
    } catch { /* ignore URL parse errors */ }
  }

  return null;
}

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

// ── Main fix logic ──────────────────────────────────────────────────────

interface FixResult {
  feedId: string;
  feedTitle: string;
  state: string;
  method: 'county_name_match' | 'address_extraction' | 'zip_fallback' | 'failed';
  countyName: string | null;
  oldGeoCount: number;
  newGeoCount: number;
}

async function fixFeedGeoPrecision(
  feed: { id: string; title: string | null; siteUrl: string | null; pilotState: string | null },
  dryRun: boolean,
): Promise<FixResult> {
  const result: FixResult = {
    feedId: feed.id,
    feedTitle: feed.title ?? 'Unknown',
    state: feed.pilotState ?? '??',
    method: 'failed',
    countyName: null,
    oldGeoCount: 0,
    newGeoCount: 0,
  };

  // Count existing FeedGeo rows
  result.oldGeoCount = await prisma.feedGeo.count({ where: { feedId: feed.id } });

  if (!feed.pilotState) {
    console.log(`  ⚠ ${feed.title} — no pilotState, skipping`);
    return result;
  }

  // Step 1: Try county name extraction from title/URL
  const countyName = extractCountyName(feed.title, feed.siteUrl);

  if (countyName) {
    // Look up in GeoCounty for this state
    const county = await prisma.geoCounty.findFirst({
      where: {
        name: { equals: countyName, mode: 'insensitive' },
        state: { code: feed.pilotState },
      },
      select: { id: true, name: true },
    });

    if (county) {
      result.countyName = county.name;
      result.method = 'county_name_match';

      // Get all ZIPs in this county
      const countyZips = await prisma.geoZip.findMany({
        where: { cityZips: { some: { city: { countyId: county.id } } } },
        select: { id: true },
      });

      if (countyZips.length > 0) {
        if (!dryRun) {
          // Delete old state-wide FeedGeo rows
          await prisma.feedGeo.deleteMany({ where: { feedId: feed.id } });

          // Create county-scoped FeedGeo rows
          let created = 0;
          for (const z of countyZips) {
            try {
              await prisma.feedGeo.create({
                data: {
                  feedId: feed.id,
                  zipId: z.id,
                  coverageType: 'confirmed',
                  confidence: 0.90,
                  source: 'county_name_match',
                },
              });
              created++;
            } catch { /* dupe */ }
          }
          result.newGeoCount = created;
        } else {
          result.newGeoCount = countyZips.length;
        }

        console.log(`  ✅ ${feed.title?.slice(0, 40)} → ${county.name} (${result.oldGeoCount} → ${result.newGeoCount} ZIPs)`);
        return result;
      }
    }
  }

  // Step 2: Try address extraction from the county website
  if (feed.siteUrl) {
    const html = await fetchHtml(feed.siteUrl);
    if (html) {
      const addr = extractBusinessAddress(html);
      if (addr.zip) {
        const zipCode = addr.zip.replace(/-\d+$/, ''); // trim ZIP+4

        // Look up ZIP → county
        const geoZip = await prisma.geoZip.findUnique({
          where: { code: zipCode },
          select: {
            id: true,
            cityZips: {
              select: { city: { select: { county: { select: { id: true, name: true } } } } },
              take: 1,
            },
          },
        });

        const county = geoZip?.cityZips[0]?.city?.county;
        if (county) {
          result.countyName = county.name;
          result.method = 'address_extraction';

          const countyZips = await prisma.geoZip.findMany({
            where: { cityZips: { some: { city: { countyId: county.id } } } },
            select: { id: true },
          });

          if (countyZips.length > 0 && !dryRun) {
            await prisma.feedGeo.deleteMany({ where: { feedId: feed.id } });
            let created = 0;
            for (const z of countyZips) {
              try {
                await prisma.feedGeo.create({
                  data: {
                    feedId: feed.id,
                    zipId: z.id,
                    coverageType: 'confirmed',
                    confidence: 0.85,
                    source: 'courthouse_address',
                  },
                });
                created++;
              } catch { /* dupe */ }
            }
            result.newGeoCount = created;
          } else {
            result.newGeoCount = countyZips.length;
          }

          console.log(`  🏠 ${feed.title?.slice(0, 40)} → ${county.name} via address (ZIP ${zipCode}, ${result.oldGeoCount} → ${result.newGeoCount})`);
          return result;
        } else if (geoZip) {
          // ZIP exists but no county mapping — tag to single ZIP
          result.method = 'zip_fallback';
          result.countyName = `ZIP:${zipCode}`;
          if (!dryRun) {
            await prisma.feedGeo.deleteMany({ where: { feedId: feed.id } });
            await prisma.feedGeo.create({
              data: {
                feedId: feed.id,
                zipId: geoZip.id,
                coverageType: 'inferred',
                confidence: 0.60,
                source: 'courthouse_zip_only',
              },
            });
            result.newGeoCount = 1;
          } else {
            result.newGeoCount = 1;
          }
          console.log(`  📍 ${feed.title?.slice(0, 40)} → single ZIP ${zipCode} (${result.oldGeoCount} → 1)`);
          return result;
        }
      }
    }

    // Step 2b: Try /about and /contact pages
    for (const path of ['/about', '/contact', '/contact-us', '/about-us']) {
      const fallbackHtml = await fetchHtml(feed.siteUrl.replace(/\/$/, '') + path);
      if (fallbackHtml) {
        const addr = extractBusinessAddress(fallbackHtml);
        if (addr.zip) {
          const zipCode = addr.zip.replace(/-\d+$/, '');
          const geoZip = await prisma.geoZip.findUnique({
            where: { code: zipCode },
            select: {
              id: true,
              cityZips: {
                select: { city: { select: { county: { select: { id: true, name: true } } } } },
                take: 1,
              },
            },
          });
          const county = geoZip?.cityZips[0]?.city?.county;
          if (county) {
            result.countyName = county.name;
            result.method = 'address_extraction';

            const countyZips = await prisma.geoZip.findMany({
              where: { cityZips: { some: { city: { countyId: county.id } } } },
              select: { id: true },
            });

            if (countyZips.length > 0 && !dryRun) {
              await prisma.feedGeo.deleteMany({ where: { feedId: feed.id } });
              let created = 0;
              for (const z of countyZips) {
                try {
                  await prisma.feedGeo.create({
                    data: {
                      feedId: feed.id,
                      zipId: z.id,
                      coverageType: 'confirmed',
                      confidence: 0.80,
                      source: 'courthouse_subpage_address',
                    },
                  });
                  created++;
                } catch { /* dupe */ }
              }
              result.newGeoCount = created;
            } else {
              result.newGeoCount = countyZips.length;
            }

            console.log(`  🏠 ${feed.title?.slice(0, 40)} → ${county.name} via ${path} (ZIP ${zipCode}, ${result.oldGeoCount} → ${result.newGeoCount})`);
            return result;
          }
        }
      }
    }
  }

  // Step 3: Last resort — try to match county from title with fuzzy approach
  // Extract any plausible county name tokens from title
  if (feed.title) {
    const words = feed.title.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    for (let i = 0; i < words.length; i++) {
      // Try single word as county name
      const candidate = words[i].toUpperCase();
      if (['NEWS', 'THE', 'COUNTY', 'ARCHIVE', 'SPOTLIGHTS', 'NORTH', 'SOUTH', 'OFFICIAL', 'GOVERNMENT'].includes(candidate)) continue;
      
      const county = await prisma.geoCounty.findFirst({
        where: {
          name: { equals: candidate, mode: 'insensitive' },
          state: { code: feed.pilotState },
        },
        select: { id: true, name: true },
      });

      if (county) {
        const countyZips = await prisma.geoZip.findMany({
          where: { cityZips: { some: { city: { countyId: county.id } } } },
          select: { id: true },
        });

        if (countyZips.length > 0) {
          result.countyName = county.name;
          result.method = 'county_name_match';
          if (!dryRun) {
            await prisma.feedGeo.deleteMany({ where: { feedId: feed.id } });
            let created = 0;
            for (const z of countyZips) {
              try {
                await prisma.feedGeo.create({
                  data: { feedId: feed.id, zipId: z.id, coverageType: 'confirmed', confidence: 0.75, source: 'county_title_fuzzy' },
                });
                created++;
              } catch {}
            }
            result.newGeoCount = created;
          } else {
            result.newGeoCount = countyZips.length;
          }
          console.log(`  🔍 ${feed.title?.slice(0, 40)} → ${county.name} (fuzzy, ${result.oldGeoCount} → ${result.newGeoCount})`);
          return result;
        }
      }
    }
  }

  console.log(`  ❌ ${feed.title?.slice(0, 50)} — could not determine county`);
  return result;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const activeOnly = args.includes('--active');

  // Find all state-fallback county gov feeds (FeedGeo count > 200)
  const statusFilter = activeOnly ? "AND f.status = 'active'" : '';
  const feeds = await prisma.$queryRawUnsafe<any[]>(`
    SELECT f.id, f.title, f."siteUrl", f."pilotState", f.status,
      (SELECT COUNT(*) FROM "FeedGeo" fg WHERE fg."feedId" = f.id)::int as geo_count
    FROM "RssFeed" f
    WHERE f."sourceType" = 'gov_meeting'
      AND (SELECT COUNT(*) FROM "FeedGeo" fg WHERE fg."feedId" = f.id) > 200
      ${statusFilter}
    ORDER BY f."pilotState", f.title
  `);

  console.log(`\n🏛️  Phase 7: County Gov Geo-Precision Fix`);
  console.log(`   State-fallback feeds: ${feeds.length}${activeOnly ? ' (active only)' : ''}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const results: FixResult[] = [];
  let fixed = 0;
  let failed = 0;
  let currentState = '';

  for (const feed of feeds) {
    if (feed.pilotState !== currentState) {
      currentState = feed.pilotState;
      console.log(`\n── ${currentState} ${'─'.repeat(60)}`);
    }

    const result = await fixFeedGeoPrecision(feed, dryRun);
    results.push(result);
    if (result.method !== 'failed') fixed++;
    else failed++;
  }

  // Summary
  const byMethod: Record<string, number> = {};
  let totalOldGeos = 0;
  let totalNewGeos = 0;
  for (const r of results) {
    byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
    totalOldGeos += r.oldGeoCount;
    totalNewGeos += r.newGeoCount;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Geo-Precision Fix Summary${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`   Feeds processed:    ${results.length}`);
  console.log(`   ✅ Fixed:             ${fixed}`);
  console.log(`   ❌ Failed:            ${failed}`);
  console.log(`   FeedGeo rows:       ${totalOldGeos.toLocaleString()} → ${totalNewGeos.toLocaleString()} (${((1 - totalNewGeos / totalOldGeos) * 100).toFixed(0)}% reduction)`);
  console.log(`\n   By method:`);
  for (const [method, count] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${method.padEnd(25)} ${count}`);
  }

  if (failed > 0) {
    console.log(`\n   Failed feeds:`);
    for (const r of results.filter(r => r.method === 'failed')) {
      console.log(`     ${r.state} | ${r.feedTitle.slice(0, 50)}`);
    }
  }
  console.log(`${'═'.repeat(60)}\n`);
}

main()
  .catch(e => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
