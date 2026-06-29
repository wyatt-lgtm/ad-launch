/**
 * Three-tier Jim Bridger research architecture.
 *
 * Tier 1  Light Research   — fast, shallow, low-token. Powers ONLY the first
 *                            3 preview posts / conversion page. Runs before the
 *                            business is fully registered.
 * Tier 2  Deep Research    — durable business intelligence. Runs after
 *                            registration / business claim + identity lock.
 * Tier 3  Ongoing Search   — recurring keyword / service-area / competitor
 *         Intelligence       tracking via compliant providers (Ahrefs, GSC,
 *                            Google Ads, approved SERP). Never runs during the
 *                            preview flow.
 *
 * This module is pure data + helpers. It NEVER mutates Tombstone task state,
 * bypasses claim_next_task, or skips save_task_output — task lifecycle stays in
 * the Tombstone backend. Here we only describe the SCOPE of each tier and tag
 * the research records the app stores.
 */

export type ResearchDepth = 'light' | 'deep' | 'ongoing' | 'refresh';

export const RESEARCH_OUTPUT_TYPES = {
  light: 'initial_business_research',
  deep: 'deep_business_research',
  ongoing: 'ongoing_search_intelligence',
  refresh: 'deep_business_research',
} as const;

export const RESEARCH_STATUSES = [
  'pending',
  'queued',
  'running',
  'complete',
  'needs_review',
  'failed',
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/**
 * Light Research scope — intentionally narrow. Keeps the preview workflow fast
 * so users do not abandon signup. The booleans below are the contract the
 * orchestration layer passes to Bridger so the agent knows NOT to do deep work.
 */
export const LIGHT_RESEARCH_SCOPE = {
  depth: 'light' as ResearchDepth,
  maxPages: 3,
  suggestedPages: ['homepage', 'about', 'services'],
  maxRuntimeSecondsTarget: 90,
  extract: [
    'business_name',
    'business_category',
    'core_services',
    'basic_audience',
    'location_service_area',
    'primary_cta',
    'basic_offer_summary',
    'brand_tone_guess',
    'visual_brand_hints',
    'safe_claims_only',
    'basic_post_angles',
    'website_colors_logo_hints',
  ],
  // Everything below is explicitly DISABLED for light research.
  competitorResearch: false,
  trackingPixelInspection: false,
  fullWebsiteCrawl: false,
  socialPostReview: false,
  reviewMining: false,
  seoAudit: false,
  benchmarkLookup: false,
  providerLookup: false,
  ongoingSearchIntelligence: false,
  positioningMatrix: false,
  marketAnalysis: false,
  externalEnrichment: false,
} as const;

/**
 * Deep Research scope — the durable intelligence build. Only runs AFTER
 * registration / business claim + advertiser identity lock.
 */
export const DEEP_RESEARCH_SCOPE = {
  depth: 'deep' as ResearchDepth,
  inspect: [
    'full_website_crawl',
    'service_pages',
    'city_county_pages',
    'landing_pages',
    'blog_articles',
    'competitor_websites',
    'visible_reviews_testimonials',
    'google_business_profile_if_connected',
    'social_posts_if_connected',
    'brand_voice_patterns',
    'offers_and_ctas',
    'b2b_vs_b2c_positioning',
    'existing_tracking_pixels_scripts',
    'seo_structure',
    'internal_linking',
    'conversion_paths',
    'forms_and_ctas',
    'landing_page_opportunities',
    'missing_tracking_recommendations',
  ],
  output: [
    'deep_business_profile',
    'brand_voice_profile',
    'competitor_summary',
    'positioning_profile',
    'audience_segments',
    'service_line_map',
    'b2b_b2c_messaging_split',
    'seo_opportunities',
    'website_improvement_recommendations',
    'tracking_pixel_discoveries',
    'missing_tracking_recommendations',
    'content_strategy',
    'social_voice_patterns',
    'conversion_path_issues',
    'page_opportunities',
    'approved_and_risky_claims',
  ],
  // Deep research MAY do the heavy lifting light research must not.
  competitorResearch: true,
  trackingPixelInspection: true,
  fullWebsiteCrawl: true,
  socialPostReview: true,
  reviewMining: true,
  seoAudit: true,
} as const;

export interface ResearchStatusSummary {
  light: { state: 'not_run' | 'running' | 'complete' | 'failed'; at: string | null };
  deep: {
    state: 'not_started' | 'queued' | 'running' | 'complete' | 'needs_review' | 'failed';
    at: string | null;
  };
  searchIntelligence: {
    state: 'enabled' | 'disabled';
    lastRunAt: string | null;
    nextRunAt: string | null;
  };
}

/**
 * Whether Deep Research is allowed to start. Identity lock + a confirmed
 * business_id are required — never run deep research before identity lock.
 */
export function canRunDeepResearch(business: {
  userId?: string | null;
  tombstoneBusinessId?: number | null;
}): { allowed: boolean; reason?: string } {
  if (!business.userId) {
    return { allowed: false, reason: 'Business must be registered / claimed before Deep Research.' };
  }
  if (!business.tombstoneBusinessId) {
    return {
      allowed: false,
      reason: 'Advertiser identity lock is not set yet (no canonical business id).',
    };
  }
  return { allowed: true };
}

export function outputTypeFor(depth: ResearchDepth): string {
  return RESEARCH_OUTPUT_TYPES[depth] ?? RESEARCH_OUTPUT_TYPES.deep;
}

/**
 * Explicit Light Research request contract for the first-3-posts preview flow.
 *
 * This is the exact, snake_cased payload the app sends to the backend so the
 * preview run is unambiguously shallow — instead of relying on a backend
 * default. It mirrors LIGHT_RESEARCH_SCOPE but in the request shape the
 * Tombstone/research backend expects. Deep-only capabilities are explicitly
 * turned OFF here.
 */
export const PREVIEW_LIGHT_RESEARCH_CONTRACT = {
  research_depth: 'light',
  research_scope: 'preview_3_posts',
  max_pages: LIGHT_RESEARCH_SCOPE.maxPages, // 3
  deep_research_allowed: false,
  tracking_pixel_inspection: false,
  competitor_research: false,
  provider_lookup: false,
  ongoing_search_intelligence: false,
  full_website_crawl: false,
  social_post_review: false,
  seo_audit: false,
} as const;

export type PreviewLightResearchContract = typeof PREVIEW_LIGHT_RESEARCH_CONTRACT;

/** Returns a fresh copy of the preview Light Research contract (safe to mutate). */
export function buildPreviewLightResearchContract(): Record<string, any> {
  return { ...PREVIEW_LIGHT_RESEARCH_CONTRACT };
}
