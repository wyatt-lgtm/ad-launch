/**
 * RSS Intelligence System — Shared TypeScript Types
 *
 * These types are used across the RSS engine, admin UI, and API layer.
 * They are also the contract surface that Tombstone research agents
 * use when querying for safe local content.
 */

// ═══════════════════════════════════════════════════════════════
// Source Taxonomy
// ═══════════════════════════════════════════════════════════════

export const SOURCE_TYPES = [
  'local_news',
  'gov_meeting',
  'event',
  'weather',
  'school',
  'community',
  'chamber_of_commerce',
  'police_blotter',
  'sports_local',
  'lifestyle',
  'church',
  'library',
  'parks_rec',
  'real_estate',
  'local_business',
  'unknown',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_QUALITY_LEVELS = [
  'official',     // .gov, school districts, city portals
  'trusted',      // local newspapers, local TV stations
  'community',    // local radio, community blogs, patch.com
  'aggregator',   // Google News local, Apple News — DEPRIORITIZED
  'unverified',   // not yet classified
] as const;
export type SourceQuality = (typeof SOURCE_QUALITY_LEVELS)[number];

export const GEO_SCOPES = [
  'local',      // ZIP-level via FeedGeo table
  'state',      // all ZIPs in pilotState
  'national',   // included in ALL trade area queries
  'weather',    // state-level weather; matches pilotState
] as const;
export type GeoScope = (typeof GEO_SCOPES)[number];

export const FEED_STATUSES = [
  'pending',   // discovered, not yet validated
  'active',    // validated + fresh
  'stale',     // >30 days since last item
  'broken',    // parse error or 404
  'blocked',   // admin-blocked or policy-violated
  'retired',   // permanently removed
] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════
// Content Policy
// ═══════════════════════════════════════════════════════════════

export const POLICY_ACTIONS = ['hard_block', 'soft_filter', 'allow'] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export const FILTER_STATUSES = ['pending', 'approved', 'blocked', 'manual_review'] as const;
export type FilterStatus = (typeof FILTER_STATUSES)[number];

export const COVERAGE_TYPES = ['confirmed', 'inferred'] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

/**
 * Content policy categories — the canonical list.
 * hard_block categories are NEVER shown to downstream consumers.
 * soft_filter categories go to manual_review.
 * allow categories pass through automatically.
 */
export const CONTENT_CATEGORIES = {
  // Hard blocks — zero tolerance
  sexual_adult:       { action: 'hard_block' as PolicyAction, label: 'Sexual / Adult Content' },
  political_opinion:  { action: 'hard_block' as PolicyAction, label: 'Political Opinion / Partisan' },

  // Soft filters — human review
  violence_graphic:   { action: 'soft_filter' as PolicyAction, label: 'Graphic Violence' },
  drug_alcohol:       { action: 'soft_filter' as PolicyAction, label: 'Drug / Alcohol Promotion' },
  gambling:           { action: 'soft_filter' as PolicyAction, label: 'Gambling / Betting' },
  religious_divisive: { action: 'soft_filter' as PolicyAction, label: 'Divisive Religious Content' },
  legal_controversy:  { action: 'soft_filter' as PolicyAction, label: 'Legal Controversy / Lawsuits' },
  disaster_tragedy:   { action: 'soft_filter' as PolicyAction, label: 'Disaster / Tragedy' },

  // Allow — safe for automated posting
  local_event:        { action: 'allow' as PolicyAction, label: 'Local Event / Festival' },
  community_news:     { action: 'allow' as PolicyAction, label: 'Community News' },
  business_spotlight: { action: 'allow' as PolicyAction, label: 'Business Spotlight' },
  weather:            { action: 'allow' as PolicyAction, label: 'Weather Update' },
  sports:             { action: 'allow' as PolicyAction, label: 'Local Sports' },
  education:          { action: 'allow' as PolicyAction, label: 'Education / Schools' },
  health_wellness:    { action: 'allow' as PolicyAction, label: 'Health & Wellness' },
  gov_factual:        { action: 'allow' as PolicyAction, label: 'Factual Government News' },
  real_estate:        { action: 'allow' as PolicyAction, label: 'Real Estate / Housing' },
  food_dining:        { action: 'allow' as PolicyAction, label: 'Food & Dining' },
  arts_culture:       { action: 'allow' as PolicyAction, label: 'Arts & Culture' },
} as const;

export type ContentCategory = keyof typeof CONTENT_CATEGORIES;

// ═══════════════════════════════════════════════════════════════
// Trade Area Query (contract for Tombstone agent consumption)
// ═══════════════════════════════════════════════════════════════

export interface TradeAreaRequest {
  zips?: string[];          // Direct ZIP codes
  cities?: string[];        // City names (resolved to ZIPs)
  counties?: string[];      // County names (resolved to ZIPs)
  states?: string[];        // State codes — use sparingly
  limit?: number;           // Max items (default 20)
  days?: number;            // Look back N days (default 7)
  sourceTypes?: SourceType[];
  minConfidence?: number;   // Min geo confidence (default 0.3)
  excludeInferred?: boolean;
  excludeUsed?: boolean;    // Skip items already used in posts
}

export interface TradeAreaItem {
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  author: string | null;
  categories: string[];
  feedId: string;
  feedTitle: string;
  feedSourceType: string;
  feedSourceQuality: string;
  geoConfidence: number;
  coverageType: CoverageType;
  relevanceScore: number | null;
}

export interface TradeAreaResponse {
  items: TradeAreaItem[];
  meta: {
    totalItems: number;
    feedsMatched: number;
    zipsSearched: number;
    queryTimeMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Filter Decision (returned by content policy engine)
// ═══════════════════════════════════════════════════════════════

export interface FilterDecision {
  status: FilterStatus;
  category: ContentCategory | null;
  confidence: number;       // 0.0–1.0
  reason: string;
  method: 'keyword' | 'llm' | 'source_block' | 'auto_allow';
}
