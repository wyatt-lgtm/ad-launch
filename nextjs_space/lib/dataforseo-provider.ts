/**
 * DataForSEO provider — first LIVE Search Intelligence SEO/SERP provider.
 *
 * Compliance: this provider talks ONLY to the official DataForSEO v3 REST API.
 * It performs NO direct Google scraping, NO browser automation, and NO
 * "incognito search" emulation. All observation data comes from DataForSEO's
 * licensed SERP API responses.
 *
 * Security: credentials (DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD) are
 * read from the environment, used only to build a Basic auth header, and are
 * NEVER logged, never returned in API responses, and never written to the DB.
 * Only a `credentialsRef` (the env var names) is ever surfaced.
 */

import {
  type SearchIntelligenceProvider,
  type SearchProviderType,
  type NormalizedObservation,
  type NormalizedResult,
  type ProviderHealth,
  type ProviderRequestOptions,
} from '@/lib/search-intelligence-provider';

// ── Configuration ──────────────────────────────────────────────────

export interface DataForSeoConfig {
  enabled: boolean;
  hasCredentials: boolean;
  login?: string;
  password?: string;
  baseUrl: string;
  sandboxUrl: string;
  useSandbox: boolean;
  effectiveBaseUrl: string;
  defaultLanguageCode: string;
  timeoutMs: number;
}

function boolEnv(v: string | undefined): boolean {
  return String(v ?? '').trim().toLowerCase() === 'true';
}

/**
 * Resolve DataForSEO configuration from the environment.
 *
 * Base-URL selection (per spec):
 *  - If DATAFORSEO_USE_SANDBOX=true → use the sandbox URL.
 *  - Otherwise (incl. production without the flag) → use the live base URL.
 */
export function getDataForSeoConfig(): DataForSeoConfig {
  const enabled = boolEnv(process.env.DATAFORSEO_ENABLED);
  const login = process.env.DATAFORSEO_API_LOGIN || undefined;
  const password = process.env.DATAFORSEO_API_PASSWORD || undefined;
  const baseUrl = (process.env.DATAFORSEO_BASE_URL || 'https://api.dataforseo.com').replace(/\/+$/, '');
  const sandboxUrl = (process.env.DATAFORSEO_SANDBOX_URL || 'https://sandbox.dataforseo.com').replace(/\/+$/, '');
  const useSandbox = boolEnv(process.env.DATAFORSEO_USE_SANDBOX);
  const timeoutMs = parseInt(process.env.DATAFORSEO_REQUEST_TIMEOUT_MS || '30000', 10) || 30000;
  const defaultLanguageCode = process.env.DATAFORSEO_DEFAULT_LANGUAGE_CODE || 'en';
  return {
    enabled,
    hasCredentials: Boolean(login && password),
    login,
    password,
    baseUrl,
    sandboxUrl,
    useSandbox,
    effectiveBaseUrl: useSandbox ? sandboxUrl : baseUrl,
    defaultLanguageCode,
    timeoutMs,
  };
}

/**
 * Build a Basic auth header from the configured credentials. Returns null when
 * credentials are missing. The returned string is a secret and must never be
 * logged. Exposed for unit testing the encoding only.
 */
export function buildBasicAuthHeader(login?: string, password?: string): string | null {
  if (!login || !password) return null;
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${token}`;
}

// ── Usage events (no credentials, business-scoped by caller) ────────

export interface ProviderUsageDescriptor {
  endpoint: string;
  queryType: string;
  targetKeyword?: string | null;
  targetLocation?: string | null;
  requestCount: number;
  responseStatus: 'ok' | 'error' | 'empty' | 'disabled' | 'missing_credentials';
  providerStatusCode?: number | null;
  unitsUsed?: number | null;
  costEstimate?: number | null;
  isSandbox: boolean;
  errorMessage?: string | null;
}

// ── Location mapping ────────────────────────────────────────────────

export interface ProviderLocationInput {
  locationType?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  marketLabel?: string | null;
}

/**
 * Map a Search Intelligence location to a DataForSEO `location_name` string.
 * DataForSEO expects human-readable names like "Houston,Texas,United States".
 * Falls back to the marketLabel or "United States" for national.
 */
export function mapLocationToDataForSeo(loc: ProviderLocationInput | string | null | undefined): string {
  if (!loc) return 'United States';
  if (typeof loc === 'string') {
    const s = loc.trim();
    if (!s || s.toLowerCase() === 'national') return 'United States';
    return s;
  }
  const country = expandCountry(loc.country);
  if ((loc.locationType || '').toLowerCase() === 'national') return country;
  const parts: string[] = [];
  if (loc.city) parts.push(loc.city);
  const stateName = expandState(loc.state);
  if (stateName) parts.push(stateName);
  parts.push(country);
  const joined = parts.filter(Boolean).join(',');
  if (joined && joined !== country) return joined;
  if (loc.marketLabel) return loc.marketLabel;
  return country;
}

function expandCountry(c?: string | null): string {
  const v = (c || '').trim().toUpperCase();
  if (!v || v === 'US' || v === 'USA' || v === 'UNITED STATES') return 'United States';
  return c as string;
}

// Minimal US state abbreviation expansion (DataForSEO prefers full names).
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

function expandState(s?: string | null): string | null {
  if (!s) return null;
  const v = s.trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (US_STATES[up]) return US_STATES[up];
  return v; // already a full name
}

// ── Domain helpers (self vs competitor) ─────────────────────────────

export function normalizeDomain(value?: string | null): string {
  if (!value) return '';
  let v = value.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '');
  v = v.split('/')[0].split('?')[0].split('#')[0];
  return v;
}

function domainsMatch(a?: string | null, b?: string | null): boolean {
  const da = normalizeDomain(a);
  const db = normalizeDomain(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(`.${db}`) || db.endsWith(`.${da}`);
}

// ── SERP item type mapping ──────────────────────────────────────────

function mapItemType(t: string | undefined): NormalizedObservation['resultType'] {
  switch ((t || '').toLowerCase()) {
    case 'organic':
    case 'featured_snippet':
      return 'organic';
    case 'paid':
      return 'paid_ad';
    case 'local_pack':
      return 'local_pack';
    case 'map':
    case 'maps_search':
      return 'map_result';
    case 'ai_overview':
      return 'ai_overview';
    case 'shopping':
    case 'popular_products':
      return 'shopping';
    case 'video':
      return 'video';
    case 'images':
      return 'image';
    case 'people_also_ask':
      return 'people_also_ask';
    default:
      return 'unknown';
  }
}

// ── Normalization (pure — unit-testable without network) ─────────────

export interface NormalizeOptions {
  selfDomain?: string | null;
  isSandbox?: boolean;
  includePaid?: boolean;
  includeOrganic?: boolean;
  includeLocalPack?: boolean;
}

/**
 * Normalize a raw DataForSEO SERP "Google Organic Live Advanced" response into
 * the shared NormalizedResult shape. Robust to missing/empty sandbox payloads.
 */
export function normalizeSerpResponse(raw: any, opts: NormalizeOptions = {}): NormalizedResult {
  const observations: NormalizedObservation[] = [];
  const dataSource = `dataforseo:serp/google/organic/live/advanced${opts.isSandbox ? ':sandbox' : ''}`;
  const includePaid = opts.includePaid !== false;
  const includeOrganic = opts.includeOrganic !== false;
  const includeLocalPack = opts.includeLocalPack !== false;

  const tasks: any[] = Array.isArray(raw?.tasks) ? raw.tasks : [];
  for (const task of tasks) {
    const results: any[] = Array.isArray(task?.result) ? task.result : [];
    for (const res of results) {
      const keyword: string | undefined = res?.keyword ?? task?.data?.keyword;
      const locationLabel: string | undefined = res?.location_name ?? task?.data?.location_name;
      const device: string | undefined = res?.device ?? task?.data?.device ?? 'desktop';
      const items: any[] = Array.isArray(res?.items) ? res.items : [];
      for (const item of items) {
        const resultType = mapItemType(item?.type);
        if (resultType === 'paid_ad' && !includePaid) continue;
        if (resultType === 'organic' && !includeOrganic) continue;
        if ((resultType === 'local_pack' || resultType === 'map_result') && !includeLocalPack) continue;
        const domain = item?.domain ?? item?.url ? normalizeDomain(item?.domain ?? item?.url) : undefined;
        const isSelf = domainsMatch(domain, opts.selfDomain);
        observations.push({
          keyword,
          locationLabel,
          searchEngine: 'google',
          device,
          resultType,
          position: item?.rank_absolute ?? item?.rank_group ?? undefined,
          pageNumber: typeof item?.rank_absolute === 'number' ? Math.ceil(item.rank_absolute / 10) : undefined,
          domain: domain || undefined,
          url: item?.url ?? undefined,
          title: item?.title ?? undefined,
          snippet: item?.description ?? item?.snippet ?? undefined,
          isSelf,
          confidenceScore: isSelf ? 0.95 : 0.6,
          dataSource,
        });
      }
    }
  }

  return {
    observations,
    rawSnapshotRef: null,
    meta: {
      provider: 'dataforseo',
      isSandbox: Boolean(opts.isSandbox),
      taskCount: tasks.length,
      providerStatusCode: typeof raw?.status_code === 'number' ? raw.status_code : null,
      cost: typeof raw?.cost === 'number' ? raw.cost : null,
    },
  };
}

// ── Provider implementation ─────────────────────────────────────────

export class DataForSeoProvider implements SearchIntelligenceProvider {
  readonly type = 'dataforseo' as SearchProviderType;
  private readonly cfg: DataForSeoConfig;
  // Usage descriptors collected during the last call set; the caller persists
  // these (business-scoped) into ProviderUsageEvent. Contains NO credentials.
  public usage: ProviderUsageDescriptor[] = [];

  constructor(cfg?: DataForSeoConfig) {
    this.cfg = cfg ?? getDataForSeoConfig();
  }

  get configured(): boolean {
    return this.cfg.enabled && this.cfg.hasCredentials;
  }

  private authHeader(): string | null {
    return buildBasicAuthHeader(this.cfg.login, this.cfg.password);
  }

  private async post(path: string, payload: any): Promise<{ ok: boolean; status: number; body: any }> {
    const auth = this.authHeader();
    if (!auth) return { ok: false, status: 0, body: { error: 'missing_credentials' } };
    const url = `${this.cfg.effectiveBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: auth, // secret — never logged
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchProviderHealth(): Promise<ProviderHealth> {
    if (!this.cfg.enabled) {
      return { provider: this.type, configured: false, healthy: false, message: 'DataForSEO is disabled (DATAFORSEO_ENABLED is not true).' };
    }
    if (!this.cfg.hasCredentials) {
      return {
        provider: this.type,
        configured: false,
        healthy: false,
        message: 'DataForSEO credentials are missing (DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD). Runs fail gracefully with no observations.',
      };
    }
    return {
      provider: this.type,
      configured: true,
      healthy: true,
      message: this.cfg.useSandbox
        ? 'DataForSEO configured (SANDBOX mode — test data only).'
        : 'DataForSEO configured (LIVE mode).',
    };
  }

  /**
   * Fetch SERP rankings for keyword × location pairs via the DataForSEO
   * Google Organic Live Advanced endpoint (one batch request, capped tasks).
   */
  async fetchKeywordRankings(
    _businessId: string,
    keywords: string[],
    locations: string[],
    options?: ProviderRequestOptions & { selfDomain?: string | null },
  ): Promise<NormalizedResult> {
    this.usage = [];
    const path = '/v3/serp/google/organic/live/advanced';
    const isSandbox = this.cfg.useSandbox;

    if (!this.configured) {
      this.usage.push({
        endpoint: path,
        queryType: 'serp_organic',
        requestCount: 0,
        responseStatus: this.cfg.enabled ? 'missing_credentials' : 'disabled',
        isSandbox,
        errorMessage: this.cfg.enabled ? 'Missing DataForSEO credentials' : 'DataForSEO disabled',
      });
      return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', configured: false } };
    }

    const locs = locations.length ? locations : ['United States'];
    const device = (options?.device as string) || 'desktop';
    const maxTasks = Math.max(1, Math.min(100, options?.maxResults ?? 100));
    const tasks: any[] = [];
    for (const kw of keywords) {
      for (const loc of locs) {
        if (tasks.length >= maxTasks) break;
        tasks.push({
          keyword: kw,
          location_name: loc,
          language_code: this.cfg.defaultLanguageCode,
          device: device === 'both' ? 'desktop' : device,
        });
      }
    }
    if (tasks.length === 0) {
      return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', taskCount: 0 } };
    }

    try {
      const { ok, status, body } = await this.post(path, tasks);
      const providerStatusCode = typeof body?.status_code === 'number' ? body.status_code : status;
      const cost = typeof body?.cost === 'number' ? body.cost : null;
      if (!ok || (typeof body?.status_code === 'number' && body.status_code >= 40000)) {
        this.usage.push({
          endpoint: path,
          queryType: 'serp_organic',
          targetKeyword: keywords[0] ?? null,
          targetLocation: locs[0] ?? null,
          requestCount: tasks.length,
          responseStatus: 'error',
          providerStatusCode,
          unitsUsed: tasks.length,
          costEstimate: cost,
          isSandbox,
          errorMessage: (body?.status_message || `HTTP ${status}`).toString().slice(0, 500),
        });
        return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', error: true, providerStatusCode } };
      }
      const normalized = normalizeSerpResponse(body, {
        selfDomain: options?.selfDomain,
        isSandbox,
        includePaid: options?.includePaid,
        includeOrganic: options?.includeOrganic,
        includeLocalPack: options?.includeLocalPack,
      });
      this.usage.push({
        endpoint: path,
        queryType: 'serp_organic',
        targetKeyword: keywords[0] ?? null,
        targetLocation: locs[0] ?? null,
        requestCount: tasks.length,
        responseStatus: normalized.observations.length > 0 ? 'ok' : 'empty',
        providerStatusCode,
        unitsUsed: tasks.length,
        costEstimate: cost,
        isSandbox,
      });
      return normalized;
    } catch (err: any) {
      this.usage.push({
        endpoint: path,
        queryType: 'serp_organic',
        targetKeyword: keywords[0] ?? null,
        targetLocation: locs[0] ?? null,
        requestCount: tasks.length,
        responseStatus: 'error',
        isSandbox,
        errorMessage: String(err?.message || err).slice(0, 500),
      });
      return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', error: true } };
    }
  }

  async fetchCompetitorRankings(
    businessId: string,
    keywords: string[],
    locations: string[],
    _competitors: string[],
    options?: ProviderRequestOptions & { selfDomain?: string | null },
  ): Promise<NormalizedResult> {
    // Competitors are discovered from the same SERP results (any non-self domain).
    return this.fetchKeywordRankings(businessId, keywords, locations, options);
  }

  /**
   * Low-risk keyword metrics via Google Ads search volume (volume, CPC,
   * competition). Returns meta-only NormalizedResult (no SERP observations).
   */
  async fetchKeywordMetrics(
    _businessId: string,
    keywords: string[],
    locationName?: string,
  ): Promise<{ metrics: Array<{ keyword: string; searchVolume: number | null; cpc: number | null; competition: string | null }>; meta: Record<string, any> }> {
    const path = '/v3/keywords_data/google_ads/search_volume/live';
    const isSandbox = this.cfg.useSandbox;
    this.usage = this.usage || [];
    if (!this.configured || keywords.length === 0) {
      this.usage.push({
        endpoint: path, queryType: 'keyword_metrics', requestCount: 0,
        responseStatus: this.cfg.enabled ? 'missing_credentials' : 'disabled', isSandbox,
      });
      return { metrics: [], meta: { provider: 'dataforseo', configured: this.configured } };
    }
    try {
      const payload = [{ keywords: keywords.slice(0, 100), location_name: locationName || 'United States', language_code: this.cfg.defaultLanguageCode }];
      const { ok, status, body } = await this.post(path, payload);
      const providerStatusCode = typeof body?.status_code === 'number' ? body.status_code : status;
      const items: any[] = body?.tasks?.[0]?.result ?? [];
      const metrics = items.map((it: any) => ({
        keyword: it?.keyword,
        searchVolume: it?.search_volume ?? null,
        cpc: it?.cpc ?? null,
        competition: it?.competition ?? null,
      }));
      this.usage.push({
        endpoint: path, queryType: 'keyword_metrics', targetKeyword: keywords[0] ?? null,
        targetLocation: locationName ?? null, requestCount: keywords.length,
        responseStatus: ok ? (metrics.length ? 'ok' : 'empty') : 'error',
        providerStatusCode, unitsUsed: 1, costEstimate: typeof body?.cost === 'number' ? body.cost : null, isSandbox,
      });
      return { metrics, meta: { provider: 'dataforseo', providerStatusCode } };
    } catch (err: any) {
      this.usage.push({
        endpoint: path, queryType: 'keyword_metrics', requestCount: keywords.length,
        responseStatus: 'error', isSandbox, errorMessage: String(err?.message || err).slice(0, 500),
      });
      return { metrics: [], meta: { provider: 'dataforseo', error: true } };
    }
  }

  // Methods not used in this first pass fail gracefully (empty).
  async fetchOrganicKeywordData(): Promise<NormalizedResult> {
    return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', unsupported: 'fetchOrganicKeywordData' } };
  }
  async fetchPaidKeywordData(): Promise<NormalizedResult> {
    return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', unsupported: 'fetchPaidKeywordData' } };
  }
  async fetchSearchTermData(): Promise<NormalizedResult> {
    return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', unsupported: 'fetchSearchTermData' } };
  }
  async fetchLocalPackData(
    businessId: string,
    keywords: string[],
    locations: string[],
    options?: ProviderRequestOptions & { selfDomain?: string | null },
  ): Promise<NormalizedResult> {
    // Local pack items are included in the organic/advanced SERP response.
    return this.fetchKeywordRankings(businessId, keywords, locations, { ...options, includeLocalPack: true });
  }

  normalizeResults(rawProviderPayload: any): NormalizedResult {
    return normalizeSerpResponse(rawProviderPayload, { isSandbox: this.cfg.useSandbox });
  }
}
