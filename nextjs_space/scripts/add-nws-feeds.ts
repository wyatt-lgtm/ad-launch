/**
 * Add National Weather Service feeds for pilot states.
 *
 * Two feed types:
 *   1. State-level active alerts (Atom) — api.weather.gov/alerts/active.atom?area=XX
 *   2. Per-WFO Area Forecast Discussion (RSS) — weather.gov/source/{WFO}/rss/AFD/AFD.xml
 *   3. Per-WFO hazardous weather outlook — weather.gov/source/{WFO}/rss/HWO/HWO.xml
 *
 * Also probes each WFO RSS landing page for additional feeds.
 *
 * Usage: cd nextjs_space && npx tsx scripts/add-nws-feeds.ts
 */
import { PrismaClient } from '@prisma/client';
import { discoverFromHtml, canonicalizeFeedUrl } from '../lib/rss/discovery';

const prisma = new PrismaClient();

// WFO offices per pilot state
const NWS_OFFICES: Record<string, { label: string; wfos: { id: string; name: string }[] }> = {
  CO: {
    label: 'Colorado',
    wfos: [
      { id: 'BOU', name: 'Denver/Boulder' },
      { id: 'GJT', name: 'Grand Junction' },
      { id: 'PUB', name: 'Pueblo' },
    ],
  },
  TX: {
    label: 'Texas',
    wfos: [
      { id: 'FWD', name: 'Fort Worth/Dallas' },
      { id: 'HGX', name: 'Houston/Galveston' },
      { id: 'EWX', name: 'Austin/San Antonio' },
      { id: 'AMA', name: 'Amarillo' },
      { id: 'LUB', name: 'Lubbock' },
      { id: 'MAF', name: 'Midland/Odessa' },
      { id: 'SJT', name: 'San Angelo' },
      { id: 'BRO', name: 'Brownsville' },
      { id: 'CRP', name: 'Corpus Christi' },
      { id: 'EPZ', name: 'El Paso' },
    ],
  },
  FL: {
    label: 'Florida',
    wfos: [
      { id: 'JAX', name: 'Jacksonville' },
      { id: 'KEY', name: 'Key West' },
      { id: 'MLB', name: 'Melbourne' },
      { id: 'MFL', name: 'Miami' },
      { id: 'TAE', name: 'Tallahassee' },
      { id: 'TBW', name: 'Tampa Bay' },
    ],
  },
  NC: {
    label: 'North Carolina',
    wfos: [
      { id: 'RAH', name: 'Raleigh' },
      { id: 'MHX', name: 'Newport/Morehead City' },
      { id: 'ILM', name: 'Wilmington' },
    ],
  },
  MT: {
    label: 'Montana',
    wfos: [
      { id: 'BYZ', name: 'Billings' },
      { id: 'GGW', name: 'Glasgow' },
      { id: 'TFX', name: 'Great Falls' },
      { id: 'MSO', name: 'Missoula' },
    ],
  },
};

interface FeedToAdd {
  url: string;
  title: string;
  description: string;
  siteUrl: string;
  sourceType: string;
  sourceQuality: string;
  discoveryMethod: string;
  feedFormat: string;
  pilotState: string;
  language: string;
}

async function upsertFeed(feed: FeedToAdd): Promise<boolean> {
  const canonical = canonicalizeFeedUrl(feed.url);
  const existing = await prisma.rssFeed.findUnique({ where: { url: canonical } });
  if (existing) return false;

  await prisma.rssFeed.create({
    data: {
      url: canonical,
      title: feed.title,
      description: feed.description,
      siteUrl: feed.siteUrl,
      sourceType: feed.sourceType,
      sourceQuality: feed.sourceQuality,
      status: 'pending',
      discoveryMethod: feed.discoveryMethod,
      feedFormat: feed.feedFormat,
      pilotState: feed.pilotState,
      language: 'en',
    },
  });
  return true;
}

async function main() {
  console.log('\n\u2550\u2550\u2550 NWS Feed Import \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  let added = 0;
  let skipped = 0;

  for (const [stateCode, state] of Object.entries(NWS_OFFICES)) {
    console.log(`\n\ud83c\udf24\ufe0f  ${state.label} (${stateCode})`);
    console.log('\u2500'.repeat(50));

    // 1. State-level active alerts Atom feed
    const alertUrl = `https://api.weather.gov/alerts/active.atom?area=${stateCode}`;
    const alertAdded = await upsertFeed({
      url: alertUrl,
      title: `NWS Active Alerts — ${state.label}`,
      description: `All active weather watches, warnings, and advisories for ${state.label} from the National Weather Service.`,
      siteUrl: `https://www.weather.gov/alerts?area=${stateCode}`,
      sourceType: 'weather',
      sourceQuality: 'official',
      discoveryMethod: 'curated',
      feedFormat: 'atom',
      pilotState: stateCode,
      language: 'en',
    });
    console.log(`  ${alertAdded ? '\u2705' : '\u23ed'} State alerts: ${alertUrl}`);
    alertAdded ? added++ : skipped++;

    // 2. Per-WFO feeds
    for (const wfo of state.wfos) {
      const wfoLower = wfo.id.toLowerCase();

      // Area Forecast Discussion
      const afdUrl = `https://www.weather.gov/source/${wfoLower}/rss/AFD/AFD.xml`;
      const afdAdded = await upsertFeed({
        url: afdUrl,
        title: `NWS ${wfo.name} — Area Forecast Discussion`,
        description: `In-depth forecast discussion from NWS ${wfo.name} WFO (${wfo.id}).`,
        siteUrl: `https://www.weather.gov/${wfoLower}`,
        sourceType: 'weather',
        sourceQuality: 'official',
        discoveryMethod: 'curated',
        feedFormat: 'rss2',
        pilotState: stateCode,
        language: 'en',
      });
      console.log(`  ${afdAdded ? '\u2705' : '\u23ed'} ${wfo.id} AFD: ${afdUrl}`);
      afdAdded ? added++ : skipped++;

      // Hazardous Weather Outlook
      const hwoUrl = `https://www.weather.gov/source/${wfoLower}/rss/HWO/HWO.xml`;
      const hwoAdded = await upsertFeed({
        url: hwoUrl,
        title: `NWS ${wfo.name} — Hazardous Weather Outlook`,
        description: `Hazardous weather outlook from NWS ${wfo.name} WFO (${wfo.id}).`,
        siteUrl: `https://www.weather.gov/${wfoLower}`,
        sourceType: 'weather',
        sourceQuality: 'official',
        discoveryMethod: 'curated',
        feedFormat: 'rss2',
        pilotState: stateCode,
        language: 'en',
      });
      console.log(`  ${hwoAdded ? '\u2705' : '\u23ed'} ${wfo.id} HWO: ${hwoUrl}`);
      hwoAdded ? added++ : skipped++;

      // Local Storm Reports
      const lsrUrl = `https://www.weather.gov/source/${wfoLower}/rss/LSR/LSR.xml`;
      const lsrAdded = await upsertFeed({
        url: lsrUrl,
        title: `NWS ${wfo.name} — Local Storm Reports`,
        description: `Local storm reports from NWS ${wfo.name} WFO (${wfo.id}).`,
        siteUrl: `https://www.weather.gov/${wfoLower}`,
        sourceType: 'weather',
        sourceQuality: 'official',
        discoveryMethod: 'curated',
        feedFormat: 'rss2',
        pilotState: stateCode,
        language: 'en',
      });
      console.log(`  ${lsrAdded ? '\u2705' : '\u23ed'} ${wfo.id} LSR: ${lsrUrl}`);
      lsrAdded ? added++ : skipped++;

      // Probe the WFO RSS landing page for any additional feeds
      try {
        const rssPageUrl = `https://www.weather.gov/${wfoLower}/rss`;
        const htmlFeeds = await discoverFromHtml(rssPageUrl);
        for (const hf of htmlFeeds) {
          const hfAdded = await upsertFeed({
            url: hf.url,
            title: hf.title || `NWS ${wfo.name} Feed`,
            description: `Discovered from NWS ${wfo.name} RSS page.`,
            siteUrl: rssPageUrl,
            sourceType: 'weather',
            sourceQuality: 'official',
            discoveryMethod: 'html_link',
            feedFormat: hf.feedFormat || 'rss2',
            pilotState: stateCode,
            language: 'en',
          });
          if (hfAdded) {
            console.log(`  \u2705 ${wfo.id} discovered: ${hf.title || hf.url}`);
            added++;
          }
        }
      } catch {
        // skip if RSS page probe fails
      }
    }
  }

  // Summary
  const totalWeather = await prisma.rssFeed.count({ where: { sourceType: 'weather' } });
  const totalAll = await prisma.rssFeed.count();

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  NWS Import Complete');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(`  Added:           ${added}`);
  console.log(`  Skipped (dupes): ${skipped}`);
  console.log(`  Weather feeds:   ${totalWeather}`);
  console.log(`  Total feeds:     ${totalAll}`);
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
}

main()
  .catch((e) => {
    console.error('\u274c NWS import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
