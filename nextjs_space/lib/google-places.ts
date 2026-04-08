/**
 * Google Places API (New) — Text Search integration
 * Uses the Places API to find businesses by URL or name+location.
 */

const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText';

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  googleMapsUrl: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string;
  types: string[];
}

function getApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_PLATFORM_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

/** Parse address components from Google Places response */
function parseAddressComponents(components: any[]): { city: string; state: string; zip: string } {
  let city = '';
  let state = '';
  let zip = '';
  for (const c of components ?? []) {
    const types = c.types ?? [];
    if (types.includes('locality')) city = c.longText ?? c.shortText ?? '';
    if (types.includes('administrative_area_level_1')) state = c.shortText ?? '';
    if (types.includes('postal_code')) zip = c.longText ?? c.shortText ?? '';
    // Fallback city from sublocality
    if (!city && types.includes('sublocality_level_1')) city = c.longText ?? c.shortText ?? '';
  }
  return { city, state, zip };
}

/** Convert a Google Places result to our PlaceResult format */
function toPlaceResult(place: any): PlaceResult {
  const { city, state, zip } = parseAddressComponents(place.addressComponents);
  return {
    placeId: place.id ?? '',
    name: place.displayName?.text ?? '',
    formattedAddress: place.formattedAddress ?? '',
    city,
    state,
    zip,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '',
    website: place.websiteUri ?? '',
    googleMapsUrl: place.googleMapsUri ?? '',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ?? 'OPERATIONAL',
    types: place.types ?? [],
  };
}

/**
 * Search for a business on Google Places using Text Search.
 * Can search by URL, name, or name+location.
 */
export async function searchPlaces(query: string, maxResults = 5): Promise<PlaceResult[]> {
  const apiKey = getApiKey();
  if (!apiKey || apiKey === 'PLACEHOLDER_SET_IN_PRODUCTION') {
    console.warn('[google-places] No API key configured, returning empty results');
    return [];
  }

  try {
    const res = await fetch(PLACES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.addressComponents',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.location',
          'places.rating',
          'places.userRatingCount',
          'places.businessStatus',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: maxResults,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[google-places] API error ${res.status}:`, errText.slice(0, 300));
      return [];
    }

    const data = await res.json();
    return (data.places ?? []).map(toPlaceResult);
  } catch (err: any) {
    console.error('[google-places] Request failed:', err?.message);
    return [];
  }
}

/**
 * Extract a human-readable business name from a domain.
 * e.g. "mikeswestsideauto.com" → "mikes westside auto"
 *      "sunshine-tire-and-auto.com" → "sunshine tire and auto"
 */
function domainToBusinessName(domain: string): string {
  // Remove TLD (.com, .net, .org, etc.)
  const base = domain.replace(/\.[a-z]{2,10}$/i, '').toLowerCase();
  // Split on hyphens, underscores
  let parts = base.split(/[-_]+/);
  if (parts.length > 1) {
    return parts.join(' ').trim();
  }

  // Dictionary of common words found in business domain names, longest first
  const dict = [
    'sunshine', 'westside', 'eastside', 'northside', 'southside', 'downtown', 'uptown', 'midtown',
    'automotive', 'electric', 'plumbing', 'roofing', 'heating', 'cooling', 'cleaning', 'painting',
    'restaurant', 'mountain', 'fitness', 'digital', 'express', 'central', 'island', 'golden',
    'silver', 'market', 'dental', 'medical', 'kitchen', 'supply', 'direct', 'design',
    'repair', 'service', 'motors', 'studio', 'valley', 'coast', 'depot', 'house',
    'salon', 'grill', 'pizza', 'photo', 'media', 'works', 'craft', 'build',
    'store', 'quick', 'prime', 'elite', 'royal', 'green', 'bright', 'metro',
    'urban', 'glass', 'parts', 'group', 'scape',
    'auto', 'tire', 'shop', 'body', 'care', 'home', 'land', 'lake',
    'cafe', 'wash', 'tech', 'team', 'zone', 'star',
    'west', 'east', 'north', 'south', 'side', 'city', 'town', 'hill', 'river',
    'guys', 'gals', 'bros',
    'bar', 'pub', 'spa', 'gym', 'pet', 'vet', 'hub', 'pro', 'bay',
    'blue', 'red', 'sun', 'kids', 'baby', 'fast', 'best', 'top', 'first', 'plus',
    'and', 'the',
  ];
  // Sort by length descending to match longest words first
  dict.sort((a, b) => b.length - a.length);

  // Greedy left-to-right matching
  const words: string[] = [];
  let i = 0;
  const str = base;
  while (i < str.length) {
    let matched = false;
    for (const word of dict) {
      if (str.substring(i, i + word.length) === word) {
        words.push(word);
        i += word.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Accumulate unmatched chars into current or new word
      if (words.length > 0 && words[words.length - 1].length < 3) {
        // Append to previous short fragment
        words[words.length - 1] += str[i];
      } else {
        // Start new fragment
        if (words.length > 0) {
          const last = words[words.length - 1];
          // If this is a continuation of the previous unrecognized run, append
          const isLastDict = dict.includes(last);
          if (!isLastDict) {
            words[words.length - 1] += str[i];
          } else {
            words.push(str[i]);
          }
        } else {
          words.push(str[i]);
        }
      }
      i++;
    }
  }

  const result = words.join(' ').replace(/\s+/g, ' ').trim();
  console.log(`[google-places] Domain "${domain}" → business name "${result}"`);
  return result;
}

/**
 * Look up a business by its website URL.
 * Extracts domain name, cleans it, and searches Google Places.
 * Uses multiple strategies from most specific to most creative.
 */
export async function lookupBusinessByUrl(websiteUrl: string): Promise<PlaceResult[]> {
  // Extract a useful search query from the URL
  let domain = '';
  try {
    const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    domain = parsed.hostname.replace(/^www\./, '');
  } catch {
    domain = websiteUrl;
  }

  // Strategy 1: search with the full URL (Google often matches website field)
  console.log(`[google-places] Strategy 1: searching by URL "${websiteUrl}"`);
  const urlResults = await searchPlaces(websiteUrl, 3);
  if (urlResults.length > 0) {
    console.log(`[google-places] Found ${urlResults.length} results by URL`);
    return urlResults;
  }

  // Strategy 2: search by domain name (e.g., "mikeswestsideauto.com")
  console.log(`[google-places] Strategy 2: searching by domain "${domain}"`);
  const domainResults = await searchPlaces(domain, 5);
  if (domainResults.length > 0) {
    console.log(`[google-places] Found ${domainResults.length} results by domain`);
    return domainResults;
  }

  // Strategy 3: extract human-readable name from domain and search
  const businessName = domainToBusinessName(domain);
  if (businessName && businessName !== domain.replace(/\.[a-z]{2,10}$/i, '')) {
    console.log(`[google-places] Strategy 3: searching by extracted name "${businessName}"`);
    const nameResults = await searchPlaces(businessName, 5);
    if (nameResults.length > 0) {
      console.log(`[google-places] Found ${nameResults.length} results by extracted name`);
      return nameResults;
    }
  }

  // Strategy 4: try the domain base without TLD as-is (for short/unique names)
  const domainBase = domain.replace(/\.[a-z]{2,10}$/i, '');
  if (domainBase !== businessName) {
    console.log(`[google-places] Strategy 4: searching by domain base "${domainBase}"`);
    const baseResults = await searchPlaces(domainBase, 5);
    if (baseResults.length > 0) {
      console.log(`[google-places] Found ${baseResults.length} results by domain base`);
      return baseResults;
    }
  }

  // Strategy 5: strip leading single-char fragments and try again
  // e.g. "t tech guys" → "tech guys" (ttechguys.net → The Tech Guys)
  if (businessName) {
    const stripped = businessName.replace(/^\b[a-z]\b\s+/i, '').trim();
    if (stripped && stripped !== businessName && stripped.length > 2) {
      console.log(`[google-places] Strategy 5: searching without leading fragment "${stripped}"`);
      const strippedResults = await searchPlaces(stripped, 5);
      if (strippedResults.length > 0) {
        console.log(`[google-places] Found ${strippedResults.length} results by stripped name`);
        return strippedResults;
      }
      // Also try with "The" prefix (common business name pattern)
      const withThe = `The ${stripped}`;
      console.log(`[google-places] Strategy 5b: searching with "The" prefix "${withThe}"`);
      const theResults = await searchPlaces(withThe, 5);
      if (theResults.length > 0) {
        console.log(`[google-places] Found ${theResults.length} results with "The" prefix`);
        return theResults;
      }
    }
  }

  console.log(`[google-places] No results found for "${websiteUrl}" after all strategies`);
  return [];
}

/**
 * Search for businesses by type + location using Google Places.
 * Used for the business/area lookup feature.
 */
export async function searchBusinessesByTypeAndLocation(
  businessType: string,
  location: string,
  maxResults = 15,
): Promise<PlaceResult[]> {
  const query = `${businessType} in ${location}`;
  return searchPlaces(query, Math.min(maxResults, 20));
}
