// @ts-nocheck
/**
 * Feed → Geography Linking Engine
 *
 * Responsibilities:
 *   1. Validate a discovered feed (fetch + parse, check it has recent items)
 *   2. Create FeedGeo links so radius/city/county/state queries find the feed
 *   3. Infer geo scope from feed metadata, URL, title, domain
 *   4. Known-domain registry for deterministic discovery
 *   5. Backfill FeedGeo for existing feeds that lack geo links
 */
import { prisma } from '@/lib/db';
import { getZipsByCity, getZipsByCounty, getZipsByState, getZipDetails } from './geo-lookup';
import type { DiscoveredFeed } from './discovery';
import { canonicalizeFeedUrl } from './discovery';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeoLinkResult {
  feedId: string;
  feedUrl: string;
  feedTitle: string;
  geoScope: 'zip' | 'city' | 'county' | 'state' | 'national';
  geoLinksCreated: number;
  linkedZipCodes: string[];
  reason: string;
}

export interface HierarchicalLinkResult {
  totalLinksCreated: number;
  byLevel: {
    zip: number;
    city: number;
    county: number;
    state: number;
  };
  zipCodes: string[];
}

export interface FeedValidation {
  valid: boolean;
  url: string;
  title: string | null;
  itemCount: number;
  mostRecentItem: string | null;
  reason: string;
}

export interface DiscoveryResult {
  feedsDiscovered: number;
  feedsValidated: number;
  feedsSaved: number;
  feedGeoLinksCreated: number;
  feedsSkippedDuplicate: number;
  feedsSkippedInvalid: number;
  details: {
    url: string;
    title: string | null;
    status: 'saved' | 'duplicate' | 'invalid' | 'error';
    geoLinksCreated: number;
    reason: string;
  }[];
}

// ── Known Local News Domains ──────────────────────────────────────────────
// These are real, widely-used local/regional news platforms.
// The format is a function that generates candidate URLs given city/state info.

const KNOWN_PLATFORMS = [
  // Patch.com (hyperlocal network)
  (city: string, _state: string) => `https://patch.com/${_state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '')}`,
  // Local TV station patterns (common call-sign patterns — probed, not guaranteed)
];

// Major known news domains by state — these have RSS feeds
const KNOWN_STATE_DOMAINS: Record<string, string[]> = {
  NY: [
    'https://www.nytimes.com/section/nyregion',
    'https://gothamist.com',
    'https://www.newsday.com',
    'https://www.lohud.com',
    'https://www.syracuse.com',
    'https://www.democratandchronicle.com',
    'https://buffalonews.com',
    'https://www.timesunion.com',
  ],
  TX: ['https://www.texastribune.org', 'https://www.dallasnews.com', 'https://www.houstonchronicle.com'],
  FL: ['https://www.sun-sentinel.com', 'https://www.miamiherald.com', 'https://www.tampabay.com'],
  CA: ['https://www.latimes.com', 'https://www.sfchronicle.com', 'https://www.sacbee.com'],
  CO: ['https://www.denverpost.com', 'https://coloradosun.com', 'https://gazette.com'],
  PA: ['https://www.inquirer.com', 'https://www.post-gazette.com'],
  IL: ['https://www.chicagotribune.com', 'https://chicago.suntimes.com'],
  OH: ['https://www.cleveland.com', 'https://www.dispatch.com', 'https://www.cincinnati.com'],
  MI: ['https://www.freep.com', 'https://www.detroitnews.com', 'https://www.mlive.com'],
  NC: ['https://www.charlotteobserver.com', 'https://www.newsobserver.com'],
  GA: ['https://www.ajc.com'],
  WA: ['https://www.seattletimes.com'],
  MA: ['https://www.bostonglobe.com', 'https://www.boston.com'],
  AZ: ['https://www.azcentral.com'],
  MT: ['https://billingsgazette.com', 'https://missoulian.com', 'https://helenair.com'],
};

// City-specific known domains
const KNOWN_CITY_DOMAINS: Record<string, string[]> = {
  'BUFFALO,NY': ['https://buffalonews.com', 'https://www.wgrz.com', 'https://www.wivb.com', 'https://www.buffalobusinessfirst.com'],
  'ROCHESTER,NY': ['https://www.democratandchronicle.com', 'https://www.rochesterfirst.com'],
  'SYRACUSE,NY': ['https://www.syracuse.com'],
  'ALBANY,NY': ['https://www.timesunion.com'],
  'NEW YORK,NY': ['https://gothamist.com', 'https://www.amny.com', 'https://www.thecity.nyc'],
  'DALLAS,TX': ['https://www.dallasnews.com', 'https://www.dallasobserver.com'],
  'HOUSTON,TX': ['https://www.houstonchronicle.com', 'https://www.click2houston.com'],
  'MIAMI,FL': ['https://www.miamiherald.com', 'https://www.local10.com'],
  'DENVER,CO': ['https://www.denverpost.com', 'https://www.westword.com'],
  'CHICAGO,IL': ['https://www.chicagotribune.com', 'https://chicago.suntimes.com', 'https://blockclubchicago.org'],
};

// ── Feed Validation ───────────────────────────────────────────────────────

const VALIDATION_USER_AGENT = 'AdLaunch-FeedValidator/1.0 (+https://connect.launchmarketing.com)';
const VALIDATION_TIMEOUT = 10000;

/**
 * Validate that a URL is actually a working RSS/Atom feed with recent items.
 */
export async function validateFeed(feedUrl: string): Promise<FeedValidation> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': VALIDATION_USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { valid: false, url: feedUrl, title: null, itemCount: 0, mostRecentItem: null, reason: `HTTP ${res.status}` };
    }

    const text = await res.text();
    const trimmed = text.trim().slice(0, 1000).toLowerCase();

    // Must look like XML feed
    const isFeed = trimmed.includes('<rss') || trimmed.includes('<feed') ||
      trimmed.includes('<rdf:rdf') || (trimmed.includes('<?xml') && (trimmed.includes('<channel') || trimmed.includes('<entry')));

    if (!isFeed) {
      return { valid: false, url: feedUrl, title: null, itemCount: 0, mostRecentItem: null, reason: 'Not an XML feed' };
    }

    // Parse to count items
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
    const parsed = parser.parse(text);

    let title: string | null = null;
    let itemCount = 0;
    let mostRecentItem: string | null = null;

    // RSS 2.0
    const channel = parsed?.rss?.channel;
    if (channel) {
      title = channel.title || null;
      const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
      itemCount = items.length;
      if (items[0]?.pubDate) mostRecentItem = items[0].pubDate;
      else if (items[0]?.['dc:date']) mostRecentItem = items[0]['dc:date'];
    }

    // Atom
    const feed = parsed?.feed;
    if (feed && !channel) {
      title = typeof feed.title === 'string' ? feed.title : feed.title?.['#text'] || null;
      const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
      itemCount = entries.length;
      if (entries[0]?.updated) mostRecentItem = entries[0].updated;
      else if (entries[0]?.published) mostRecentItem = entries[0].published;
    }

    if (itemCount === 0) {
      return { valid: false, url: feedUrl, title, itemCount: 0, mostRecentItem: null, reason: 'Feed has zero items' };
    }

    return { valid: true, url: feedUrl, title, itemCount, mostRecentItem, reason: 'OK' };
  } catch (err: any) {
    return { valid: false, url: feedUrl, title: null, itemCount: 0, mostRecentItem: null, reason: err.message?.slice(0, 100) || 'Unknown error' };
  }
}

// ── FeedGeo Link Creation ─────────────────────────────────────────────────

/**
 * Create FeedGeo links for a feed at the specified scope.
 * Returns the number of links created.
 */
export async function createFeedGeoLinks(
  feedId: string,
  scope: { type: 'zip' | 'city' | 'county' | 'state'; city?: string; county?: string; state?: string; zip?: string },
  options: { confidence?: number; source?: string; maxLinksPerScope?: number } = {},
): Promise<{ linksCreated: number; zipCodes: string[] }> {
  const { confidence = 0.5, source = 'auto_discovery', maxLinksPerScope = 200 } = options;
  let zipIds: { id: string; code: string }[] = [];

  try {
    switch (scope.type) {
      case 'zip': {
        if (!scope.zip) return { linksCreated: 0, zipCodes: [] };
        const zip = await prisma.geoZip.findUnique({ where: { code: scope.zip.padStart(5, '0') }, select: { id: true, code: true } });
        if (zip) zipIds = [zip];
        break;
      }
      case 'city': {
        if (!scope.city || !scope.state) return { linksCreated: 0, zipCodes: [] };
        const result = await getZipsByCity(scope.city, scope.state);
        zipIds = result.zips.map(z => ({ id: z.id, code: z.code }));
        break;
      }
      case 'county': {
        if (!scope.county || !scope.state) return { linksCreated: 0, zipCodes: [] };
        const result = await getZipsByCounty(scope.county, scope.state);
        zipIds = result.zips.map(z => ({ id: z.id, code: z.code }));
        break;
      }
      case 'state': {
        if (!scope.state) return { linksCreated: 0, zipCodes: [] };
        const result = await getZipsByState(scope.state);
        // For state-level, only link to a sample of ZIPs (one per major city) to avoid massive row counts
        const sampled = result.zips.slice(0, maxLinksPerScope);
        zipIds = sampled.map(z => ({ id: z.id, code: z.code }));
        break;
      }
    }

    if (zipIds.length === 0) return { linksCreated: 0, zipCodes: [] };

    // Batch create, skip duplicates
    let created = 0;
    const linkedCodes: string[] = [];
    const BATCH_SIZE = 50;

    for (let i = 0; i < zipIds.length; i += BATCH_SIZE) {
      const batch = zipIds.slice(i, i + BATCH_SIZE);
      for (const zip of batch) {
        try {
          await prisma.feedGeo.create({
            data: {
              feedId,
              zipId: zip.id,
              coverageType: scope.type === 'zip' ? 'confirmed' : 'inferred',
              confidence,
              source,
            },
          });
          created++;
          linkedCodes.push(zip.code);
        } catch (err: any) {
          // Unique constraint violation — already linked
          if (err?.code === 'P2002') continue;
          console.warn(`[geo-linker] Could not link feed ${feedId} to ZIP ${zip.code}:`, err.message);
        }
      }
    }

    return { linksCreated: created, zipCodes: linkedCodes };
  } catch (err: any) {
    console.error(`[geo-linker] createFeedGeoLinks error:`, err.message);
    return { linksCreated: 0, zipCodes: [] };
  }
}

// ── Infer Geo Scope from Feed Metadata ────────────────────────────────────

/**
 * Attempt to infer the geographic scope and location from a feed's metadata.
 * Uses title, URL/domain, pilotState, and known patterns.
 */
export function inferGeoFromFeed(feed: {
  url: string;
  title?: string | null;
  siteUrl?: string | null;
  pilotState?: string | null;
  notes?: string | null;
}): {
  scope: 'city' | 'county' | 'state' | 'national' | 'unknown';
  city?: string;
  county?: string;
  state?: string;
  confidence: number;
  reason: string;
} {
  const titleLower = (feed.title || '').toLowerCase();
  const urlLower = (feed.url || '').toLowerCase();
  const siteLower = (feed.siteUrl || feed.url || '').toLowerCase();
  const notesLower = (feed.notes || '').toLowerCase();

  // Check for national scope indicators
  if (
    titleLower.includes('national') ||
    titleLower.includes('usa today') ||
    titleLower.includes('associated press') ||
    titleLower.includes('reuters') ||
    titleLower.includes('cnn') ||
    titleLower.includes('fox news') ||
    titleLower.includes('nbc news') ||
    titleLower.includes('abc news') ||
    titleLower.includes('cbs news')
  ) {
    return { scope: 'national', confidence: 0.9, reason: 'National news outlet' };
  }

  // State-level patterns
  const STATE_NAMES: Record<string, string> = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY'
  };

  // Known city→domain patterns
  const CITY_DOMAIN_MAP: Record<string, { city: string; state: string }> = {
    'buffalonews.com': { city: 'BUFFALO', state: 'NY' },
    'wgrz.com': { city: 'BUFFALO', state: 'NY' },
    'wivb.com': { city: 'BUFFALO', state: 'NY' },
    'buffalobusinessfirst.com': { city: 'BUFFALO', state: 'NY' },
    'syracuse.com': { city: 'SYRACUSE', state: 'NY' },
    'democratandchronicle.com': { city: 'ROCHESTER', state: 'NY' },
    'timesunion.com': { city: 'ALBANY', state: 'NY' },
    'gothamist.com': { city: 'NEW YORK', state: 'NY' },
    'dallasnews.com': { city: 'DALLAS', state: 'TX' },
    'houstonchronicle.com': { city: 'HOUSTON', state: 'TX' },
    'miamiherald.com': { city: 'MIAMI', state: 'FL' },
    'denverpost.com': { city: 'DENVER', state: 'CO' },
    'chicagotribune.com': { city: 'CHICAGO', state: 'IL' },
    'latimes.com': { city: 'LOS ANGELES', state: 'CA' },
    'sfchronicle.com': { city: 'SAN FRANCISCO', state: 'CA' },
    'seattletimes.com': { city: 'SEATTLE', state: 'WA' },
    'bostonglobe.com': { city: 'BOSTON', state: 'MA' },
    'azcentral.com': { city: 'PHOENIX', state: 'AZ' },
    'cleveland.com': { city: 'CLEVELAND', state: 'OH' },
    'freep.com': { city: 'DETROIT', state: 'MI' },
    'detroitnews.com': { city: 'DETROIT', state: 'MI' },
    'inquirer.com': { city: 'PHILADELPHIA', state: 'PA' },
    'post-gazette.com': { city: 'PITTSBURGH', state: 'PA' },
    'charlotteobserver.com': { city: 'CHARLOTTE', state: 'NC' },
    'ajc.com': { city: 'ATLANTA', state: 'GA' },
  };

  // Check known domain map
  for (const [domain, geo] of Object.entries(CITY_DOMAIN_MAP)) {
    if (siteLower.includes(domain) || urlLower.includes(domain)) {
      return { scope: 'city', city: geo.city, state: geo.state, confidence: 0.85, reason: `Known domain: ${domain}` };
    }
  }

  // Check Patch.com pattern (patch.com/STATE/CITY)
  const patchMatch = siteLower.match(/patch\.com\/([a-z-]+)\/([a-z-]+)/);
  if (patchMatch) {
    const citySlug = patchMatch[2].replace(/-/g, ' ').toUpperCase();
    // Try to resolve the state abbreviation
    const stateSlug = patchMatch[1].replace(/-/g, ' ');
    const stateCode = STATE_NAMES[stateSlug] || feed.pilotState;
    if (stateCode) {
      return { scope: 'city', city: citySlug, state: stateCode, confidence: 0.75, reason: 'Patch.com city pattern' };
    }
  }

  // Check for state names in title
  for (const [stateName, stateCode] of Object.entries(STATE_NAMES)) {
    if (titleLower.includes(stateName) || notesLower.includes(stateName)) {
      return { scope: 'state', state: stateCode, confidence: 0.5, reason: `State name in title/notes: ${stateName}` };
    }
  }

  // Use pilotState if available
  if (feed.pilotState) {
    return { scope: 'state', state: feed.pilotState, confidence: 0.4, reason: `pilotState: ${feed.pilotState}` };
  }

  return { scope: 'unknown', confidence: 0, reason: 'Could not infer geo from metadata' };
}

// ── Discovery + Validation + Linking ──────────────────────────────────────

/**
 * Full pipeline: discover feeds for a location, validate each one,
 * save to RssFeed, and create FeedGeo links.
 */
export async function discoverValidateAndLink(
  location: { zip?: string | null; city?: string | null; county?: string | null; state?: string | null },
): Promise<DiscoveryResult> {
  const { discoverFeedsFromSites } = await import('./discovery');

  const result: DiscoveryResult = {
    feedsDiscovered: 0,
    feedsValidated: 0,
    feedsSaved: 0,
    feedGeoLinksCreated: 0,
    feedsSkippedDuplicate: 0,
    feedsSkippedInvalid: 0,
    details: [],
  };

  const city = location.city?.toUpperCase() || null;
  const county = location.county?.toUpperCase() || null;
  const state = location.state?.toUpperCase() || null;
  const locationLabel = [city, state].filter(Boolean).join(', ') || location.zip || 'unknown';

  console.log(`[geo-linker] Starting discovery for: ${locationLabel}`);

  // ── Build candidate site list ─────────────────────────────────────────
  const candidateSites = new Set<string>();

  // 1. Known city domains
  if (city && state) {
    const key = `${city},${state}`;
    const knownCity = KNOWN_CITY_DOMAINS[key];
    if (knownCity) knownCity.forEach(s => candidateSites.add(s));

    // Platform generators
    for (const gen of KNOWN_PLATFORMS) {
      candidateSites.add(gen(city, state));
    }

    // Generic city-name patterns
    const citySlug = city.toLowerCase().replace(/\s+/g, '');
    candidateSites.add(`https://www.${citySlug}news.com`);
    candidateSites.add(`https://www.${citySlug}press.com`);
    candidateSites.add(`https://www.${citySlug}times.com`);
    candidateSites.add(`https://www.${citySlug}herald.com`);
    candidateSites.add(`https://www.${citySlug}gazette.com`);
    candidateSites.add(`https://www.${citySlug}tribune.com`);
    candidateSites.add(`https://www.${citySlug}post.com`);
    candidateSites.add(`https://www.${citySlug}daily.com`);
    candidateSites.add(`https://www.${citySlug}observer.com`);
  }

  // 2. Known state domains
  if (state) {
    const knownState = KNOWN_STATE_DOMAINS[state];
    if (knownState) knownState.forEach(s => candidateSites.add(s));
  }

  // 3. County patterns
  if (county && state) {
    const countySlug = county.toLowerCase().replace(/\s+/g, '').replace(/county$/i, '');
    candidateSites.add(`https://www.${countySlug}countynews.com`);
    candidateSites.add(`https://www.${countySlug}county.gov`);
  }

  const sitesArray = Array.from(candidateSites).slice(0, 25); // cap at 25
  if (sitesArray.length === 0) {
    console.log(`[geo-linker] No candidate sites for ${locationLabel}`);
    return result;
  }

  console.log(`[geo-linker] Probing ${sitesArray.length} candidate sites for ${locationLabel}`);

  // ── Discover feeds from candidate sites ─────────────────────────────
  let discovered: DiscoveredFeed[] = [];
  try {
    discovered = await discoverFeedsFromSites(sitesArray, 3);
  } catch (err: any) {
    console.error(`[geo-linker] Batch discovery failed:`, err.message);
    return result;
  }

  result.feedsDiscovered = discovered.length;
  console.log(`[geo-linker] Discovered ${discovered.length} candidate feeds for ${locationLabel}`);

  // ── Validate, save, and link each feed ──────────────────────────────
  for (const feed of discovered) {
    const canonical = canonicalizeFeedUrl(feed.url);

    // Check for existing feed
    const existing = await prisma.rssFeed.findUnique({ where: { url: canonical } });
    if (existing) {
      result.feedsSkippedDuplicate++;
      // Even if feed exists, ensure it has FeedGeo links
      const existingGeoCount = await prisma.feedGeo.count({ where: { feedId: existing.id } });
      if (existingGeoCount === 0) {
        const geoLinks = await linkFeedToLocation(existing.id, location);
        result.feedGeoLinksCreated += geoLinks;
        result.details.push({
          url: canonical, title: existing.title, status: 'duplicate',
          geoLinksCreated: geoLinks, reason: `Already exists (id=${existing.id}), added ${geoLinks} geo links`,
        });
      } else {
        result.details.push({
          url: canonical, title: existing.title, status: 'duplicate',
          geoLinksCreated: 0, reason: `Already exists with ${existingGeoCount} geo links`,
        });
      }
      continue;
    }

    // Validate the feed
    const validation = await validateFeed(canonical);
    result.feedsValidated++;

    if (!validation.valid) {
      result.feedsSkippedInvalid++;
      result.details.push({
        url: canonical, title: validation.title, status: 'invalid',
        geoLinksCreated: 0, reason: validation.reason,
      });
      continue;
    }

    // Infer geo scope from feed metadata
    const geoInference = inferGeoFromFeed({ url: canonical, title: validation.title, siteUrl: feed.siteUrl });

    // Save the feed
    try {
      const newFeed = await prisma.rssFeed.create({
        data: {
          url: canonical,
          title: validation.title || `Discovered: ${feed.siteUrl}`,
          siteUrl: feed.siteUrl,
          description: feed.description,
          language: feed.language,
          feedFormat: feed.feedFormat,
          sourceType: 'local_news',
          sourceQuality: 'unverified',
          status: 'active', // Validated feeds go active immediately
          geoScope: geoInference.scope === 'unknown' ? 'local' : geoInference.scope,
          discoveredBy: 'auto_scout',
          discoveryMethod: feed.discoveryMethod,
          discoveredAt: new Date(),
          pilotState: geoInference.state || state || null,
          notes: `Auto-discovered for ${locationLabel}. Validation: ${validation.itemCount} items, most recent: ${validation.mostRecentItem || 'unknown'}`,
        },
      });

      result.feedsSaved++;

      // Create FeedGeo links
      const geoLinks = await linkFeedToLocation(newFeed.id, {
        ...location,
        // Override with inferred geo if more specific
        city: geoInference.city || location.city,
        state: geoInference.state || location.state,
      });

      result.feedGeoLinksCreated += geoLinks;
      result.details.push({
        url: canonical, title: validation.title, status: 'saved',
        geoLinksCreated: geoLinks, reason: `OK: ${validation.itemCount} items, geo=${geoInference.scope}(${geoInference.reason})`,
      });

    } catch (err: any) {
      result.details.push({
        url: canonical, title: validation.title, status: 'error',
        geoLinksCreated: 0, reason: err.message?.slice(0, 100) || 'Save error',
      });
    }
  }

  console.log(
    `[geo-linker] Done for ${locationLabel}: ` +
    `${result.feedsSaved} saved, ${result.feedGeoLinksCreated} geo links, ` +
    `${result.feedsSkippedDuplicate} dupes, ${result.feedsSkippedInvalid} invalid`
  );

  return result;
}

/**
 * Create FeedGeo links for a feed at ALL levels of the hierarchy.
 * A city-level feed gets: city ZIPs + county ZIPs + state sample ZIPs.
 * A county-level feed gets: county ZIPs + state sample ZIPs.
 * A zip-level feed gets: zip + city + county + state.
 * Returns total links created with per-level breakdown.
 */
async function linkFeedToLocation(
  feedId: string,
  location: { zip?: string | null; city?: string | null; county?: string | null; state?: string | null },
): Promise<number> {
  const result = await createHierarchicalLinks(feedId, location);
  return result.totalLinksCreated;
}

/**
 * Hierarchical link creation: creates FeedGeo rows at every geo level
 * from the most specific scope upward to state.
 */
export async function createHierarchicalLinks(
  feedId: string,
  location: { zip?: string | null; city?: string | null; county?: string | null; state?: string | null },
  options: { confidence?: number; source?: string } = {},
): Promise<HierarchicalLinkResult> {
  const { confidence = 0.6, source = 'auto_discovery' } = options;
  const result: HierarchicalLinkResult = {
    totalLinksCreated: 0,
    byLevel: { zip: 0, city: 0, county: 0, state: 0 },
    zipCodes: [],
  };

  const city = location.city?.toUpperCase() || null;
  const state = location.state?.toUpperCase() || null;
  const zip = location.zip || null;

  // Resolve county from city if not provided
  let county = location.county?.toUpperCase() || null;
  if (!county && city && state) {
    try {
      // Look up county from city's geo data
      const cityZips = await getZipsByCity(city, state);
      if (cityZips.zips.length > 0) {
        const zipDetails = await getZipDetails(cityZips.zips[0].code);
        if (zipDetails?.county) county = zipDetails.county.toUpperCase();
      }
    } catch { /* ignore */ }
  }
  if (!county && zip) {
    try {
      const zipDetails = await getZipDetails(zip);
      if (zipDetails?.county) county = zipDetails.county.toUpperCase();
    } catch { /* ignore */ }
  }

  // ── Level 1: ZIP-level link ───────────────────────────────────────
  if (zip) {
    const { linksCreated, zipCodes } = await createFeedGeoLinks(feedId, {
      type: 'zip', zip,
    }, { confidence, source: `${source}_zip` });
    result.byLevel.zip += linksCreated;
    result.totalLinksCreated += linksCreated;
    result.zipCodes.push(...zipCodes);
  }

  // ── Level 2: City-level links ──────────────────────────────────────
  if (city && state) {
    const { linksCreated, zipCodes } = await createFeedGeoLinks(feedId, {
      type: 'city', city, state,
    }, { confidence, source: `${source}_city`, maxLinksPerScope: 200 });
    result.byLevel.city += linksCreated;
    result.totalLinksCreated += linksCreated;
    result.zipCodes.push(...zipCodes);
  }

  // ── Level 3: County-level links ────────────────────────────────────
  if (county && state) {
    const { linksCreated, zipCodes } = await createFeedGeoLinks(feedId, {
      type: 'county', county, state,
    }, { confidence: Math.max(confidence - 0.1, 0.3), source: `${source}_county`, maxLinksPerScope: 100 });
    result.byLevel.county += linksCreated;
    result.totalLinksCreated += linksCreated;
    result.zipCodes.push(...zipCodes);
  }

  // ── Level 4: State-level links (small sample) ──────────────────────
  if (state) {
    const { linksCreated, zipCodes } = await createFeedGeoLinks(feedId, {
      type: 'state', state,
    }, { confidence: Math.max(confidence - 0.2, 0.2), source: `${source}_state`, maxLinksPerScope: 30 });
    result.byLevel.state += linksCreated;
    result.totalLinksCreated += linksCreated;
    result.zipCodes.push(...zipCodes);
  }

  console.log(
    `[geo-linker] Hierarchical links for feed ${feedId}: ` +
    `zip=${result.byLevel.zip} city=${result.byLevel.city} ` +
    `county=${result.byLevel.county} state=${result.byLevel.state} ` +
    `total=${result.totalLinksCreated}`
  );

  return result;
}

// ── Backfill Existing Feeds ───────────────────────────────────────────────

/**
 * Find all feeds without FeedGeo links and attempt to infer + create links.
 * Returns a report of what was done.
 */
export async function backfillFeedGeo(options: {
  dryRun?: boolean;
  limit?: number;
  state?: string;
}): Promise<{
  totalFeedsChecked: number;
  feedsLinked: number;
  feedsSkipped: number;
  feedsUncertain: number;
  totalGeoLinksCreated: number;
  details: { feedId: string; url: string; title: string; action: string; geoLinksCreated: number; reason: string }[];
}> {
  const { dryRun = false, limit = 100, state: filterState } = options;

  // Find feeds without any FeedGeo links
  const where: any = {
    feedGeos: { none: {} },
    status: { not: 'blocked' },
  };
  if (filterState) {
    where.pilotState = filterState.toUpperCase();
  }

  const feeds = await prisma.rssFeed.findMany({
    where,
    select: { id: true, url: true, title: true, siteUrl: true, pilotState: true, notes: true, geoScope: true },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  const report = {
    totalFeedsChecked: feeds.length,
    feedsLinked: 0,
    feedsSkipped: 0,
    feedsUncertain: 0,
    totalGeoLinksCreated: 0,
    details: [] as { feedId: string; url: string; title: string; action: string; geoLinksCreated: number; reason: string }[],
  };

  for (const feed of feeds) {
    const inferred = inferGeoFromFeed(feed);

    if (inferred.scope === 'unknown' || inferred.confidence < 0.3) {
      report.feedsUncertain++;
      report.details.push({
        feedId: feed.id, url: feed.url, title: feed.title || '',
        action: 'uncertain', geoLinksCreated: 0, reason: inferred.reason,
      });
      continue;
    }

    if (inferred.scope === 'national') {
      // National feeds don't need FeedGeo links — they're included via geoScope='national'
      report.feedsSkipped++;
      report.details.push({
        feedId: feed.id, url: feed.url, title: feed.title || '',
        action: 'skipped_national', geoLinksCreated: 0, reason: 'National scope — no FeedGeo needed',
      });

      // Update geoScope if not already set
      if (feed.geoScope !== 'national') {
        if (!dryRun) {
          await prisma.rssFeed.update({ where: { id: feed.id }, data: { geoScope: 'national' } });
        }
      }
      continue;
    }

    if (dryRun) {
      report.details.push({
        feedId: feed.id, url: feed.url, title: feed.title || '',
        action: 'would_link', geoLinksCreated: 0,
        reason: `${inferred.scope}: ${inferred.city || inferred.county || inferred.state} (${inferred.reason})`,
      });
      continue;
    }

    // Create hierarchical FeedGeo links (all levels from inferred scope upward)
    const location: any = {};
    if (inferred.city) location.city = inferred.city;
    if (inferred.county) location.county = inferred.county;
    if (inferred.state) location.state = inferred.state;

    const hierarchyResult = await createHierarchicalLinks(feed.id, location, {
      confidence: inferred.confidence,
      source: 'backfill',
    });
    const linksCreated = hierarchyResult.totalLinksCreated;

    // Update feed pilotState if not set
    if (inferred.state && !feed.pilotState) {
      await prisma.rssFeed.update({ where: { id: feed.id }, data: { pilotState: inferred.state } });
    }

    report.feedsLinked++;
    report.totalGeoLinksCreated += linksCreated;
    report.details.push({
      feedId: feed.id, url: feed.url, title: feed.title || '',
      action: 'linked', geoLinksCreated: linksCreated,
      reason: `${inferred.scope}: ${inferred.city || inferred.county || inferred.state} (${inferred.reason}) [hierarchy: city=${hierarchyResult.byLevel.city} county=${hierarchyResult.byLevel.county} state=${hierarchyResult.byLevel.state}]`,
    });
  }

  console.log(
    `[geo-linker] Backfill: ${report.feedsLinked} linked (${report.totalGeoLinksCreated} FeedGeo rows), ` +
    `${report.feedsUncertain} uncertain, ${report.feedsSkipped} skipped`
  );

  return report;
}

// ── Backfill Hierarchical FeedGeo Links ───────────────────────────────────

/**
 * Backfill missing hierarchical FeedGeo links for feeds that already have
 * some FeedGeo rows but are missing parent-level (county/state) links.
 * E.g. a feed linked to Buffalo city ZIPs but not to Erie County or NY State ZIPs.
 */
export async function backfillHierarchicalGeoLinks(options: {
  dryRun?: boolean;
  limit?: number;
  state?: string;
}): Promise<{
  feedsChecked: number;
  feedsUpdated: number;
  newLinksCreated: { zip: number; city: number; county: number; state: number; total: number };
  details: { feedId: string; url: string; title: string; existingLinks: number; newLinks: HierarchicalLinkResult }[];
}> {
  const { dryRun = false, limit = 200, state: filterState } = options;

  // Find feeds that HAVE FeedGeo links (backfill adds missing hierarchy levels)
  const where: any = { status: { not: 'blocked' }, feedGeos: { some: {} } };
  if (filterState) where.pilotState = filterState.toUpperCase();

  const feeds = await prisma.rssFeed.findMany({
    where,
    select: {
      id: true, url: true, title: true, siteUrl: true, pilotState: true,
      notes: true, geoScope: true,
      feedGeos: { select: { zipId: true }, take: 1 },
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  const report = {
    feedsChecked: feeds.length,
    feedsUpdated: 0,
    newLinksCreated: { zip: 0, city: 0, county: 0, state: 0, total: 0 },
    details: [] as any[],
  };

  for (const feed of feeds) {
    // Get existing link count
    const existingCount = await prisma.feedGeo.count({ where: { feedId: feed.id } });

    // Infer the feed's geo location
    const inferred = inferGeoFromFeed(feed);
    if (inferred.scope === 'unknown' || inferred.scope === 'national') continue;

    // Build location from inferred data
    const location: { zip?: string | null; city?: string | null; county?: string | null; state?: string | null } = {
      city: inferred.city || null,
      county: inferred.county || null,
      state: inferred.state || feed.pilotState || null,
    };

    // If we only have state but no city, try to resolve from an existing FeedGeo ZIP
    if (!location.city && feed.feedGeos.length > 0) {
      const existingZip = await prisma.geoZip.findUnique({
        where: { id: feed.feedGeos[0].zipId },
        select: { code: true },
      });
      if (existingZip) {
        const details = await getZipDetails(existingZip.code);
        if (details) {
          if (!location.city) location.city = details.primaryCity;
          if (!location.county) location.county = details.county;
          if (!location.state) location.state = details.state;
        }
      }
    }

    if (!location.state) continue; // Can't do hierarchy without state

    if (dryRun) {
      report.details.push({
        feedId: feed.id, url: feed.url, title: feed.title || '',
        existingLinks: existingCount, newLinks: { totalLinksCreated: 0, byLevel: { zip: 0, city: 0, county: 0, state: 0 }, zipCodes: [] },
      });
      continue;
    }

    // Create hierarchical links (createFeedGeoLinks handles duplicates via P2002)
    const hierarchyResult = await createHierarchicalLinks(feed.id, location, {
      confidence: inferred.confidence,
      source: 'backfill_hierarchy',
    });

    if (hierarchyResult.totalLinksCreated > 0) {
      report.feedsUpdated++;
      report.newLinksCreated.zip += hierarchyResult.byLevel.zip;
      report.newLinksCreated.city += hierarchyResult.byLevel.city;
      report.newLinksCreated.county += hierarchyResult.byLevel.county;
      report.newLinksCreated.state += hierarchyResult.byLevel.state;
      report.newLinksCreated.total += hierarchyResult.totalLinksCreated;

      report.details.push({
        feedId: feed.id, url: feed.url, title: feed.title || '',
        existingLinks: existingCount, newLinks: hierarchyResult,
      });
    }
  }

  console.log(
    `[geo-linker] Hierarchy backfill: ${report.feedsUpdated}/${report.feedsChecked} feeds updated, ` +
    `${report.newLinksCreated.total} new links (city=${report.newLinksCreated.city} county=${report.newLinksCreated.county} state=${report.newLinksCreated.state})`
  );

  return report;
}

// ── Geo Coverage Report ───────────────────────────────────────────────────

export async function getGeoCoverageReport(location?: { zip?: string; city?: string; county?: string; state?: string }) {
  // Overall stats
  const [totalFeeds, activeFeedsCount, totalGeoLinks, feedsWithoutGeo] = await Promise.all([
    prisma.rssFeed.count(),
    prisma.rssFeed.count({ where: { status: 'active' } }),
    prisma.feedGeo.count(),
    prisma.rssFeed.count({ where: { feedGeos: { none: {} }, status: { not: 'blocked' } } }),
  ]);

  // Feeds by state (via pilotState)
  const feedsByState = await prisma.rssFeed.groupBy({
    by: ['pilotState'],
    _count: true,
    where: { pilotState: { not: null }, status: 'active' },
    orderBy: { _count: { pilotState: 'desc' } },
  });

  // States with zero feeds
  const coveredStates = new Set(feedsByState.map(r => r.pilotState));
  const allStates = await prisma.geoState.findMany({ select: { code: true, name: true } });
  const uncoveredStates = allStates.filter(s => !coveredStates.has(s.code));

  // Location-specific check
  let locationCoverage = null;
  if (location?.zip || location?.city || location?.state) {
    const zipCode = location.zip;
    let details: any = null;
    if (zipCode) {
      details = await getZipDetails(zipCode);
    }

    const city = location.city?.toUpperCase() || details?.primaryCity || null;
    const county = location.county?.toUpperCase() || details?.county || null;
    const state = location.state?.toUpperCase() || details?.state || null;

    // Feeds with FeedGeo links to this ZIP
    let zipFeedCount = 0;
    if (zipCode) {
      const zip = await prisma.geoZip.findUnique({ where: { code: zipCode.padStart(5, '0') }, select: { id: true } });
      if (zip) {
        zipFeedCount = await prisma.feedGeo.count({ where: { zipId: zip.id } });
      }
    }

    // Feeds for city
    let cityFeedCount = 0;
    if (city && state) {
      const cityZips = await getZipsByCity(city, state);
      if (cityZips.zips.length > 0) {
        cityFeedCount = await prisma.feedGeo.count({
          where: { zipId: { in: cityZips.zips.map(z => z.id) } },
        });
      }
    }

    // Feeds for state via pilotState
    let stateFeedCount = 0;
    if (state) {
      stateFeedCount = await prisma.rssFeed.count({
        where: { pilotState: state, status: 'active' },
      });
    }

    // National feeds
    const nationalFeedCount = await prisma.rssFeed.count({
      where: { geoScope: 'national', status: 'active' },
    });

    // Count unique feeds at each level (not just FeedGeo row count)
    let zipUniqueFeedCount = 0;
    if (zipCode) {
      const zip = await prisma.geoZip.findUnique({ where: { code: zipCode.padStart(5, '0') }, select: { id: true } });
      if (zip) {
        const zipFeeds = await prisma.feedGeo.findMany({
          where: { zipId: zip.id },
          select: { feedId: true },
          distinct: ['feedId'],
        });
        zipUniqueFeedCount = zipFeeds.length;
      }
    }

    let cityUniqueFeedCount = 0;
    if (city && state) {
      const cityZipsResult = await getZipsByCity(city, state);
      if (cityZipsResult.zips.length > 0) {
        const cityFeeds = await prisma.feedGeo.findMany({
          where: { zipId: { in: cityZipsResult.zips.map(z => z.id) } },
          select: { feedId: true },
          distinct: ['feedId'],
        });
        cityUniqueFeedCount = cityFeeds.length;
      }
    }

    let countyUniqueFeedCount = 0;
    if (county && state) {
      const countyZipsResult = await getZipsByCounty(county, state);
      if (countyZipsResult.zips.length > 0) {
        const countyFeeds = await prisma.feedGeo.findMany({
          where: { zipId: { in: countyZipsResult.zips.map(z => z.id) } },
          select: { feedId: true },
          distinct: ['feedId'],
        });
        countyUniqueFeedCount = countyFeeds.length;
      }
    }

    let stateUniqueFeedCount = 0;
    if (state) {
      const stateZipsResult = await getZipsByState(state);
      if (stateZipsResult.zips.length > 0) {
        // Sample first 500 ZIPs to avoid huge query
        const sampleIds = stateZipsResult.zips.slice(0, 500).map(z => z.id);
        const stateFeeds = await prisma.feedGeo.findMany({
          where: { zipId: { in: sampleIds } },
          select: { feedId: true },
          distinct: ['feedId'],
        });
        stateUniqueFeedCount = stateFeeds.length;
      }
    }

    locationCoverage = {
      zip: zipCode || null,
      city,
      county,
      state,
      zipFeedGeoLinks: zipFeedCount,
      cityFeedGeoLinks: cityFeedCount,
      stateFeedsViaPilotState: stateFeedCount,
      nationalFeeds: nationalFeedCount,
      hierarchy: {
        zipFeeds: zipUniqueFeedCount,
        cityFeeds: cityUniqueFeedCount,
        countyFeeds: countyUniqueFeedCount,
        stateFeeds: stateUniqueFeedCount,
        nationalFeeds: nationalFeedCount,
        totalUsable: Math.max(zipUniqueFeedCount, cityUniqueFeedCount, countyUniqueFeedCount, stateUniqueFeedCount) + nationalFeedCount,
        cascadeHealthy: stateUniqueFeedCount >= countyUniqueFeedCount && countyUniqueFeedCount >= cityUniqueFeedCount,
      },
      hasCoverage: zipFeedCount > 0 || cityFeedCount > 0 || stateFeedCount > 0 || nationalFeedCount > 0,
      recommendation: zipFeedCount > 0 ? 'Good coverage' :
        cityFeedCount > 0 ? 'City-level coverage only' :
        stateFeedCount > 0 ? 'State-level coverage only' :
        nationalFeedCount > 0 ? 'National feeds only — run discovery' :
        'Zero coverage — run discovery immediately',
    };
  }

  // Recent discovery attempts (feeds discovered in last 7 days)
  const recentDiscoveries = await prisma.rssFeed.findMany({
    where: { discoveredBy: { in: ['auto_scout', 'manual_discovery'] }, discoveredAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    select: { id: true, url: true, title: true, status: true, pilotState: true, discoveryMethod: true, discoveredAt: true, geoScope: true },
    orderBy: { discoveredAt: 'desc' },
    take: 50,
  });

  return {
    overview: {
      totalFeeds,
      activeFeeds: activeFeedsCount,
      totalGeoLinks,
      feedsWithoutGeo,
    },
    feedsByState: feedsByState.map(r => ({ state: r.pilotState, count: r._count })),
    uncoveredStates: uncoveredStates.map(s => ({ code: s.code, name: s.name })),
    locationCoverage,
    recentDiscoveries,
  };
}
