/**
 * Phase 4b: Feed Geo-Tagger Orchestrator
 *
 * Assigns geoScope to all feeds and creates FeedGeo entries
 * linking local/weather feeds to their coverage ZIPs.
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/geo-tag-feeds.ts
 *   cd nextjs_space && npx tsx scripts/geo-tag-feeds.ts --scope national  # only tag national
 *   cd nextjs_space && npx tsx scripts/geo-tag-feeds.ts --scope local     # only tag local
 */
import { PrismaClient, Prisma } from '@prisma/client';
import {
  detectGeoScope,
  extractNwsState,
  extractDomain,
  DOMAIN_CITY_MAP,
  resolveCityToZips,
  getStateZipIds,
} from '../lib/rss/geo-tagger';
import type { GeoScope } from '../lib/rss/types';

const prisma = new PrismaClient();

// Batch size for raw SQL inserts
const BATCH_SIZE = 500;

async function main() {
  const args = process.argv.slice(2);
  const scopeFilter = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : null;

  console.log('\n═══════════════════════════════════════════════');
  console.log(' Phase 4b: Feed Geo-Tagger');
  console.log('═══════════════════════════════════════════════\n');

  // Load all non-retired feeds
  const feeds = await prisma.rssFeed.findMany({
    where: { status: { notIn: ['retired'] } },
    select: {
      id: true,
      url: true,
      title: true,
      sourceType: true,
      pilotState: true,
      geoScope: true,
    },
  });

  console.log(`Loaded ${feeds.length} feeds (excluding retired)\n`);

  const stats = {
    national: 0,
    weather: 0,
    state: 0,
    local: 0,
    feedGeoCreated: 0,
    feedGeoSkipped: 0,
    noMatch: 0,
  };

  // ── Pass 1: Classify geoScope ──────────────────────────────────
  console.log('── Pass 1: Classify geoScope ──');

  for (const feed of feeds) {
    const scope = detectGeoScope(feed.url, feed.sourceType);

    if (scopeFilter && scope !== scopeFilter) continue;

    // Update geoScope if changed
    if (feed.geoScope !== scope) {
      await prisma.rssFeed.update({
        where: { id: feed.id },
        data: { geoScope: scope },
      });
    }

    (stats as any)[scope]++;
  }

  console.log(`  National: ${stats.national}`);
  console.log(`  Weather:  ${stats.weather}`);
  console.log(`  Local:    ${stats.local}`);
  console.log('');

  // ── Pass 2: Create FeedGeo for weather feeds ────────────────────
  if (!scopeFilter || scopeFilter === 'weather') {
    console.log('── Pass 2: Weather feed geo-tagging ──');
    const weatherFeeds = await prisma.rssFeed.findMany({
      where: { geoScope: 'weather', status: { notIn: ['retired', 'broken'] } },
    });

    for (const feed of weatherFeeds) {
      const stateCode = extractNwsState(feed.url) || feed.pilotState;
      if (!stateCode) {
        console.log(`  ⚠ No state code for weather feed: ${feed.url}`);
        continue;
      }

      // Update pilotState if not set
      if (!feed.pilotState) {
        await prisma.rssFeed.update({
          where: { id: feed.id },
          data: { pilotState: stateCode },
        });
      }

      // Get all ZIPs in state
      const stateZips = await getStateZipIds(prisma, stateCode);
      const created = await batchUpsertFeedGeo(feed.id, stateZips.map(z => ({
        zipId: z.zipId,
        confidence: 0.8,
        coverageType: 'confirmed',
        source: 'nws_state_alert',
      })));

      stats.feedGeoCreated += created;
      console.log(`  ✓ ${stateCode} weather: ${stateZips.length} ZIPs → ${created} new FeedGeo`);
    }
    console.log('');
  }

  // ── Pass 3: Create FeedGeo for local feeds ──────────────────────
  if (!scopeFilter || scopeFilter === 'local') {
    console.log('── Pass 3: Local feed geo-tagging ──');
    const localFeeds = await prisma.rssFeed.findMany({
      where: { geoScope: 'local', status: { notIn: ['retired'] } },
    });

    for (const feed of localFeeds) {
      const domain = extractDomain(feed.url);
      const mapping = DOMAIN_CITY_MAP[domain];

      if (mapping) {
        const stateCode = mapping.state;
        const zips = await resolveCityToZips(prisma, mapping.cities, stateCode);

        if (zips.length > 0) {
          // Update pilotState if not set
          if (!feed.pilotState) {
            await prisma.rssFeed.update({
              where: { id: feed.id },
              data: { pilotState: stateCode },
            });
          }

          const created = await batchUpsertFeedGeo(feed.id, zips.map(z => ({
            zipId: z.zipId,
            confidence: z.confidence,
            coverageType: 'confirmed' as string,
            source: 'domain_city_map',
          })));

          stats.feedGeoCreated += created;
          console.log(`  ✓ ${domain} → ${mapping.cities.join(', ')} (${stateCode}): ${zips.length} ZIPs → ${created} new`);
        } else {
          console.log(`  ⚠ ${domain} → cities not found in geo data: ${mapping.cities.join(', ')}`);
          stats.noMatch++;
        }
      } else {
        // No curated mapping — try pilotState fallback
        // These feeds get tagged to the state level as 'inferred'
        if (feed.pilotState) {
          // Use state-level coverage with lower confidence
          const stateZips = await getStateZipIds(prisma, feed.pilotState);
          if (stateZips.length > 0) {
            const created = await batchUpsertFeedGeo(feed.id, stateZips.map(z => ({
              zipId: z.zipId,
              confidence: 0.3,
              coverageType: 'inferred',
              source: 'pilot_state_fallback',
            })));
            stats.feedGeoCreated += created;
            console.log(`  ~ ${domain} → ${feed.pilotState} state fallback: ${stateZips.length} ZIPs → ${created} new`);
          }
        } else {
          console.log(`  ✗ No mapping for: ${domain} (${feed.title})`);
          stats.noMatch++;
        }
      }
    }
    console.log('');
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log(' Geo-Tagging Complete');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Scope: national=${stats.national} weather=${stats.weather} local=${stats.local}`);
  console.log(`  FeedGeo created:  ${stats.feedGeoCreated}`);
  console.log(`  No match (skip):  ${stats.noMatch}`);
  console.log('');

  // Final FeedGeo count
  const totalGeo = await prisma.feedGeo.count();
  console.log(`  Total FeedGeo rows in DB: ${totalGeo}`);
  console.log('');

  await prisma.$disconnect();
}

// ═══════════════════════════════════════════════════════════════
// Batch FeedGeo upsert using raw SQL to avoid connection pool
// exhaustion on 31k+ inserts.
// ═══════════════════════════════════════════════════════════════

interface FeedGeoInput {
  zipId: string;
  confidence: number;
  coverageType: string;
  source: string;
}

async function batchUpsertFeedGeo(
  feedId: string,
  entries: FeedGeoInput[],
): Promise<number> {
  if (entries.length === 0) return 0;

  let totalCreated = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    // Build VALUES clause
    const values = batch.map(e => {
      const id = generateCuid();
      return `('${id}', '${feedId}', '${e.zipId}', '${e.coverageType}', ${e.confidence}, '${e.source}', NOW(), NOW())`;
    }).join(',\n');

    const sql = `
      INSERT INTO "FeedGeo" (id, "feedId", "zipId", "coverageType", confidence, source, "createdAt", "updatedAt")
      VALUES ${values}
      ON CONFLICT ("feedId", "zipId") DO UPDATE SET
        confidence = GREATEST("FeedGeo".confidence, EXCLUDED.confidence),
        "coverageType" = CASE
          WHEN EXCLUDED.confidence > "FeedGeo".confidence THEN EXCLUDED."coverageType"
          ELSE "FeedGeo"."coverageType"
        END,
        source = CASE
          WHEN EXCLUDED.confidence > "FeedGeo".confidence THEN EXCLUDED.source
          ELSE "FeedGeo".source
        END,
        "updatedAt" = NOW()
    `;

    try {
      await prisma.$executeRawUnsafe(sql);
      totalCreated += batch.length;
    } catch (err: any) {
      console.error(`  ⚠ Batch insert error (batch ${i / BATCH_SIZE}):`, err?.message?.slice(0, 200));
    }
  }

  return totalCreated;
}

// Simple CUID-like ID generator (sufficient for batch inserts)
let counter = 0;
function generateCuid(): string {
  counter++;
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  const cnt = counter.toString(36).padStart(4, '0');
  return `geo${ts}${cnt}${rnd}`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
