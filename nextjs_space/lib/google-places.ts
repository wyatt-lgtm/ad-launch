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
 * Look up a business by its website URL.
 * Extracts domain name, cleans it, and searches Google Places.
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

  // Try searching with the full URL first (Google often matches this)
  const urlResults = await searchPlaces(websiteUrl, 3);
  if (urlResults.length > 0) return urlResults;

  // Fallback: search by domain name (e.g., "sunshinetireandauto.com")
  const domainResults = await searchPlaces(domain, 5);
  return domainResults;
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
