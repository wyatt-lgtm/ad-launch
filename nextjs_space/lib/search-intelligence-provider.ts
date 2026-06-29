/**
 * Search Intelligence provider abstraction (Tier 3).
 *
 * Compliant data sources ONLY. We never scrape Google directly, never use
 * browser automation to impersonate search users, and never implement
 * "incognito scraping". Internally and in product copy we use
 * "neutral/localized search observation" language.
 *
 * The "hrefs API" referenced by the spec is implemented as the Ahrefs-compatible
 * provider integration layer (`ahrefs`), but the abstraction stays flexible so
 * any approved SERP/SEO provider can be slotted in.
 */

import type { Prisma } from '@prisma/client';
import { DataForSeoProvider } from '@/lib/dataforseo-provider';

export type SearchProviderType =
  | 'google_search_console'
  | 'google_ads_api'
  | 'google_business_profile'
  | 'ahrefs'
  | 'approved_serp_provider'
  | 'dataforseo'
  | 'manual_import';

export interface ProviderHealth {
  provider: SearchProviderType;
  healthy: boolean;
  configured: boolean;
  message: string;
}

export interface NormalizedObservation {
  keyword?: string;
  locationLabel?: string;
  searchEngine?: string;
  device?: string;
  resultType:
    | 'paid_ad'
    | 'organic'
    | 'local_pack'
    | 'map_result'
    | 'ai_overview'
    | 'shopping'
    | 'video'
    | 'image'
    | 'people_also_ask'
    | 'unknown';
  position?: number;
  pageNumber?: number;
  domain?: string;
  url?: string;
  title?: string;
  snippet?: string;
  isSelf?: boolean;
  confidenceScore?: number;
  dataSource: string; // provider + methodology, required for compliance
}

export interface NormalizedResult {
  observations: NormalizedObservation[];
  rawSnapshotRef?: string | null; // R2 object key for large raw payloads
  meta: Record<string, any>;
}

export interface ProviderRequestOptions {
  device?: 'desktop' | 'mobile' | 'both';
  maxResults?: number;
  includePaid?: boolean;
  includeOrganic?: boolean;
  includeLocalPack?: boolean;
  [key: string]: any;
}

/**
 * The provider contract. Concrete providers implement these; when a provider is
 * not yet wired (or its API key is missing) the methods must fail gracefully —
 * returning empty normalized results and a clear health message rather than
 * throwing — so a missing Ahrefs/provider key never crashes a run.
 */
export interface SearchIntelligenceProvider {
  readonly type: SearchProviderType;
  fetchKeywordRankings(
    businessId: string,
    keywords: string[],
    locations: string[],
    options?: ProviderRequestOptions,
  ): Promise<NormalizedResult>;
  fetchCompetitorRankings(
    businessId: string,
    keywords: string[],
    locations: string[],
    competitors: string[],
    options?: ProviderRequestOptions,
  ): Promise<NormalizedResult>;
  fetchOrganicKeywordData(businessId: string, options?: ProviderRequestOptions): Promise<NormalizedResult>;
  fetchPaidKeywordData(businessId: string, options?: ProviderRequestOptions): Promise<NormalizedResult>;
  fetchSearchTermData(businessId: string, options?: ProviderRequestOptions): Promise<NormalizedResult>;
  fetchLocalPackData(
    businessId: string,
    keywords: string[],
    locations: string[],
    options?: ProviderRequestOptions,
  ): Promise<NormalizedResult>;
  fetchProviderHealth(): Promise<ProviderHealth>;
  normalizeResults(rawProviderPayload: any): NormalizedResult;
}

const EMPTY_RESULT: NormalizedResult = { observations: [], rawSnapshotRef: null, meta: {} };

/**
 * Base provider that fails gracefully. Concrete providers extend this and
 * override only the methods they support. Until real API wiring is added (a
 * deliberately deferred, key-dependent step), providers report `configured:
 * false` and return empty results so the rest of the pipeline keeps working.
 */
abstract class BaseProvider implements SearchIntelligenceProvider {
  abstract readonly type: SearchProviderType;
  protected readonly apiKey: string | undefined;
  protected readonly keyEnvVar: string;

  constructor(keyEnvVar: string) {
    this.keyEnvVar = keyEnvVar;
    this.apiKey = process.env[keyEnvVar];
  }

  protected get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchKeywordRankings(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchCompetitorRankings(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchOrganicKeywordData(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchPaidKeywordData(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchSearchTermData(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchLocalPackData(): Promise<NormalizedResult> {
    return EMPTY_RESULT;
  }
  async fetchProviderHealth(): Promise<ProviderHealth> {
    return {
      provider: this.type,
      configured: this.configured,
      healthy: this.configured,
      message: this.configured
        ? `${this.type} is configured.`
        : `${this.type} is not configured (missing ${this.keyEnvVar}). Runs using this provider will fail gracefully with no observations.`,
    };
  }
  normalizeResults(rawProviderPayload: any): NormalizedResult {
    if (!rawProviderPayload) return EMPTY_RESULT;
    return { observations: [], rawSnapshotRef: null, meta: { raw: true } };
  }
}

class AhrefsProvider extends BaseProvider {
  readonly type = 'ahrefs' as const;
  constructor() {
    // "hrefs API" / Ahrefs-compatible integration layer.
    super('AHREFS_API_KEY');
  }
}

class GoogleSearchConsoleProvider extends BaseProvider {
  readonly type = 'google_search_console' as const;
  constructor() {
    super('GOOGLE_SEARCH_CONSOLE_CREDENTIALS');
  }
}

class GoogleAdsProvider extends BaseProvider {
  readonly type = 'google_ads_api' as const;
  constructor() {
    super('GOOGLE_ADS_DEVELOPER_TOKEN');
  }
}

class GoogleBusinessProfileProvider extends BaseProvider {
  readonly type = 'google_business_profile' as const;
  constructor() {
    super('GOOGLE_BUSINESS_PROFILE_CREDENTIALS');
  }
}

class ApprovedSerpProvider extends BaseProvider {
  readonly type = 'approved_serp_provider' as const;
  constructor() {
    super('SERP_PROVIDER_API_KEY');
  }
}

class ManualImportProvider extends BaseProvider {
  readonly type = 'manual_import' as const;
  constructor() {
    super('MANUAL_IMPORT'); // always "available"; data comes from uploaded reports
  }
  protected get configured(): boolean {
    return true;
  }
  async fetchProviderHealth(): Promise<ProviderHealth> {
    return {
      provider: this.type,
      configured: true,
      healthy: true,
      message: 'Manual import is always available; data is supplied via uploaded reports.',
    };
  }
}

const REGISTRY: Record<SearchProviderType, () => SearchIntelligenceProvider> = {
  ahrefs: () => new AhrefsProvider(),
  google_search_console: () => new GoogleSearchConsoleProvider(),
  google_ads_api: () => new GoogleAdsProvider(),
  google_business_profile: () => new GoogleBusinessProfileProvider(),
  approved_serp_provider: () => new ApprovedSerpProvider(),
  dataforseo: () => new DataForSeoProvider(),
  manual_import: () => new ManualImportProvider(),
};

/**
 * Map settings `default_provider` values to provider types. (Settings store
 * `google_ads`; the provider type is `google_ads_api`.)
 */
export function resolveProviderType(value: string | null | undefined): SearchProviderType {
  switch ((value || '').trim()) {
    case 'ahrefs':
      return 'ahrefs';
    case 'google_search_console':
      return 'google_search_console';
    case 'google_ads':
    case 'google_ads_api':
      return 'google_ads_api';
    case 'google_business_profile':
      return 'google_business_profile';
    case 'approved_serp_provider':
      return 'approved_serp_provider';
    case 'dataforseo':
      return 'dataforseo';
    default:
      return 'manual_import';
  }
}

export function getSearchIntelligenceProvider(
  type: SearchProviderType,
): SearchIntelligenceProvider {
  const factory = REGISTRY[type] ?? REGISTRY.manual_import;
  return factory();
}

export async function getAllProviderHealth(): Promise<ProviderHealth[]> {
  const types = Object.keys(REGISTRY) as SearchProviderType[];
  return Promise.all(types.map((t) => getSearchIntelligenceProvider(t).fetchProviderHealth()));
}

// Re-export Prisma type alias to keep call sites tidy.
export type ObservationCreateInput = Prisma.SearchVisibilityObservationCreateManyInput;
