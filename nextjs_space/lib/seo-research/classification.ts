/**
 * SEO Research — pure classification & freshness helpers.
 *
 * These functions are intentionally DB-free and side-effect-free so they can
 * be unit tested in isolation. They encode the compliance + routing rules:
 *   - Service / local pages  -> service-page model (structure analysis)
 *   - Reddit / forum / PAA     -> question input (customer-question mining)
 *   - YouTube / video          -> video-brief input
 *   - NO Google scraping: any attempt to use a Google SERP endpoint as a
 *     data source must be rejected.
 */

export type ClassifiedInput = 'service_page' | 'question_input' | 'video_input';

export type ResultType =
  | 'organic'
  | 'local_pack'
  | 'map_result'
  | 'maps'
  | 'paid'
  | 'paid_ad'
  | 'featured_snippet'
  | 'people_also_ask'
  | 'reddit'
  | 'forum'
  | 'youtube'
  | 'video'
  | 'image'
  | 'shopping'
  | 'ai_overview'
  | 'other'
  | 'unknown';

export type TopicType =
  | 'warning_signs'
  | 'comparison'
  | 'cost'
  | 'timing'
  | 'necessity'
  | 'process'
  | 'risk'
  | 'DIY_vs_professional'
  | 'objection'
  | 'FAQ'
  | 'local_modifier'
  | 'video_topic';

export type FunnelStage = 'awareness' | 'consideration' | 'decision' | 'retention';

export type RecommendedContentUse =
  | 'service_page_section'
  | 'FAQ'
  | 'blog_article'
  | 'video_script'
  | 'short_video'
  | 'carousel'
  | 'email'
  | 'social_post'
  | 'landing_page_section';

/** Hosts whose pages are forum / community / question style inputs. */
const QUESTION_HOST_PATTERNS = [
  'reddit.com',
  'quora.com',
  'stackexchange.com',
  'answers.',
  'forum',
  'community.',
  'discuss.',
  'houzz.com',
  'thumbtack.com/q',
];

/** Hosts whose pages are video inputs. */
const VIDEO_HOST_PATTERNS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'tiktok.com',
  'dailymotion.com',
];

/**
 * Google SERP / scraping endpoints we must NEVER fetch as a data source.
 * (We only ever fetch the individual top URLs the provider returns.)
 */
const FORBIDDEN_GOOGLE_HOSTS = [
  'google.com/search',
  'www.google.com/search',
  'google.com/serp',
  'google.com/maps/search',
  'bing.com/search',
  'duckduckgo.com/html',
];

export function safeHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * True when the URL is a search-engine results endpoint that we are forbidden
 * to scrape. Used as a hard guard before any HTTP fetch.
 */
export function isForbiddenSerpScrapeUrl(rawUrl: string): boolean {
  if (!rawUrl) return true;
  let normalized: URL;
  try {
    normalized = new URL(rawUrl);
  } catch {
    return true; // unparseable -> refuse
  }
  const hostPath = `${normalized.hostname}${normalized.pathname}`.toLowerCase().replace(/^www\./, '');
  return FORBIDDEN_GOOGLE_HOSTS.some((p) => hostPath.startsWith(p) || hostPath.includes(p));
}

/**
 * Throws if the URL is a forbidden Google/search scraping endpoint. Every page
 * fetch must pass through this guard first.
 */
export function assertFetchableTopUrl(rawUrl: string): void {
  if (isForbiddenSerpScrapeUrl(rawUrl)) {
    throw new Error(
      `Refusing to fetch "${rawUrl}": SEO research never scrapes search-engine result pages; only provider-returned top URLs are fetched.`,
    );
  }
}

/**
 * Classify a provider SERP result into one of the three consumption inputs.
 * Driven by result_type first, then host heuristics.
 */
export function classifyResultInput(resultType: string | null | undefined, url?: string | null): ClassifiedInput {
  const rt = (resultType || '').toLowerCase();
  const host = url ? safeHostname(url) : '';

  // Video inputs
  if (rt === 'youtube' || rt === 'video') return 'video_input';
  if (host && VIDEO_HOST_PATTERNS.some((p) => host.includes(p))) return 'video_input';

  // Question inputs
  if (rt === 'people_also_ask' || rt === 'paa' || rt === 'reddit' || rt === 'forum') return 'question_input';
  if (host && QUESTION_HOST_PATTERNS.some((p) => host.includes(p))) return 'question_input';

  // Everything else (organic, local_pack, maps, paid, featured_snippet, etc.)
  // is treated as a service-page-style structural input.
  return 'service_page';
}

/** Normalize a free-form provider result_type onto our enum. */
export function normalizeResultType(resultType: string | null | undefined, url?: string | null): ResultType {
  const rt = (resultType || '').toLowerCase().trim();
  const host = url ? safeHostname(url) : '';
  if (host.includes('reddit.com')) return 'reddit';
  if (host && QUESTION_HOST_PATTERNS.some((p) => host.includes(p)) && rt !== 'people_also_ask') return 'forum';
  if (host && VIDEO_HOST_PATTERNS.some((p) => host.includes(p))) return 'youtube';
  switch (rt) {
    case 'paid_ad':
    case 'paid':
      return 'paid';
    case 'local_pack':
      return 'local_pack';
    case 'map_result':
    case 'maps':
      return 'maps';
    case 'featured_snippet':
      return 'featured_snippet';
    case 'people_also_ask':
    case 'paa':
      return 'people_also_ask';
    case 'video':
      return 'video';
    case 'youtube':
      return 'youtube';
    case 'image':
      return 'image';
    case 'shopping':
      return 'shopping';
    case 'ai_overview':
      return 'ai_overview';
    case 'organic':
      return 'organic';
    case '':
    case 'unknown':
      return 'unknown';
    default:
      return 'other';
  }
}

const TOPIC_KEYWORD_MAP: Array<{ type: TopicType; patterns: RegExp[] }> = [
  { type: 'warning_signs', patterns: [/\bsign(s)?\b/i, /\bsymptom/i, /\bwarning/i, /how (do|can) i (know|tell)/i, /when (should|do) i\b/i] },
  { type: 'cost', patterns: [/\bcost\b/i, /\bprice/i, /\bhow much\b/i, /\$/, /\bquote\b/i, /\bestimate\b/i, /\baffordable/i] },
  { type: 'DIY_vs_professional', patterns: [/\bdiy\b/i, /\bmyself\b/i, /\bon my own\b/i, /\bhire (a|an)\b/i, /\bprofessional/i] },
  { type: 'comparison', patterns: [/\bvs\b/i, /\bversus\b/i, /\bcompare/i, /\bbetter\b/i, /\bdifference between\b/i] },
  { type: 'timing', patterns: [/\bhow long\b/i, /\bhow often\b/i, /\bwhen\b/i, /\bschedule/i, /\bduration/i, /\btime\b/i] },
  { type: 'necessity', patterns: [/\bdo i (really )?need\b/i, /\bis it (necessary|worth|required)\b/i, /\bwhy (do|should)\b/i] },
  { type: 'process', patterns: [/\bhow (to|does|do)\b/i, /\bprocess\b/i, /\bsteps?\b/i, /\bwhat happens\b/i, /\bwork(s)?\b/i] },
  { type: 'risk', patterns: [/\bdanger/i, /\brisk/i, /\bsafe\b/i, /\bhazard/i, /\bdamage/i, /\bharm/i] },
  { type: 'objection', patterns: [/\bscam\b/i, /\bworth it\b/i, /\bripoff\b/i, /\btrust\b/i, /\bguarantee/i, /\bwarranty/i] },
];

/**
 * Heuristically classify an extracted question/topic string into a topic_type.
 * Used as a deterministic fallback alongside LLM classification.
 */
export function classifyQuestionTopic(question: string): TopicType {
  const q = (question || '').trim();
  if (!q) return 'FAQ';
  for (const { type, patterns } of TOPIC_KEYWORD_MAP) {
    if (patterns.some((re) => re.test(q))) return type;
  }
  return 'FAQ';
}

/** Map a topic_type to its most natural funnel stage (default heuristic). */
export function topicFunnelStage(topicType: TopicType): FunnelStage {
  switch (topicType) {
    case 'warning_signs':
    case 'necessity':
    case 'risk':
      return 'awareness';
    case 'comparison':
    case 'cost':
    case 'DIY_vs_professional':
    case 'process':
    case 'timing':
      return 'consideration';
    case 'objection':
    case 'FAQ':
      return 'decision';
    default:
      return 'consideration';
  }
}

/** Map a topic_type to a recommended content use (default heuristic). */
export function recommendedContentUseForTopic(topicType: TopicType): RecommendedContentUse {
  switch (topicType) {
    case 'warning_signs':
      return 'blog_article';
    case 'comparison':
      return 'blog_article';
    case 'cost':
      return 'service_page_section';
    case 'process':
      return 'service_page_section';
    case 'timing':
      return 'FAQ';
    case 'necessity':
      return 'FAQ';
    case 'risk':
      return 'short_video';
    case 'DIY_vs_professional':
      return 'video_script';
    case 'objection':
      return 'FAQ';
    case 'video_topic':
      return 'short_video';
    case 'local_modifier':
      return 'landing_page_section';
    default:
      return 'FAQ';
  }
}

export type MetaAnalysisPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Freshness rule. A meta-analysis becomes stale when:
 *   - high/critical priority and older than 30 days, OR
 *   - low/medium priority and older than 90 days, OR
 *   - material competitor movement was detected since it was built.
 * It is NEVER auto-regenerated by this function — callers only mark status.
 */
export function isMetaAnalysisStale(params: {
  createdAt: Date;
  now?: Date;
  priority?: MetaAnalysisPriority;
  materialCompetitorMovement?: boolean;
}): boolean {
  const now = params.now ?? new Date();
  const ageDays = (now.getTime() - params.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (params.materialCompetitorMovement) return true;
  const high = params.priority === 'high' || params.priority === 'critical';
  return high ? ageDays > 30 : ageDays > 90;
}

export type SeoResearchStatus =
  | 'research_ready'
  | 'research_missing'
  | 'research_stale'
  | 'provider_unavailable'
  | 'generated_without_research'
  | 'seo_research_missing';

/**
 * Decide the research gate status for a website page build given the state of
 * its meta-analysis / approved page brief. This is the gate the production
 * website workflow consults BEFORE generating a page.
 */
export function resolvePageResearchStatus(params: {
  hasApprovedBrief: boolean;
  metaAnalysisStatus?: string | null;
  providerConfigured: boolean;
  adminOverride?: boolean;
}): SeoResearchStatus {
  if (params.adminOverride) return 'generated_without_research';
  if (!params.providerConfigured) return 'provider_unavailable';
  if (params.hasApprovedBrief && params.metaAnalysisStatus === 'complete') return 'research_ready';
  if (params.metaAnalysisStatus === 'stale') return 'research_stale';
  if (!params.hasApprovedBrief && !params.metaAnalysisStatus) return 'seo_research_missing';
  return 'research_missing';
}
