// @ts-nocheck
/**
 * County Government RSS Feed Discovery
 *
 * Sweeps county government websites in pilot states for RSS/Atom feeds.
 * Strategy:
 *   1. Query GeoCounty table for all counties in pilot states
 *   2. Build candidate URLs from common county gov domain patterns
 *   3. Probe each for HTML <link rel="alternate"> and common RSS paths
 *   4. Validate discovered feeds are actually RSS/Atom
 *   5. Store in RssFeed table with sourceType='gov_meeting', sourceQuality='official'
 *
 * Usage:
 *   cd nextjs_space && npx tsx scripts/discover-county-gov-feeds.ts           # all pilot states
 *   cd nextjs_space && npx tsx scripts/discover-county-gov-feeds.ts CO TX     # specific states
 */
import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

const PILOT_STATES = ['CO', 'TX', 'FL', 'NC', 'MT'];
const USER_AGENT = 'AdLaunch-GovFeedDiscovery/1.0 (+https://connect.launchmarketing.com)';
const FETCH_TIMEOUT = 10000;
const CONCURRENCY = 5; // parallel county lookups

interface DiscoveredGovFeed {
  url: string;
  title: string;
  siteUrl: string;
  countyName: string;
  stateCode: string;
  discoveryMethod: 'html_link' | 'path_probe' | 'well_known';
}

// ── Common county gov domain patterns ────────────────────────────────────
// Counties use wildly inconsistent domains. These patterns cover ~80% of cases.
function buildCandidateUrls(countyName: string, stateCode: string): string[] {
  const name = countyName.toLowerCase().replace(/[^a-z]/g, '');
  const nameSpaced = countyName.toLowerCase().replace(/\s+/g, '');
  const nameHyphen = countyName.toLowerCase().replace(/\s+/g, '-');
  const st = stateCode.toLowerCase();
  
  // State full names for URL patterns
  const stateNames: Record<string, string> = {
    CO: 'colorado', TX: 'texas', FL: 'florida', NC: 'northcarolina', MT: 'montana',
  };
  const stateFull = stateNames[stateCode] ?? st;
  
  return [
    // Most common .gov patterns
    `https://www.${name}county.gov`,
    `https://${name}county.gov`,
    `https://www.${name}county${st}.gov`,
    `https://${name}county${st}.gov`,
    `https://www.co.${name}.${st}.us`,
    `https://co.${name}.${st}.us`,
    `https://www.${name}.county.gov`,
    
    // .org / .com / .net patterns (many counties use these)
    `https://www.${name}county.org`,
    `https://www.${name}county${st}.org`,
    `https://${name}county.org`,
    
    // State-specific patterns
    `https://www.${name}county.us`,
    `https://www.${nameHyphen}-county.gov`,
    `https://www.${name}countygovernment.com`,
  ];
}

// ── RSS probe paths (gov sites often use these) ──────────────────────────
const GOV_PROBE_PATHS = [
  '/feed',
  '/rss',
  '/rss.xml',
  '/feed.xml',
  '/atom.xml',
  '/index.xml',
  '/news/feed',
  '/news/rss',
  '/news/rss.xml',
  '/press-releases/feed',
  '/updates/feed',
  '/alerts/feed',
  '/blog/feed',
  '/?feed=rss2',
  '/feed/rss',
  '/CivicAlerts.aspx?CID=rss',   // CivicPlus platform (very common)
  '/RSSFeed.aspx',                // CivicPlus
];

async function safeFetch(url: string): Promise<{ ok: boolean; text: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html, application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, text, finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRssContent(text: string): boolean {
  const lower = text.slice(0, 2000).toLowerCase();
  return (
    lower.includes('<rss') ||
    lower.includes('<feed') ||
    lower.includes('<rdf:rdf') ||
    lower.includes('xmlns:atom') ||
    (lower.includes('<channel>') && lower.includes('<item>'))
  );
}

function extractFeedTitle(xmlText: string): string {
  const match = xmlText.match(/<title[^>]*>(?:<\!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

// ── Strategy 1: Extract <link rel="alternate"> from homepage HTML ─────────
async function extractHtmlFeeds(siteUrl: string): Promise<{ url: string; title: string; method: 'html_link' }[]> {
  const result = await safeFetch(siteUrl);
  if (!result?.ok) return [];
  
  const feeds: { url: string; title: string; method: 'html_link' }[] = [];
  try {
    const $ = cheerio.load(result.text);
    $('link[rel="alternate"]').each((_, el) => {
      const type = $(el).attr('type') ?? '';
      const href = $(el).attr('href') ?? '';
      if (
        (type.includes('rss') || type.includes('atom') || type.includes('xml')) &&
        href
      ) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, siteUrl).href;
        feeds.push({
          url: fullUrl,
          title: $(el).attr('title') ?? '',
          method: 'html_link',
        });
      }
    });
    
    // Also check for RSS icon links in the page
    $('a[href*="/feed"], a[href*="/rss"], a[href*="rss.xml"], a[href*="atom.xml"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (href) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, siteUrl).href;
        // Only add if not already found
        if (!feeds.some(f => f.url === fullUrl)) {
          feeds.push({ url: fullUrl, title: $(el).text()?.trim() ?? '', method: 'html_link' });
        }
      }
    });
  } catch { /* cheerio parse error */ }
  return feeds;
}

// ── Strategy 2: Probe common RSS paths ───────────────────────────────────
async function probeRssPaths(siteUrl: string): Promise<{ url: string; title: string; method: 'path_probe' }[]> {
  const feeds: { url: string; title: string; method: 'path_probe' }[] = [];
  const base = siteUrl.replace(/\/$/, '');
  
  // Probe in batches of 4 to be polite
  for (let i = 0; i < GOV_PROBE_PATHS.length; i += 4) {
    const batch = GOV_PROBE_PATHS.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (p) => {
        const url = `${base}${p}`;
        const res = await safeFetch(url);
        if (res?.ok && isRssContent(res.text)) {
          return { url: res.finalUrl, title: extractFeedTitle(res.text), method: 'path_probe' as const };
        }
        return null;
      })
    );
    for (const r of results) {
      if (r && !feeds.some(f => f.url === r.url)) feeds.push(r);
    }
  }
  return feeds;
}

// ── Main: discover feeds for a single county ──────────────────────────────
async function discoverCountyFeeds(
  countyName: string,
  stateCode: string,
): Promise<DiscoveredGovFeed[]> {
  const candidates = buildCandidateUrls(countyName, stateCode);
  const allFeeds: DiscoveredGovFeed[] = [];
  const seenUrls = new Set<string>();
  
  // Try each candidate URL until we find a working county site
  for (const siteUrl of candidates) {
    // Quick reachability check
    const check = await safeFetch(siteUrl);
    if (!check?.ok) continue;
    
    // Found a live county site! Extract feeds.
    // Strategy 1: HTML link extraction
    const htmlFeeds = await extractHtmlFeeds(siteUrl);
    for (const f of htmlFeeds) {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        allFeeds.push({
          url: f.url,
          title: f.title || `${countyName} County, ${stateCode} - News`,
          siteUrl,
          countyName,
          stateCode,
          discoveryMethod: 'html_link',
        });
      }
    }
    
    // Strategy 2: Path probing
    const probeFeeds = await probeRssPaths(siteUrl);
    for (const f of probeFeeds) {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        allFeeds.push({
          url: f.url,
          title: f.title || `${countyName} County, ${stateCode} - Updates`,
          siteUrl,
          countyName,
          stateCode,
          discoveryMethod: 'path_probe',
        });
      }
    }
    
    // If we found a live site, don't try other URL patterns
    if (allFeeds.length > 0 || check.ok) break;
  }
  
  return allFeeds;
}

// ── Validate: confirm feed is actually RSS ────────────────────────────────
async function validateFeed(url: string): Promise<boolean> {
  const res = await safeFetch(url);
  if (!res?.ok) return false;
  return isRssContent(res.text);
}

// ── Batch runner with concurrency control ─────────────────────────────────
async function runBatch<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const requestedStates = process.argv.slice(2).map(s => s.toUpperCase());
  const stateCodes = requestedStates.length > 0
    ? requestedStates.filter(s => PILOT_STATES.includes(s))
    : PILOT_STATES;
  
  if (stateCodes.length === 0) {
    console.error('❌ No valid states. Available:', PILOT_STATES.join(', '));
    process.exit(1);
  }
  
  console.log('\n═══ County Government RSS Feed Discovery ══════════════════════');
  console.log(`States: ${stateCodes.join(', ')}`);
  console.log();
  
  let totalCounties = 0;
  let totalSitesFound = 0;
  let totalFeedsDiscovered = 0;
  let totalFeedsValidated = 0;
  let totalStored = 0;
  let totalDupes = 0;
  
  for (const stateCode of stateCodes) {
    // Get state from DB
    const state = await prisma.geoState.findFirst({ where: { code: stateCode } });
    if (!state) {
      console.log(`⚠️  State ${stateCode} not in GeoState table, skipping`);
      continue;
    }
    
    // Get all counties for this state
    const counties = await prisma.geoCounty.findMany({
      where: { stateId: state.id },
      orderBy: { name: 'asc' },
    });
    
    console.log(`🏛️  ${state.name} (${stateCode}) — ${counties.length} counties`);
    console.log('─'.repeat(60));
    
    totalCounties += counties.length;
    let stateFeeds = 0;
    let stateSites = 0;
    
    // Process counties in batches
    const results = await runBatch(counties, CONCURRENCY, async (county) => {
      const displayName = county.name.split(' ').map(w => 
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(' ');
      
      const feeds = await discoverCountyFeeds(displayName, stateCode);
      
      if (feeds.length > 0) {
        console.log(`  ✅ ${displayName} County — ${feeds.length} feed(s) [${feeds.map(f => f.discoveryMethod).join(', ')}]`);
      } else {
        // Try to determine if the site exists but has no feeds
        const candidates = buildCandidateUrls(displayName, stateCode);
        let siteExists = false;
        for (const url of candidates.slice(0, 3)) {
          const check = await safeFetch(url);
          if (check?.ok) { siteExists = true; break; }
        }
        if (siteExists) {
          console.log(`  🔍 ${displayName} County — site found but no RSS`);
          return { feeds: [], siteFound: true };
        } else {
          // Don't log every missing county to keep output manageable
        }
      }
      
      return { feeds, siteFound: feeds.length > 0 };
    });
    
    // Flatten and collect stats
    const allStateFeeds: DiscoveredGovFeed[] = [];
    for (const r of results) {
      if (r.siteFound) stateSites++;
      allStateFeeds.push(...r.feeds);
    }
    
    // Validate feeds actually return RSS content
    console.log(`\n  Validating ${allStateFeeds.length} discovered feeds...`);
    const validFeeds: DiscoveredGovFeed[] = [];
    for (const feed of allStateFeeds) {
      const valid = await validateFeed(feed.url);
      if (valid) {
        validFeeds.push(feed);
      } else {
        console.log(`  ❌ Invalid RSS: ${feed.url}`);
      }
    }
    
    // Store in DB
    let stored = 0;
    let dupes = 0;
    for (const feed of validFeeds) {
      const normalizedUrl = feed.url.replace(/\/$/, '');
      const existing = await prisma.rssFeed.findFirst({
        where: { url: normalizedUrl },
      });
      if (existing) {
        dupes++;
        continue;
      }
      
      await prisma.rssFeed.create({
        data: {
          url: normalizedUrl,
          title: feed.title || `${feed.countyName} County, ${feed.stateCode}`,
          description: `Government RSS feed for ${feed.countyName} County, ${feed.stateCode}`,
          siteUrl: feed.siteUrl,
          sourceType: 'gov_meeting',
          sourceQuality: 'official',
          status: 'pending',
          pilotState: feed.stateCode,
          geoScope: 'local',
        },
      });
      stored++;
    }
    
    console.log(`\n  ${stateCode} Summary:`);
    console.log(`    Counties scanned: ${counties.length}`);
    console.log(`    Sites reachable:  ${stateSites}`);
    console.log(`    Feeds discovered: ${allStateFeeds.length}`);
    console.log(`    Feeds validated:  ${validFeeds.length}`);
    console.log(`    Stored (new):     ${stored}`);
    console.log(`    Duplicates:       ${dupes}`);
    console.log();
    
    totalSitesFound += stateSites;
    totalFeedsDiscovered += allStateFeeds.length;
    totalFeedsValidated += validFeeds.length;
    totalStored += stored;
    totalDupes += dupes;
    stateFeeds = validFeeds.length;
  }
  
  console.log('═'.repeat(60));
  console.log('  COUNTY GOV RSS DISCOVERY COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  States swept:       ${stateCodes.length}`);
  console.log(`  Counties scanned:   ${totalCounties}`);
  console.log(`  Gov sites found:    ${totalSitesFound}`);
  console.log(`  Feeds discovered:   ${totalFeedsDiscovered}`);
  console.log(`  Feeds validated:    ${totalFeedsValidated}`);
  console.log(`  New feeds stored:   ${totalStored}`);
  console.log(`  Duplicates skipped: ${totalDupes}`);
  console.log('═'.repeat(60));
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
