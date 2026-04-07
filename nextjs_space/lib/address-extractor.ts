/**
 * Address auto-extractor for business websites.
 * Layers:
 *   1. Schema.org JSON-LD (LocalBusiness, Organization, etc.)
 *   2. <address> tag and footer text pattern matching
 *   3. Regex street/city/state/zip extraction from full page
 *
 * Used during SEO audit to pre-populate the business location for
 * RSS geo-tagging by Tombstone research agents.
 */

export interface ExtractedAddress {
  businessName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  source: 'schema_org' | 'address_tag' | 'footer_parse' | 'regex_fallback' | 'none';
  confidence: number; // 0-1
}

const EMPTY: ExtractedAddress = {
  businessName: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  source: 'none',
  confidence: 0,
};

/* ── US state abbreviation map ──────────────────────────────────── */
const STATE_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};
const VALID_STATES = new Set(Object.values(STATE_ABBR));

function normalizeState(raw: string): string {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (VALID_STATES.has(upper)) return upper;
  return STATE_ABBR[trimmed.toLowerCase()] ?? '';
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
}

/* ── Phone extraction ───────────────────────────────────────────── */
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

function extractPhone(text: string): string {
  const m = text.match(PHONE_RE);
  return m ? m[0].replace(/[^\d+]/g, '').replace(/^1(\d{10})$/, '$1') : '';
}

/* ── Layer 1: Schema.org JSON-LD ────────────────────────────────── */
function fromSchemaOrg(html: string): ExtractedAddress | null {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : data?.['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        const types = [].concat(item?.['@type'] ?? []);
        const hasLocalType = types.some((t: string) =>
          /localbusiness|organization|store|restaurant|hotel|medicalclinic|dentist|lawfirm|realestateagent|autodealer|financialservice/i.test(t)
        );
        if (!hasLocalType) continue;

        const addr = item.address ?? item.location?.address;
        if (!addr) continue;

        const state = normalizeState(addr.addressRegion ?? '');
        const zip = (addr.postalCode ?? '').replace(/[^\d-]/g, '').slice(0, 10);
        if (!state && !zip) continue;

        return {
          businessName: cleanText(item.name ?? ''),
          address: cleanText(addr.streetAddress ?? ''),
          city: cleanText(addr.addressLocality ?? ''),
          state,
          zip,
          phone: extractPhone(item.telephone ?? ''),
          source: 'schema_org',
          confidence: 0.95,
        };
      }
    } catch { /* malformed JSON-LD, skip */ }
  }
  return null;
}

/* ── Layer 2: <address> tags ────────────────────────────────────── */
function fromAddressTag(html: string): ExtractedAddress | null {
  const addrRe = /<address[^>]*>([\s\S]*?)<\/address>/gi;
  let m: RegExpExecArray | null;
  while ((m = addrRe.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ');
    const result = parseAddressText(text);
    if (result) return { ...result, source: 'address_tag', confidence: 0.8 };
  }
  return null;
}

/* ── Layer 3: Footer text patterns ──────────────────────────────── */
function fromFooter(html: string): ExtractedAddress | null {
  // Try to isolate footer region
  const footerRe = /<footer[^>]*>([\s\S]*?)<\/footer>/gi;
  let m: RegExpExecArray | null;
  while ((m = footerRe.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ');
    const result = parseAddressText(text);
    if (result) return { ...result, source: 'footer_parse', confidence: 0.65 };
  }
  return null;
}

/* ── Layer 4: Full-page regex fallback ──────────────────────────── */
function fromFullPage(html: string): ExtractedAddress | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  const result = parseAddressText(text);
  if (result) return { ...result, source: 'regex_fallback', confidence: 0.4 };
  return null;
}

/* ── Shared address text parser ─────────────────────────────────── */
const STATE_PATTERN = `(?:${Object.values(STATE_ABBR).join('|')}|${Object.keys(STATE_ABBR).map(s => s.replace(/\s/g, '\\s+')).join('|')})`;
// Match: City, ST ZIP  or  City, State ZIP
const CITY_STATE_ZIP_RE = new RegExp(
  `([A-Z][a-zA-Z .'-]{1,30})\\s*,\\s*(${STATE_PATTERN})\\.?\\s+(\\d{5}(?:-\\d{4})?)`,
  'i'
);
// Street pattern: number + street name
const STREET_RE = /\d{1,6}\s+[A-Z][a-zA-Z0-9 .#'-]{3,50}(?:(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Circle|Cir|Place|Pl|Trail|Trl|Parkway|Pkwy|Highway|Hwy)\.?)/i;

function parseAddressText(text: string): Omit<ExtractedAddress, 'source' | 'confidence'> | null {
  const cleaned = cleanText(text);
  const csz = cleaned.match(CITY_STATE_ZIP_RE);
  if (!csz) return null;

  const city = cleanText(csz[1]);
  const state = normalizeState(csz[2]);
  const zip = csz[3];
  if (!state) return null;

  const streetMatch = cleaned.match(STREET_RE);
  const address = streetMatch ? cleanText(streetMatch[0]) : '';
  const phone = extractPhone(cleaned);

  return { businessName: '', address, city, state, zip, phone };
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Extract a structured business address from raw HTML.
 * Tries Schema.org JSON-LD first, then <address> tags, footer, and regex fallback.
 */
export function extractBusinessAddress(html: string): ExtractedAddress {
  return fromSchemaOrg(html)
    ?? fromAddressTag(html)
    ?? fromFooter(html)
    ?? fromFullPage(html)
    ?? { ...EMPTY };
}

/**
 * Parse a freeform geo string from the research pipeline (e.g. "Denver, CO")
 * into structured fields. Used as a fallback when HTML extraction fails.
 */
export function parseGeoString(geo: string): Pick<ExtractedAddress, 'city' | 'state' | 'zip'> {
  if (!geo || typeof geo !== 'string') return { city: '', state: '', zip: '' };
  const trimmed = geo.trim();

  // Try "City, ST ZIP"
  const full = trimmed.match(CITY_STATE_ZIP_RE);
  if (full) {
    return { city: cleanText(full[1]), state: normalizeState(full[2]), zip: full[3] };
  }

  // Try "City, ST" or "City, State"
  const cityState = trimmed.match(new RegExp(`^([A-Za-z .'-]+),\\s*(${STATE_PATTERN})$`, 'i'));
  if (cityState) {
    return { city: cleanText(cityState[1]), state: normalizeState(cityState[2]), zip: '' };
  }

  // Try bare state
  const st = normalizeState(trimmed);
  if (st) return { city: '', state: st, zip: '' };

  return { city: '', state: '', zip: '' };
}
