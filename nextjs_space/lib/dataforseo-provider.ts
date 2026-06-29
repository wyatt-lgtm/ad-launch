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

/**
 * Canonicalize a freeform location string into DataForSEO's exact format.
 * DataForSEO requires precise names like "Houston,Texas,United States" — a
 * freeform "Houston, TX" will NOT match and yields a task-level error / zero
 * items. This expands 2-letter state codes and appends the country.
 *
 * Examples:
 *   "Houston, TX"            → "Houston,Texas,United States"
 *   "Houston,Texas"          → "Houston,Texas,United States"
 *   "Texas"                  → "Texas,United States"
 *   "United States" / ""     → "United States"
 *   "Houston,Texas,United States" (already canonical) → unchanged
 */
export function normalizeLocationString(input?: string | null): string {
  const raw = (input || '').trim();
  if (!raw || raw.toLowerCase() === 'national' || raw.toLowerCase() === 'united states') {
    return 'United States';
  }
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return 'United States';
  // Detect an existing trailing country.
  const last = parts[parts.length - 1];
  const hasCountry = /united states|usa|^us$/i.test(last);
  const body = hasCountry ? parts.slice(0, -1) : parts;
  // Expand a state token (abbreviation or name) wherever it appears as the
  // last body element (city, state) or the only element (state-level).
  const rebuilt = body.map((p, idx) => {
    const isLast = idx === body.length - 1;
    if (isLast) {
      const up = p.toUpperCase();
      if (US_STATES[up]) return US_STATES[up];
    }
    return p;
  });
  rebuilt.push('United States');
  return rebuilt.join(',');
}

// ── Provider status-code interpretation ─────────────────────────────

export interface ProviderStatusInfo {
  /** machine reason used for UI/branching */
  reason:
    | 'ok'
    | 'insufficient_funds'
    | 'account_verification_required'
    | 'invalid_field_or_location'
    | 'auth_error'
    | 'rate_limited'
    | 'provider_error';
  /** human-readable, credential-free message */
  message: string;
}

/**
 * Interpret a DataForSEO status_code (top-level OR task-level) into a precise,
 * credential-free reason. Critically: a 20000 OK with zero items is NOT a funds
 * problem — callers must only attribute funds issues to 40200/40210.
 */
export function describeProviderStatus(code?: number | null): ProviderStatusInfo {
  const c = typeof code === 'number' ? code : 0;
  if (c === 20000) return { reason: 'ok', message: 'OK' };
  if (c === 40200 || c === 40210) {
    return { reason: 'insufficient_funds', message: `Insufficient DataForSEO funds (status ${c}). Add funds to the account.` };
  }
  if (c === 40104) {
    return { reason: 'account_verification_required', message: `DataForSEO account verification required (status ${c}).` };
  }
  if (c === 40501 || c === 40505) {
    return { reason: 'invalid_field_or_location', message: `Invalid or outdated field / location parameter (status ${c}). Check location_code / location_name and payload fields.` };
  }
  if (c === 40100 || c === 40101 || c === 40102 || c === 40103) {
    return { reason: 'auth_error', message: `DataForSEO authentication error (status ${c}).` };
  }
  if (c === 40402 || c === 40403 || c === 40429) {
    return { reason: 'rate_limited', message: `DataForSEO rate/usage limit reached (status ${c}).` };
  }
  return { reason: 'provider_error', message: `DataForSEO returned status ${c || 'unknown'}.` };
}

/**
 * Build a sanitized, credential-free snapshot of a raw DataForSEO response for
 * diagnostics. Contains NO Authorization header and NO login/password — only
 * the public response envelope and the (echoed) request payload, which carries
 * no secrets. Truncated so it fits safely in a text column.
 */
export function buildSanitizedSnapshot(
  raw: any,
  context: { resolvedLocation?: any; payload?: any } = {},
): string {
  const task0 = Array.isArray(raw?.tasks) ? raw.tasks[0] : undefined;
  const result0 = Array.isArray(task0?.result) ? task0.result[0] : undefined;
  const items: any[] = Array.isArray(result0?.items) ? result0.items : [];
  const summary = {
    capturedAt: new Date().toISOString(),
    top: {
      status_code: raw?.status_code ?? null,
      status_message: raw?.status_message ?? null,
      tasks_count: raw?.tasks_count ?? null,
      tasks_error: raw?.tasks_error ?? null,
      cost: typeof raw?.cost === 'number' ? raw.cost : null,
    },
    task0: task0
      ? {
          status_code: task0?.status_code ?? null,
          status_message: task0?.status_message ?? null,
          result_count: task0?.result_count ?? null,
          cost: typeof task0?.cost === 'number' ? task0.cost : null,
          data: task0?.data ?? null, // echoed request — no credentials
        }
      : null,
    result0: result0
      ? {
          items_count: result0?.items_count ?? null,
          items_length: items.length,
          first_items: items.slice(0, 3).map((it: any) => ({
            type: it?.type ?? null,
            title: it?.title ?? null,
            domain: it?.domain ?? null,
            url: it?.url ?? null,
          })),
        }
      : null,
    resolvedLocation: context.resolvedLocation ?? null,
    payloadShape: context.payload ?? null,
  };
  try {
    return JSON.stringify(summary).slice(0, 7000);
  } catch {
    return JSON.stringify({ error: 'snapshot_serialize_failed', top: summary.top }).slice(0, 2000);
  }
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

  private async get(path: string): Promise<{ ok: boolean; status: number; body: any }> {
    const auth = this.authHeader();
    if (!auth) return { ok: false, status: 0, body: { error: 'missing_credentials' } };
    const url = `${this.cfg.effectiveBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: auth }, // secret — never logged
        signal: controller.signal,
      });
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve a canonical location name to a DataForSEO location_code by
   * inspecting /v3/serp/google/locations (cached per process). Falls back to
   * the canonical location_name when no code match is found. This is the
   * compliant, documented way to target a SERP location precisely.
   */
  private async resolveLocation(rawInput: string): Promise<{
    input: string;
    canonical: string;
    location_code: number | null;
    location_name: string;
    method: 'builtin' | 'locations_lookup' | 'name_fallback';
    matched: boolean;
  }> {
    const input = (rawInput || '').trim();
    const canonical = normalizeLocationString(input);
    // Built-in fast path for the US national code.
    if (canonical === 'United States') {
      return { input, canonical, location_code: 2840, location_name: canonical, method: 'builtin', matched: true };
    }
    try {
      const map = await DataForSeoProvider.loadLocationMap(this);
      const hit = map.get(canonical.toLowerCase());
      if (typeof hit === 'number') {
        return { input, canonical, location_code: hit, location_name: canonical, method: 'locations_lookup', matched: true };
      }
    } catch {
      // fall through to name fallback
    }
    return { input, canonical, location_code: null, location_name: canonical, method: 'name_fallback', matched: false };
  }

  // Process-level cache of DataForSEO SERP locations (location_name → code).
  private static locationMap: Map<string, number> | null = null;
  private static locationMapPromise: Promise<Map<string, number>> | null = null;
  private static async loadLocationMap(self: DataForSeoProvider): Promise<Map<string, number>> {
    if (DataForSeoProvider.locationMap) return DataForSeoProvider.locationMap;
    if (DataForSeoProvider.locationMapPromise) return DataForSeoProvider.locationMapPromise;
    DataForSeoProvider.locationMapPromise = (async () => {
      const { ok, body } = await self.get('/v3/serp/google/locations');
      const map = new Map<string, number>();
      const list: any[] = ok && Array.isArray(body?.tasks?.[0]?.result) ? body.tasks[0].result : [];
      for (const loc of list) {
        const name = typeof loc?.location_name === 'string' ? loc.location_name.toLowerCase() : null;
        const code = typeof loc?.location_code === 'number' ? loc.location_code : null;
        if (name && code != null && !map.has(name)) map.set(name, code);
      }
      if (map.size > 0) DataForSeoProvider.locationMap = map;
      return map;
    })();
    try {
      return await DataForSeoProvider.locationMapPromise;
    } finally {
      DataForSeoProvider.locationMapPromise = null;
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
    const depth = Math.max(1, Math.min(100, (options as any)?.depth ?? 10));

    // Resolve every location to a precise DataForSEO target (location_code
    // preferred, canonical location_name fallback). One task per pair.
    const tasks: any[] = [];
    const resolvedLocations: any[] = [];
    for (const kw of keywords) {
      for (const loc of locs) {
        if (tasks.length >= maxTasks) break;
        const resolved = await this.resolveLocation(loc);
        resolvedLocations.push(resolved);
        const task: any = {
          keyword: kw,
          language_code: this.cfg.defaultLanguageCode,
          device: device === 'both' ? 'desktop' : device,
          depth,
        };
        if (typeof resolved.location_code === 'number') {
          task.location_code = resolved.location_code;
        } else {
          task.location_name = resolved.location_name;
        }
        tasks.push(task);
      }
    }
    if (tasks.length === 0) {
      return { observations: [], rawSnapshotRef: null, meta: { provider: 'dataforseo', taskCount: 0 } };
    }
    const primaryLocation = resolvedLocations[0] ?? null;

    try {
      const { ok, status, body } = await this.post(path, tasks);
      const topStatusCode = typeof body?.status_code === 'number' ? body.status_code : status;
      const task0 = Array.isArray(body?.tasks) ? body.tasks[0] : undefined;
      const taskStatusCode = typeof task0?.status_code === 'number' ? task0.status_code : null;
      const cost = typeof body?.cost === 'number' ? body.cost : null;
      const snapshot = buildSanitizedSnapshot(body, { resolvedLocation: resolvedLocations, payload: tasks });
      const baseMeta = {
        provider: 'dataforseo',
        rawSnapshot: snapshot,
        resolvedLocation: primaryLocation,
        topStatusCode,
        taskStatusCode,
      } as Record<string, any>;

      // 1) Top-level transport / API error.
      if (!ok || (typeof body?.status_code === 'number' && body.status_code >= 40000)) {
        const info = describeProviderStatus(topStatusCode);
        this.usage.push({
          endpoint: path, queryType: 'serp_organic', targetKeyword: keywords[0] ?? null,
          targetLocation: primaryLocation?.location_name ?? locs[0] ?? null,
          requestCount: tasks.length, responseStatus: 'error', providerStatusCode: topStatusCode,
          unitsUsed: tasks.length, costEstimate: cost, isSandbox,
          errorMessage: `${info.message} ${(body?.status_message || `HTTP ${status}`)}`.toString().slice(0, 500),
        });
        return { observations: [], rawSnapshotRef: null, meta: { ...baseMeta, error: true, providerStatusCode: topStatusCode, statusReason: info.reason } };
      }

      // 2) Top-level OK (20000) but the TASK itself failed (e.g. 40501 invalid
      //    location). This was previously mis-reported as "empty".
      if (taskStatusCode != null && taskStatusCode >= 40000) {
        const info = describeProviderStatus(taskStatusCode);
        this.usage.push({
          endpoint: path, queryType: 'serp_organic', targetKeyword: keywords[0] ?? null,
          targetLocation: primaryLocation?.location_name ?? locs[0] ?? null,
          requestCount: tasks.length, responseStatus: 'error', providerStatusCode: taskStatusCode,
          unitsUsed: tasks.length, costEstimate: cost, isSandbox,
          errorMessage: `${info.message} ${(task0?.status_message || '')}`.toString().slice(0, 500),
        });
        return { observations: [], rawSnapshotRef: null, meta: { ...baseMeta, error: true, providerStatusCode: taskStatusCode, statusReason: info.reason } };
      }

      // 3) Genuine success envelope — normalize and classify ok vs zero-items.
      const normalized = normalizeSerpResponse(body, {
        selfDomain: options?.selfDomain,
        isSandbox,
        includePaid: options?.includePaid,
        includeOrganic: options?.includeOrganic,
        includeLocalPack: options?.includeLocalPack,
      });
      const result0 = Array.isArray(task0?.result) ? task0.result[0] : undefined;
      const itemsCount = typeof result0?.items_count === 'number'
        ? result0.items_count
        : (Array.isArray(result0?.items) ? result0.items.length : 0);
      const hasObs = normalized.observations.length > 0;
      this.usage.push({
        endpoint: path, queryType: 'serp_organic', targetKeyword: keywords[0] ?? null,
        targetLocation: primaryLocation?.location_name ?? locs[0] ?? null,
        requestCount: tasks.length, responseStatus: hasObs ? 'ok' : 'empty',
        providerStatusCode: topStatusCode, unitsUsed: tasks.length, costEstimate: cost, isSandbox,
        errorMessage: hasObs ? null : `API returned OK (status ${topStatusCode}) but no SERP items (items_count=${itemsCount}); location="${primaryLocation?.location_name ?? ''}"${primaryLocation?.location_code != null ? ` (code ${primaryLocation.location_code})` : ''}. Inspect location/payload/parser — NOT a funds issue.`,
      });
      return { ...normalized, meta: { ...(normalized.meta || {}), ...baseMeta, itemsCount } };
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
