// @ts-nocheck
/**
 * Phase 2: Geography Lookup & Trade Area Queries
 *
 * Provides functions the Tombstone agent (and future RSS feed discovery)
 * can use to resolve trade areas into ZIP code lists.
 *
 * Trade area patterns:
 *   1. Radius from a ZIP centroid (e.g., "all ZIPs within 25 mi of 80903")
 *   2. Explicit ZIP list (e.g., a franchise's known service area)
 *   3. County-level (e.g., "El Paso County, CO")
 *   4. State-level (e.g., "all ZIPs in Montana")
 *   5. City-level (e.g., "Colorado Springs, CO")
 */
// Use rssPrisma (tombstone DB) — geo tables are identical in both DBs
// but RSS reads come from tombstone, so geo lookups should too.
import { rssPrisma as prisma } from '@/lib/rss-db';

// ── Haversine distance (miles) ────────────────────────────────────────────
const R_MILES = 3958.8;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Types ─────────────────────────────────────────────────────────────────
export interface GeoZipResult {
  id: string;
  code: string;
  latitude: number | null;
  longitude: number | null;
  distanceMiles?: number; // only for radius queries
  city?: string;
  county?: string;
  state?: string;
}

export interface TradeAreaSummary {
  zipCount: number;
  zips: GeoZipResult[];
  centerZip?: string;
  radiusMiles?: number;
  queryType: 'radius' | 'zip_list' | 'county' | 'state' | 'city';
}

// ── 1. Radius query ───────────────────────────────────────────────────────
/**
 * Find all delivery-point ZIPs within `radiusMiles` of a center ZIP.
 * Uses a bounding-box pre-filter then Haversine refinement.
 */
export async function getZipsByRadius(
  centerZipCode: string,
  radiusMiles: number = 25
): Promise<TradeAreaSummary> {
  const center = await prisma.geoZip.findUnique({ where: { code: centerZipCode } });
  if (!center || center.latitude == null || center.longitude == null) {
    return { zipCount: 0, zips: [], centerZip: centerZipCode, radiusMiles, queryType: 'radius' };
  }

  // Bounding box (rough filter) — 1 degree lat ≈ 69 mi, 1 degree lon varies
  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / (69 * Math.cos((center.latitude * Math.PI) / 180));

  const candidates = await prisma.geoZip.findMany({
    where: {
      latitude: { gte: center.latitude - latDelta, lte: center.latitude + latDelta },
      longitude: { gte: center.longitude - lonDelta, lte: center.longitude + lonDelta },
    },
  });

  const results: GeoZipResult[] = [];
  for (const z of candidates) {
    if (z.latitude == null || z.longitude == null) continue;
    const dist = haversine(center.latitude, center.longitude, z.latitude, z.longitude);
    if (dist <= radiusMiles) {
      results.push({
        id: z.id,
        code: z.code,
        latitude: z.latitude,
        longitude: z.longitude,
        distanceMiles: Math.round(dist * 10) / 10,
      });
    }
  }

  results.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));

  return {
    zipCount: results.length,
    zips: results,
    centerZip: centerZipCode,
    radiusMiles,
    queryType: 'radius',
  };
}

// ── 2. Explicit ZIP list ──────────────────────────────────────────────────
export async function getZipsByList(zipCodes: string[]): Promise<TradeAreaSummary> {
  const padded = zipCodes.map(z => z.padStart(5, '0'));
  const zips = await prisma.geoZip.findMany({ where: { code: { in: padded } } });

  return {
    zipCount: zips.length,
    zips: zips.map(z => ({ id: z.id, code: z.code, latitude: z.latitude, longitude: z.longitude })),
    queryType: 'zip_list',
  };
}

// ── 3. County lookup ──────────────────────────────────────────────────────
/**
 * Get all ZIPs in a county. Accepts county name + state code or FIPS.
 */
export async function getZipsByCounty(
  countyName: string,
  stateCode: string
): Promise<TradeAreaSummary> {
  const state = await prisma.geoState.findUnique({ where: { code: stateCode.toUpperCase() } });
  if (!state) return { zipCount: 0, zips: [], queryType: 'county' };

  const county = await prisma.geoCounty.findFirst({
    where: { name: countyName.toUpperCase(), stateId: state.id },
  });
  if (!county) return { zipCount: 0, zips: [], queryType: 'county' };

  const cities = await prisma.geoCity.findMany({
    where: { countyId: county.id },
    include: { cityZips: { include: { zip: true } } },
  });

  const seen = new Set<string>();
  const results: GeoZipResult[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (seen.has(cz.zip.code)) continue;
      seen.add(cz.zip.code);
      results.push({
        id: cz.zip.id,
        code: cz.zip.code,
        latitude: cz.zip.latitude,
        longitude: cz.zip.longitude,
        city: city.name,
        county: county.name,
        state: stateCode.toUpperCase(),
      });
    }
  }

  return { zipCount: results.length, zips: results, queryType: 'county' };
}

// ── 3b. County lookup by FIPS (canonical) ────────────────────────────────
/**
 * Get all ZIPs in a county using the full 5-digit FIPS code.
 * This is the canonical county identity — preferred over name-based matching.
 */
export async function getZipsByCountyFips(
  countyFips: string
): Promise<TradeAreaSummary> {
  const county = await prisma.geoCounty.findFirst({
    where: { fipsCode: countyFips },
    include: { state: { select: { code: true } } },
  });
  if (!county) {
    console.warn(`[geo-lookup] getZipsByCountyFips: no county found for FIPS=${countyFips}`);
    return { zipCount: 0, zips: [], queryType: 'county' };
  }

  const cities = await prisma.geoCity.findMany({
    where: { countyId: county.id },
    include: { cityZips: { include: { zip: true } } },
  });

  const seen = new Set<string>();
  const results: GeoZipResult[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (seen.has(cz.zip.code)) continue;
      seen.add(cz.zip.code);
      results.push({
        id: cz.zip.id,
        code: cz.zip.code,
        latitude: cz.zip.latitude,
        longitude: cz.zip.longitude,
        city: city.name,
        county: county.name,
        state: county.state.code,
      });
    }
  }

  return { zipCount: results.length, zips: results, queryType: 'county' };
}

// ── 4. State lookup ───────────────────────────────────────────────────────
export async function getZipsByState(stateCode: string): Promise<TradeAreaSummary> {
  const state = await prisma.geoState.findUnique({ where: { code: stateCode.toUpperCase() } });
  if (!state) return { zipCount: 0, zips: [], queryType: 'state' };

  const counties = await prisma.geoCounty.findMany({ where: { stateId: state.id }, select: { id: true } });
  const countyIds = counties.map(c => c.id);

  const cities = await prisma.geoCity.findMany({
    where: { countyId: { in: countyIds } },
    include: { cityZips: { include: { zip: true } } },
  });

  const seen = new Set<string>();
  const results: GeoZipResult[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (seen.has(cz.zip.code)) continue;
      seen.add(cz.zip.code);
      results.push({
        id: cz.zip.id,
        code: cz.zip.code,
        latitude: cz.zip.latitude,
        longitude: cz.zip.longitude,
      });
    }
  }

  return { zipCount: results.length, zips: results, queryType: 'state' };
}

/**
 * Expand a city name into all common spelling variants.
 * Handles: St. ↔ Saint, St ↔ Saint, Ft. ↔ Fort, Mt. ↔ Mount
 */
export function expandCityNameVariants(name: string): string[] {
  const upper = name.toUpperCase().trim();
  const variants = new Set<string>([upper]);

  // St. Louis → SAINT LOUIS, ST LOUIS, ST. LOUIS
  // Each group generates: abbreviated with period, abbreviated without, and full word
  const groups: [RegExp, string, string, string][] = [
    // pattern, full form, abbrev with period, abbrev without period
    [/\bST\.?\s/g, 'SAINT ', 'ST. ', 'ST '],
    [/\bSAINT\s/g, 'SAINT ', 'ST. ', 'ST '],
    [/\bFT\.?\s/g, 'FORT ', 'FT. ', 'FT '],
    [/\bFORT\s/g, 'FORT ', 'FT. ', 'FT '],
    [/\bMT\.?\s/g, 'MOUNT ', 'MT. ', 'MT '],
    [/\bMOUNT\s/g, 'MOUNT ', 'MT. ', 'MT '],
  ];
  for (const [pat, full, abbrevDot, abbrevNoDot] of groups) {
    if (pat.test(upper)) {
      // Reset lastIndex after test
      pat.lastIndex = 0;
      for (const rep of [full, abbrevDot, abbrevNoDot]) {
        pat.lastIndex = 0;
        const alt = upper.replace(pat, rep).trim();
        if (alt !== upper) variants.add(alt);
      }
    }
  }
  return Array.from(variants);
}

// ── 5. City lookup ────────────────────────────────────────────────────────
export async function getZipsByCity(
  cityName: string,
  stateCode: string
): Promise<TradeAreaSummary> {
  const state = await prisma.geoState.findUnique({ where: { code: stateCode.toUpperCase() } });
  if (!state) return { zipCount: 0, zips: [], queryType: 'city' };

  const counties = await prisma.geoCounty.findMany({ where: { stateId: state.id }, select: { id: true } });
  const countyIds = counties.map(c => c.id);

  // Expand city name variants to handle St./Saint, Ft./Fort, Mt./Mount
  const nameVariants = expandCityNameVariants(cityName);
  console.log(`[geo-lookup] City lookup: input="${cityName}" variants=${JSON.stringify(nameVariants)} state=${stateCode}`);

  const cities = await prisma.geoCity.findMany({
    where: { name: { in: nameVariants }, countyId: { in: countyIds } },
    include: { cityZips: { include: { zip: true } } },
  });

  const seen = new Set<string>();
  const results: GeoZipResult[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (seen.has(cz.zip.code)) continue;
      seen.add(cz.zip.code);
      results.push({
        id: cz.zip.id,
        code: cz.zip.code,
        latitude: cz.zip.latitude,
        longitude: cz.zip.longitude,
        city: city.name,
      });
    }
  }

  return { zipCount: results.length, zips: results, queryType: 'city' };
}

// ── 6. Get ZIP details with full hierarchy ────────────────────────────────
export async function getZipDetails(zipCode: string) {
  const zip = await prisma.geoZip.findUnique({
    where: { code: zipCode.padStart(5, '0') },
    include: {
      cityZips: {
        include: {
          city: {
            include: {
              county: {
                include: { state: true },
              },
            },
          },
        },
      },
    },
  });
  if (!zip) return null;

  const primaryLink = zip.cityZips.find(cz => cz.isPrimary) || zip.cityZips[0];
  return {
    zip: zip.code,
    latitude: zip.latitude,
    longitude: zip.longitude,
    primaryCity: primaryLink?.city.name ?? null,
    county: primaryLink?.city.county.name ?? null,
    countyFips: primaryLink?.city.county.fipsCode ?? null,
    state: primaryLink?.city.county.state.code ?? null,
    stateFips: primaryLink?.city.county.state.fipsCode ?? null,
    stateName: primaryLink?.city.county.state.name ?? null,
    allCities: zip.cityZips.map(cz => ({
      name: cz.city.name,
      isPrimary: cz.isPrimary,
    })),
  };
}

// ── 7. Nearby ZIPs (convenience wrapper) ──────────────────────────────────
export async function getNearbyZips(
  zipCode: string,
  radiusMiles: number = 10,
  limit: number = 50
): Promise<GeoZipResult[]> {
  const result = await getZipsByRadius(zipCode, radiusMiles);
  return result.zips.slice(0, limit);
}

// ── 8. Validate ZIP exists in our delivery-point list ─────────────────────
export async function isValidDeliveryZip(zipCode: string): Promise<boolean> {
  const count = await prisma.geoZip.count({ where: { code: zipCode.padStart(5, '0') } });
  return count > 0;
}

// ── 9. Normalize helpers ──────────────────────────────────────────────────
/** Pad/trim a ZIP to a 5-digit zero-padded string. */
export function normalizeZip(zip: string | number): string {
  return String(zip).trim().padStart(5, '0').slice(0, 5);
}

/** Uppercase + trim a city name to match DB storage convention. */
export function normalizeCity(city: string): string {
  return city.trim().toUpperCase();
}

/** Uppercase + trim a county name to match DB storage convention. */
export function normalizeCounty(county: string): string {
  return county.trim().toUpperCase();
}

// ── 10. FIPS lookups ──────────────────────────────────────────────────────
/**
 * Get the 2-digit state FIPS code for a state abbreviation.
 * Returns null if the state is not found.
 */
export async function getStateFips(stateCode: string): Promise<string | null> {
  const state = await prisma.geoState.findUnique({
    where: { code: stateCode.toUpperCase() },
    select: { fipsCode: true },
  });
  return state?.fipsCode ?? null;
}

/**
 * Get the full 5-digit county FIPS code for a county + state.
 * Returns null if the county or state is not found.
 */
export async function getCountyFips(
  countyName: string,
  stateCode: string
): Promise<string | null> {
  const state = await prisma.geoState.findUnique({
    where: { code: stateCode.toUpperCase() },
    select: { id: true },
  });
  if (!state) return null;

  const county = await prisma.geoCounty.findFirst({
    where: { name: countyName.toUpperCase(), stateId: state.id },
    select: { fipsCode: true },
  });
  return county?.fipsCode ?? null;
}

// ── 11. Lookup wrappers ───────────────────────────────────────────────────
/** Alias for getZipDetails — returns full hierarchy for a single ZIP. */
export const lookupZip = getZipDetails;

/**
 * Look up all ZIPs for a city + state, with county and FIPS info.
 */
export async function lookupCityState(
  cityName: string,
  stateCode: string
): Promise<{
  city: string;
  state: string;
  county: string | null;
  countyFips: string | null;
  stateFips: string | null;
  zips: string[];
} | null> {
  const st = await prisma.geoState.findUnique({
    where: { code: stateCode.toUpperCase() },
    select: { id: true, fipsCode: true },
  });
  if (!st) return null;

  const counties = await prisma.geoCounty.findMany({
    where: { stateId: st.id },
    select: { id: true, name: true, fipsCode: true },
  });
  const countyIds = counties.map(c => c.id);
  if (countyIds.length === 0) return null;

  const nameVariants = expandCityNameVariants(cityName);
  const cities = await prisma.geoCity.findMany({
    where: { name: { in: nameVariants }, countyId: { in: countyIds } },
    include: { cityZips: { include: { zip: true } }, county: true },
  });
  if (cities.length === 0) return null;

  // A city can span multiple counties; pick the first county for the summary
  const primaryCity = cities[0];
  const seen = new Set<string>();
  const zips: string[] = [];
  for (const city of cities) {
    for (const cz of city.cityZips) {
      if (!seen.has(cz.zip.code)) {
        seen.add(cz.zip.code);
        zips.push(cz.zip.code);
      }
    }
  }
  zips.sort();

  return {
    city: primaryCity.name,
    state: stateCode.toUpperCase(),
    county: primaryCity.county.name,
    countyFips: primaryCity.county.fipsCode,
    stateFips: st.fipsCode,
    zips,
  };
}

/**
 * Look up all ZIPs and cities for a county + state, with FIPS info.
 */
export async function lookupCountyState(
  countyName: string,
  stateCode: string
): Promise<{
  county: string;
  state: string;
  countyFips: string | null;
  stateFips: string | null;
  cities: string[];
  zips: string[];
} | null> {
  const st = await prisma.geoState.findUnique({
    where: { code: stateCode.toUpperCase() },
    select: { id: true, fipsCode: true },
  });
  if (!st) return null;

  const county = await prisma.geoCounty.findFirst({
    where: { name: countyName.toUpperCase(), stateId: st.id },
    select: { id: true, name: true, fipsCode: true },
  });
  if (!county) return null;

  const cities = await prisma.geoCity.findMany({
    where: { countyId: county.id },
    include: { cityZips: { include: { zip: true } } },
  });

  const cityNames = new Set<string>();
  const zipCodes = new Set<string>();
  for (const city of cities) {
    cityNames.add(city.name);
    for (const cz of city.cityZips) {
      zipCodes.add(cz.zip.code);
    }
  }

  return {
    county: county.name,
    state: stateCode.toUpperCase(),
    countyFips: county.fipsCode,
    stateFips: st.fipsCode,
    cities: [...cityNames].sort(),
    zips: [...zipCodes].sort(),
  };
}
