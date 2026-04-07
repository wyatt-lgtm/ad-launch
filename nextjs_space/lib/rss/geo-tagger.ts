/**
 * Phase 4b: Feed & Item Geo-Tagger
 *
 * Assigns geographic scope and coverage to feeds:
 *
 *   1. National feeds (NASA, etc.)  → geoScope='national'
 *      No FeedGeo rows needed — included in all trade area queries.
 *
 *   2. Weather feeds (NWS alerts)   → geoScope='weather'
 *      Matched by pilotState at query time. FeedGeo rows created
 *      for all ZIPs in the alert area state.
 *
 *   3. State-wide feeds             → geoScope='state'
 *      Matched by pilotState. FeedGeo rows for representative
 *      county seats per state (not all 31k ZIPs).
 *
 *   4. Local feeds                  → geoScope='local'
 *      FeedGeo rows created by matching the feed's domain/title
 *      against city/county names in the pilot state, then
 *      expanding to ZIP coverage via the geo hierarchy.
 *
 * The geo hierarchy is:  ZIP ↔ City ↔ County ↔ State
 * Trade area queries walk this tree to find matching feeds.
 */

import { PrismaClient } from '@prisma/client';
import type { GeoScope } from './types';

// ═══════════════════════════════════════════════════════════════
// Scope detection
// ═══════════════════════════════════════════════════════════════

const NATIONAL_DOMAINS = [
  'nasa.gov',
  'jpl.nasa.gov',
  'earthobservatory.nasa.gov',
  'science.nasa.gov',
  'cneos.jpl.nasa.gov',
];

const NWS_ALERT_PATTERN = /api\.weather\.gov\/alerts/i;
const NWS_OFFICE_PATTERN = /weather\.gov\/source\//i;

/**
 * Determine the geoScope for a feed based on its URL and metadata.
 */
export function detectGeoScope(url: string, sourceType: string): GeoScope {
  // National feeds
  for (const domain of NATIONAL_DOMAINS) {
    if (url.includes(domain)) return 'national';
  }

  // NWS weather alerts
  if (NWS_ALERT_PATTERN.test(url) || NWS_OFFICE_PATTERN.test(url)) return 'weather';

  // Fox4 weather category
  if (sourceType === 'weather' && !url.includes('weather.gov')) return 'local';

  return 'local';
}

/**
 * Extract the state code from an NWS alert feed URL.
 * e.g., "https://api.weather.gov/alerts/active.atom?area=CO" → "CO"
 */
export function extractNwsState(url: string): string | null {
  const match = url.match(/[?&]area=([A-Z]{2})/i);
  return match ? match[1].toUpperCase() : null;
}

// ═══════════════════════════════════════════════════════════════
// City/County extraction from feed metadata
// ═══════════════════════════════════════════════════════════════

/**
 * Extract potential city names from a feed's URL and title.
 * Returns normalized uppercase names.
 */
export function extractLocationHints(url: string, title: string | null): string[] {
  const hints: string[] = [];
  const combined = `${url} ${title ?? ''}`;

  // Common patterns in local news URLs/titles:
  // "Denver Post", "colorado springs gazette", "wsvn.com" (Miami)
  // "dailycamera.com" (Boulder), "steamboatpilot.com" (Steamboat Springs)

  // Extract from URL hostname
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    // Strip common suffixes
    const domainBase = hostname.split('.')[0]
      .replace(/news|times|post|herald|gazette|tribune|daily|observer|press|journal|sentinel|sun|star|courier|dispatch|recorder|review|register|examiner|telegraph|chronicle|leader|argus|camera|pilot|beacon|magazine/gi, ' ')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .trim();
    if (domainBase.length >= 3) {
      hints.push(domainBase.toUpperCase());
    }
  } catch { /* ignore */ }

  // Extract from title — look for "City Name" patterns
  if (title) {
    // Remove common suffixes like "News", "RSS Feed", etc.
    const cleaned = title
      .replace(/\b(rss|feed|atom|news|latest|all|content|releases?)\b/gi, '')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .trim();
    if (cleaned.length >= 3) {
      hints.push(cleaned.toUpperCase());
    }
  }

  return hints;
}

// ═══════════════════════════════════════════════════════════════
// Well-known feed → city mappings (curated)
// ═══════════════════════════════════════════════════════════════

/**
 * Hard-coded domain → city+state mappings for feeds where
 * automated extraction is unreliable.
 */
export const DOMAIN_CITY_MAP: Record<string, { cities: string[]; state: string }> = {
  // Colorado
  'denverpost.com':        { cities: ['DENVER'], state: 'CO' },
  'denver7.com':           { cities: ['DENVER'], state: 'CO' },
  '9news.com':             { cities: ['DENVER'], state: 'CO' },
  'kdvr.com':              { cities: ['DENVER'], state: 'CO' },
  'westword.com':          { cities: ['DENVER'], state: 'CO' },
  'coloradosun.com':       { cities: ['DENVER'], state: 'CO' },
  'coloradopolitics.com':  { cities: ['DENVER'], state: 'CO' },
  'dailycamera.com':       { cities: ['BOULDER'], state: 'CO' },
  'gazette.com':           { cities: ['COLORADO SPRINGS'], state: 'CO' },
  'coloradosprings.gov':   { cities: ['COLORADO SPRINGS'], state: 'CO' },
  'elpasoco.com':          { cities: ['COLORADO SPRINGS'], state: 'CO' },
  'steamboatpilot.com':    { cities: ['STEAMBOAT SPRINGS'], state: 'CO' },
  'summitdaily.com':       { cities: ['FRISCO', 'BRECKENRIDGE'], state: 'CO' },
  'vaildaily.com':         { cities: ['VAIL'], state: 'CO' },
  'aspentimes.com':        { cities: ['ASPEN'], state: 'CO' },
  'durangoherald.com':     { cities: ['DURANGO'], state: 'CO' },
  'gjsentinel.com':        { cities: ['GRAND JUNCTION'], state: 'CO' },
  'bouldercounty.gov':     { cities: ['BOULDER'], state: 'CO' },

  // Texas
  'fox4news.com':          { cities: ['DALLAS', 'FORT WORTH'], state: 'TX' },
  'wfaa.com':              { cities: ['DALLAS'], state: 'TX' },
  'khou.com':              { cities: ['HOUSTON'], state: 'TX' },
  'kxan.com':              { cities: ['AUSTIN'], state: 'TX' },
  'texastribune.org':      { cities: ['AUSTIN'], state: 'TX' },
  'texasmonthly.com':      { cities: ['AUSTIN'], state: 'TX' },
  'kut.org':               { cities: ['AUSTIN'], state: 'TX' },
  'houstonpress.com':      { cities: ['HOUSTON'], state: 'TX' },
  'dallasobserver.com':    { cities: ['DALLAS'], state: 'TX' },
  'victoriaadvocate.com':  { cities: ['VICTORIA'], state: 'TX' },

  // Florida
  'orlandosentinel.com':   { cities: ['ORLANDO'], state: 'FL' },
  'sun-sentinel.com':      { cities: ['FORT LAUDERDALE'], state: 'FL' },
  'wsvn.com':              { cities: ['MIAMI'], state: 'FL' },
  'wfla.com':              { cities: ['TAMPA'], state: 'FL' },
  'wlrn.org':              { cities: ['MIAMI'], state: 'FL' },
  'miaminewtimes.com':     { cities: ['MIAMI'], state: 'FL' },
  'floridapolitics.com':   { cities: ['TALLAHASSEE'], state: 'FL' },
  'browardpalmbeach.com':  { cities: ['FORT LAUDERDALE', 'WEST PALM BEACH'], state: 'FL' },
  'sarasotamagazine.com':  { cities: ['SARASOTA'], state: 'FL' },

  // North Carolina
  'journalnow.com':        { cities: ['WINSTON-SALEM', 'WINSTON SALEM'], state: 'NC' },
  'hickoryrecord.com':     { cities: ['HICKORY'], state: 'NC' },
  'indyweek.com':          { cities: ['RALEIGH', 'DURHAM'], state: 'NC' },
  'wunc.org':              { cities: ['CHAPEL HILL'], state: 'NC' },
  'ncnewsline.com':        { cities: ['RALEIGH'], state: 'NC' },
  'greensboro.com':        { cities: ['GREENSBORO'], state: 'NC' },
  'raleighnc.gov':         { cities: ['RALEIGH'], state: 'NC' },

  // Montana
  'missoulian.com':        { cities: ['MISSOULA'], state: 'MT' },
  'bozemandailychronicle.com': { cities: ['BOZEMAN'], state: 'MT' },
  'billingsgazette.com':   { cities: ['BILLINGS'], state: 'MT' },
  'helenair.com':          { cities: ['HELENA'], state: 'MT' },
  'mtstandard.com':        { cities: ['BUTTE'], state: 'MT' },
  'ravallirepublic.com':   { cities: ['HAMILTON'], state: 'MT' },
  'kulr8.com':             { cities: ['BILLINGS'], state: 'MT' },
  'flatheadbeacon.com':    { cities: ['KALISPELL'], state: 'MT' },
  'independent.com':       { cities: ['HELENA'], state: 'MT' },  // Helena Independent Record
  'montanafreepress.org':  { cities: ['HELENA'], state: 'MT' },
  'ktvh.com':              { cities: ['HELENA'], state: 'MT' },
  'kpax.com':              { cities: ['MISSOULA'], state: 'MT' },
  'kbzk.com':              { cities: ['BOZEMAN'], state: 'MT' },
  'mtpr.org':              { cities: ['MISSOULA'], state: 'MT' },
};

// ═══════════════════════════════════════════════════════════════
// FeedGeo assignment
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve city names to ZIP IDs via the geo hierarchy.
 * Returns a map of { zipId, zipCode, confidence }.
 */
export async function resolveCityToZips(
  prisma: PrismaClient,
  cityNames: string[],
  stateCode: string,
): Promise<{ zipId: string; zipCode: string; confidence: number }[]> {
  // Find the state
  const state = await prisma.geoState.findUnique({ where: { code: stateCode } });
  if (!state) return [];

  // Find counties in this state
  const counties = await prisma.geoCounty.findMany({
    where: { stateId: state.id },
    select: { id: true },
  });
  const countyIds = counties.map(c => c.id);

  // Find matching cities
  const results: { zipId: string; zipCode: string; confidence: number }[] = [];
  const seenZips = new Set<string>();

  for (const cityName of cityNames) {
    const cities = await prisma.geoCity.findMany({
      where: {
        name: cityName.toUpperCase(),
        countyId: { in: countyIds },
      },
      include: {
        cityZips: {
          include: { zip: true },
        },
      },
    });

    for (const city of cities) {
      for (const cz of city.cityZips) {
        if (seenZips.has(cz.zip.code)) continue;
        seenZips.add(cz.zip.code);
        results.push({
          zipId: cz.zip.id,
          zipCode: cz.zip.code,
          confidence: cz.isPrimary ? 0.9 : 0.7,
        });
      }
    }
  }

  return results;
}

/**
 * Get all ZIP IDs for a state (for weather/state-scope feeds).
 */
export async function getStateZipIds(
  prisma: PrismaClient,
  stateCode: string,
): Promise<{ zipId: string; zipCode: string }[]> {
  const state = await prisma.geoState.findUnique({ where: { code: stateCode } });
  if (!state) return [];

  const counties = await prisma.geoCounty.findMany({
    where: { stateId: state.id },
    select: { id: true },
  });

  const cities = await prisma.geoCity.findMany({
    where: { countyId: { in: counties.map(c => c.id) } },
    include: { cityZips: { include: { zip: true } } },
  });

  const seen = new Set<string>();
  const results: { zipId: string; zipCode: string }[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (seen.has(cz.zip.code)) continue;
      seen.add(cz.zip.code);
      results.push({ zipId: cz.zip.id, zipCode: cz.zip.code });
    }
  }
  return results;
}

/**
 * Extract the domain from a feed URL for DOMAIN_CITY_MAP lookup.
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return '';
  }
}
