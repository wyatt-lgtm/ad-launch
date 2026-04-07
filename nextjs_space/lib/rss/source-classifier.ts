/**
 * Phase 3: Source Classifier
 *
 * Classifies RSS feeds by sourceType and sourceQuality
 * using URL patterns, domain analysis, and feed metadata.
 */
import type { SourceType, SourceQuality } from './types';

interface ClassificationResult {
  sourceType: SourceType;
  sourceQuality: SourceQuality;
  confidence: number; // 0-1
  reason: string;
}

// ── Domain pattern matchers ───────────────────────────────────────────────
const DOMAIN_PATTERNS: { pattern: RegExp; type: SourceType; quality: SourceQuality; reason: string }[] = [
  // Government
  { pattern: /\.gov($|\/)/i,                          type: 'gov_meeting',           quality: 'official',   reason: '.gov domain' },
  { pattern: /\.(state|county|city)\./i,              type: 'gov_meeting',           quality: 'official',   reason: 'government subdomain' },
  { pattern: /cityof[a-z]+\.(com|org|net)/i,          type: 'gov_meeting',           quality: 'official',   reason: 'city government site' },

  // Schools / Education
  { pattern: /\.edu($|\/)/i,                          type: 'school',                quality: 'official',   reason: '.edu domain' },
  { pattern: /\.k12\./i,                               type: 'school',                quality: 'official',   reason: 'K-12 school district' },
  { pattern: /school|isd|unified|district/i,           type: 'school',                quality: 'official',   reason: 'school district keyword' },

  // Local News (newspapers)
  { pattern: /gazette|herald|tribune|times|post|journal|sentinel|observer|chronicle|dispatch|courier|recorder|democrat|republican|star|sun|examiner|register|press|review|telegraph|argus|leader|news(?!week)/i,
    type: 'local_news', quality: 'trusted', reason: 'newspaper name pattern' },

  // TV Stations
  { pattern: /k[a-z]{2,3}\.(com|tv)/i,               type: 'local_news',            quality: 'trusted',    reason: 'TV station call sign (K*)' },
  { pattern: /w[a-z]{2,3}\.(com|tv)/i,               type: 'local_news',            quality: 'trusted',    reason: 'TV station call sign (W*)' },
  { pattern: /nbc|cbs|abc|fox.*local|local.*fox/i,    type: 'local_news',            quality: 'trusted',    reason: 'network affiliate' },

  // Radio
  { pattern: /radio|fm\d|am\d|npr\.org/i,             type: 'local_news',            quality: 'community',  reason: 'radio station' },

  // Community / Hyperlocal
  { pattern: /patch\.com/i,                            type: 'community',             quality: 'community',  reason: 'Patch.com hyperlocal' },
  { pattern: /nextdoor\.com/i,                         type: 'community',             quality: 'community',  reason: 'Nextdoor community' },

  // Chamber of Commerce
  { pattern: /chamber/i,                               type: 'chamber_of_commerce',   quality: 'official',   reason: 'Chamber of Commerce' },

  // Events
  { pattern: /eventbrite|meetup\.com|events\./i,       type: 'event',                 quality: 'community',  reason: 'event platform' },
  { pattern: /calendar|events|whatson/i,                type: 'event',                 quality: 'community',  reason: 'events keyword in URL' },

  // Weather
  { pattern: /weather|forecast|noaa\.gov|nws\./i,      type: 'weather',               quality: 'official',   reason: 'weather service' },

  // Sports
  { pattern: /sports|athletics|varsity|maxpreps/i,     type: 'sports_local',          quality: 'community',  reason: 'sports keyword' },

  // Library
  { pattern: /library|librar/i,                        type: 'library',               quality: 'official',   reason: 'library keyword' },

  // Parks & Rec
  { pattern: /parks|recreation|trails/i,               type: 'parks_rec',             quality: 'official',   reason: 'parks/recreation keyword' },

  // Real Estate
  { pattern: /realtor|realty|zillow|homes|housing/i,   type: 'real_estate',           quality: 'community',  reason: 'real estate keyword' },

  // Church / Religious
  { pattern: /church|parish|temple|mosque|synagogue|ministry/i, type: 'church', quality: 'community', reason: 'religious organization' },

  // Police / Public Safety
  { pattern: /police|sheriff|fire|public.?safety|crime/i, type: 'police_blotter',    quality: 'official',   reason: 'public safety keyword' },

  // Lifestyle / Magazine
  { pattern: /magazine|lifestyle|living|best.?of/i,    type: 'lifestyle',             quality: 'community',  reason: 'lifestyle/magazine keyword' },

  // Aggregators — deprioritized
  { pattern: /news\.google\.com/i,                     type: 'local_news',            quality: 'aggregator', reason: 'Google News aggregator' },
  { pattern: /apple\.news/i,                           type: 'local_news',            quality: 'aggregator', reason: 'Apple News aggregator' },
];

// ── Path-based signals ────────────────────────────────────────────────────
const PATH_PATTERNS: { pattern: RegExp; type: SourceType; reason: string }[] = [
  { pattern: /\/news\//i,         type: 'local_news',   reason: '/news/ path' },
  { pattern: /\/sports\//i,       type: 'sports_local', reason: '/sports/ path' },
  { pattern: /\/events?\//i,      type: 'event',        reason: '/events/ path' },
  { pattern: /\/community\//i,    type: 'community',    reason: '/community/ path' },
  { pattern: /\/education\//i,    type: 'school',       reason: '/education/ path' },
  { pattern: /\/weather\//i,      type: 'weather',      reason: '/weather/ path' },
  { pattern: /\/police|crime\//i, type: 'police_blotter', reason: '/police/ path' },
  { pattern: /\/meetings?\//i,    type: 'gov_meeting',  reason: '/meetings/ path' },
  { pattern: /\/calendar\//i,     type: 'event',        reason: '/calendar/ path' },
  { pattern: /\/blog\//i,         type: 'community',    reason: '/blog/ path' },
];

// ── Title keyword signals ─────────────────────────────────────────────────
const TITLE_PATTERNS: { pattern: RegExp; type: SourceType; reason: string }[] = [
  { pattern: /meeting|agenda|minutes|council/i,  type: 'gov_meeting',  reason: 'meeting/agenda in title' },
  { pattern: /police|crime|arrest|blotter/i,     type: 'police_blotter', reason: 'police/crime in title' },
  { pattern: /weather|forecast|storm/i,          type: 'weather',      reason: 'weather in title' },
  { pattern: /event|festival|concert|fair/i,     type: 'event',        reason: 'event in title' },
  { pattern: /sport|football|basketball|baseball|soccer|hockey/i, type: 'sports_local', reason: 'sports in title' },
  { pattern: /school|student|campus|district/i,  type: 'school',       reason: 'school in title' },
  { pattern: /church|parish|worship|faith/i,     type: 'church',       reason: 'church in title' },
  { pattern: /library/i,                         type: 'library',      reason: 'library in title' },
  { pattern: /real estate|homes? for sale|housing/i, type: 'real_estate', reason: 'real estate in title' },
];

// ── Main classifier ───────────────────────────────────────────────────────
export function classifySource(
  feedUrl: string,
  siteUrl?: string | null,
  feedTitle?: string | null,
  feedDescription?: string | null
): ClassificationResult {
  const url = (siteUrl || feedUrl).toLowerCase();
  const feedUrlLower = feedUrl.toLowerCase();

  // 1. Domain pattern match (highest confidence)
  for (const dp of DOMAIN_PATTERNS) {
    if (dp.pattern.test(url)) {
      return { sourceType: dp.type, sourceQuality: dp.quality, confidence: 0.85, reason: dp.reason };
    }
  }

  // 2. Feed URL path pattern
  for (const pp of PATH_PATTERNS) {
    if (pp.pattern.test(feedUrlLower)) {
      return { sourceType: pp.type, sourceQuality: 'community', confidence: 0.6, reason: pp.reason };
    }
  }

  // 3. Feed title keyword matching
  const title = (typeof feedTitle === 'string' ? feedTitle : '').toLowerCase();
  for (const tp of TITLE_PATTERNS) {
    if (tp.pattern.test(title)) {
      return { sourceType: tp.type, sourceQuality: 'community', confidence: 0.5, reason: tp.reason };
    }
  }

  // 4. Description fallback
  const desc = (typeof feedDescription === 'string' ? feedDescription : '').toLowerCase();
  for (const tp of TITLE_PATTERNS) {
    if (tp.pattern.test(desc)) {
      return { sourceType: tp.type, sourceQuality: 'unverified', confidence: 0.3, reason: `${tp.reason} (in description)` };
    }
  }

  // 5. Unknown
  return { sourceType: 'unknown', sourceQuality: 'unverified', confidence: 0.1, reason: 'No patterns matched' };
}
