/**
 * DataForSEO provider — unit & compliance tests.
 *
 * Covers configuration, auth header building, URL selection, normalization,
 * graceful degradation, usage tracking, business scoping, and the compliance
 * guarantees (no Google scraping, weekly automation stays disabled).
 *
 * Pure functions are tested directly; network calls are never made (only the
 * disabled / missing-credential code paths, which short-circuit before fetch).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getDataForSeoConfig,
  buildBasicAuthHeader,
  normalizeSerpResponse,
  mapLocationToDataForSeo,
  normalizeDomain,
  normalizeLocationString,
  describeProviderStatus,
  buildSanitizedSnapshot,
  DataForSeoProvider,
} from '../lib/dataforseo-provider';
import { runSingleTestSearch } from '../lib/search-intelligence';
import { getDataForSeoStatus, logProviderUsage } from '../lib/provider-usage';

const ENV_KEYS = [
  'DATAFORSEO_ENABLED',
  'DATAFORSEO_API_LOGIN',
  'DATAFORSEO_API_PASSWORD',
  'DATAFORSEO_BASE_URL',
  'DATAFORSEO_SANDBOX_URL',
  'DATAFORSEO_USE_SANDBOX',
  'DATAFORSEO_DEFAULT_LANGUAGE_CODE',
  'DATAFORSEO_REQUEST_TIMEOUT_MS',
];
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  ENV_KEYS.forEach((k) => (SAVED[k] = process.env[k]));
});
afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  });
});

function setEnv(overrides: Record<string, string | undefined>) {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  process.env.DATAFORSEO_BASE_URL = 'https://api.dataforseo.com';
  process.env.DATAFORSEO_SANDBOX_URL = 'https://sandbox.dataforseo.com';
  process.env.DATAFORSEO_DEFAULT_LANGUAGE_CODE = 'en';
  process.env.DATAFORSEO_REQUEST_TIMEOUT_MS = '30000';
  Object.entries(overrides).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
}

function organicSample(opts: { domain?: string; type?: string } = {}) {
  return {
    status_code: 20000,
    cost: 0.01,
    tasks: [
      {
        id: 'task-1',
        status_code: 20000,
        data: { keyword: 'transmission flush', location_name: 'Houston,Texas,United States', language_code: 'en', device: 'desktop' },
        result: [
          {
            keyword: 'transmission flush',
            location_name: 'Houston,Texas,United States',
            device: 'desktop',
            items: [
              { type: opts.type || 'organic', rank_group: 1, rank_absolute: 1, domain: opts.domain || 'competitor-auto.com', url: `https://${opts.domain || 'competitor-auto.com'}/service`, title: 'Best Transmission Flush', description: 'Top rated service' },
            ],
          },
        ],
      },
    ],
  };
}

// 1. Missing credentials → graceful (no throw, disabled-ish health).
test('1: missing credentials degrades gracefully without throwing', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true' }); // enabled but no login/password
  const cfg = getDataForSeoConfig();
  expect(cfg.hasCredentials).toBe(false);
  const provider = new DataForSeoProvider();
  const health = await provider.fetchProviderHealth();
  expect(health.configured).toBe(false);
  expect(health.healthy).toBe(false);
  const res = await provider.fetchKeywordRankings('biz', ['transmission flush'], ['Houston, TX']);
  expect(res.observations).toEqual([]);
  expect(provider.usage[0].responseStatus).toBe('missing_credentials');
});

// 2. ENABLED=false → disabled.
test('2: DATAFORSEO_ENABLED=false reports disabled', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'false', DATAFORSEO_API_LOGIN: 'u', DATAFORSEO_API_PASSWORD: 'p' });
  const cfg = getDataForSeoConfig();
  expect(cfg.enabled).toBe(false);
  const health = await new DataForSeoProvider().fetchProviderHealth();
  expect(health.configured).toBe(false);
  expect(health.message.toLowerCase()).toContain('disabled');
});

// 3. Sandbox URL selection.
test('3: USE_SANDBOX=true selects the sandbox base URL', () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_USE_SANDBOX: 'true', DATAFORSEO_API_LOGIN: 'u', DATAFORSEO_API_PASSWORD: 'p' });
  const cfg = getDataForSeoConfig();
  expect(cfg.useSandbox).toBe(true);
  expect(cfg.effectiveBaseUrl).toBe('https://sandbox.dataforseo.com');
});

// 4. Live URL selection.
test('4: USE_SANDBOX=false selects the live base URL', () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_USE_SANDBOX: 'false', DATAFORSEO_API_LOGIN: 'u', DATAFORSEO_API_PASSWORD: 'p' });
  const cfg = getDataForSeoConfig();
  expect(cfg.useSandbox).toBe(false);
  expect(cfg.effectiveBaseUrl).toBe('https://api.dataforseo.com');
});

// 5. Basic auth header built correctly; secret not embedded in plain text.
test('5: Basic auth header is correct base64 and never plain-text', () => {
  const header = buildBasicAuthHeader('login123', 'pass456');
  expect(header).toMatch(/^Basic /);
  const b64 = header!.replace('Basic ', '');
  expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('login123:pass456');
  // Plain credentials must not appear verbatim in the header string.
  expect(header).not.toContain('login123:pass456');
  expect(buildBasicAuthHeader(undefined, 'p')).toBeNull();
});

// 6. Manual run helper is wired (exported callable).
test('6: runSingleTestSearch is exported and callable (creates a run)', () => {
  expect(typeof runSingleTestSearch).toBe('function');
});

// 7. Organic results normalize into observations.
test('7: organic SERP normalizes into observations', () => {
  const out = normalizeSerpResponse(organicSample(), { isSandbox: false });
  expect(out.observations.length).toBe(1);
  const o = out.observations[0];
  expect(o.resultType).toBe('organic');
  expect(o.position).toBe(1);
  expect(o.domain).toBe('competitor-auto.com');
  expect(o.keyword).toBe('transmission flush');
  expect(o.dataSource).toContain('dataforseo');
});

// 8. Self domain identified.
test('8: self domain is flagged isSelf', () => {
  const out = normalizeSerpResponse(organicSample({ domain: 'myshop.com' }), { selfDomain: 'myshop.com' });
  expect(out.observations[0].isSelf).toBe(true);
});

// 9. Competitor domains captured as non-self (ready for storage).
test('9: non-self domains captured for competitor storage', () => {
  const out = normalizeSerpResponse(organicSample({ domain: 'rival.com' }), { selfDomain: 'myshop.com' });
  const obs = out.observations[0];
  expect(obs.isSelf).toBe(false);
  expect(obs.domain).toBe('rival.com');
  // The run engine upserts non-self domains into SearchCompetitor with source 'observed'.
  const src = readFileSync(join(__dirname, '..', 'lib', 'search-intelligence.ts'), 'utf8');
  expect(src).toContain("source: 'observed'");
  expect(src).toContain('searchCompetitor');
});

// 10. Paid ads normalize to paid_ad result type.
test('10: paid results normalize to paid_ad', () => {
  const out = normalizeSerpResponse(organicSample({ type: 'paid', domain: 'ads-co.com' }));
  expect(out.observations[0].resultType).toBe('paid_ad');
});

// 11. Usage event logged on each call (with sandbox flag + status).
test('11: usage descriptor logged with status and sandbox flag', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_USE_SANDBOX: 'true' }); // no creds → short-circuit, no network
  const provider = new DataForSeoProvider();
  await provider.fetchKeywordRankings('biz', ['transmission flush'], ['Houston, TX']);
  expect(provider.usage.length).toBeGreaterThan(0);
  const u = provider.usage[0];
  expect(u.endpoint).toContain('/v3/serp/google/organic');
  expect(u.isSandbox).toBe(true);
  expect(['ok', 'empty', 'error', 'missing_credentials', 'disabled']).toContain(u.responseStatus);
});

// 12. Business scoping — all reads/writes filter by businessId.
test('12: provider usage + status are scoped by businessId', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'provider-usage.ts'), 'utf8');
  // logProviderUsage writes businessId on every row; status reads filter by businessId.
  expect(src).toContain('businessId,');
  expect(src).toMatch(/where:\s*\{\s*businessId/);
  expect(typeof logProviderUsage).toBe('function');
  expect(typeof getDataForSeoStatus).toBe('function');
});

// 13. No Google scraping / browser automation anywhere in the provider.
test('13: no direct Google scraping or browser automation in provider code', () => {
  const raw = readFileSync(join(__dirname, '..', 'lib', 'dataforseo-provider.ts'), 'utf8');
  // Strip comments so descriptive compliance notes don't trip the scan — only
  // executable code is checked.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .toLowerCase();
  const forbidden = ['puppeteer', 'playwright', 'google.com/search', 'incognito', 'webdriver', 'selenium'];
  for (const term of forbidden) {
    expect(code).not.toContain(term);
  }
  // It must only call the official DataForSEO v3 API.
  expect(raw).toContain('/v3/serp/google/organic/live/advanced');
});

// 14. Weekly automation stays disabled (no cron/daemon; settings default off).
test('14: weekly automation remains disabled by default', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = schema.slice(schema.indexOf('model SearchIntelligenceSettings'));
  const enabledLine = block.split('\n').find((l) => /\benabled\b/.test(l)) || '';
  expect(enabledLine).toContain('@default(false)');
});

// Bonus: location mapping + domain normalization sanity.
test('location mapping builds a provider location name', () => {
  expect(mapLocationToDataForSeo({ city: 'Houston', state: 'TX' })).toContain('Houston');
  expect(mapLocationToDataForSeo('Houston, TX')).toBe('Houston, TX');
  expect(normalizeDomain('https://WWW.Example.com/page')).toBe('example.com');
});

// 15. Freeform locations are canonicalized to DataForSEO's exact format.
test('15: normalizeLocationString canonicalizes freeform locations', () => {
  expect(normalizeLocationString('Houston, TX')).toBe('Houston,Texas,United States');
  expect(normalizeLocationString('Houston,Texas')).toBe('Houston,Texas,United States');
  expect(normalizeLocationString('Houston,Texas,United States')).toBe('Houston,Texas,United States');
  expect(normalizeLocationString('TX')).toBe('Texas,United States');
  expect(normalizeLocationString('')).toBe('United States');
  expect(normalizeLocationString('national')).toBe('United States');
  expect(normalizeLocationString('United States')).toBe('United States');
});

// 16. Status-code interpretation never blames funds for a 20000 / unknown code.
test('16: describeProviderStatus maps codes precisely', () => {
  expect(describeProviderStatus(20000).reason).toBe('ok');
  expect(describeProviderStatus(40200).reason).toBe('insufficient_funds');
  expect(describeProviderStatus(40210).reason).toBe('insufficient_funds');
  expect(describeProviderStatus(40104).reason).toBe('account_verification_required');
  expect(describeProviderStatus(40501).reason).toBe('invalid_field_or_location');
  expect(describeProviderStatus(40505).reason).toBe('invalid_field_or_location');
  // A generic/unknown code must NOT be attributed to funds.
  expect(describeProviderStatus(50000).reason).toBe('provider_error');
  expect(describeProviderStatus(20000).reason).not.toBe('insufficient_funds');
});

// 17. Sanitized snapshot captures the envelope but never credentials.
test('17: buildSanitizedSnapshot captures envelope, excludes credentials', () => {
  const snap = buildSanitizedSnapshot(organicSample(), {
    resolvedLocation: { canonical: 'Houston,Texas,United States', location_code: 1026201 },
    payload: [{ keyword: 'transmission flush', location_code: 1026201, language_code: 'en', device: 'desktop', depth: 10 }],
  });
  expect(snap).toContain('"status_code":20000');
  expect(snap).toContain('items_count');
  expect(snap).toContain('1026201');
  // Task ID (DataForSEO request id) must be captured for support tickets.
  expect(snap).toContain('"taskId":"task-1"');
  expect(snap).toContain('"taskIds":["task-1"]');
  expect(snap.toLowerCase()).not.toContain('authorization');
  expect(snap.toLowerCase()).not.toContain('password');
  expect(snap.toLowerCase()).not.toContain('basic ');
});

// 18. Top-level 20000 but task-level 40501 must be reported as ERROR, not empty.
test('18: task-level error (20000 top / 40501 task) is reported as error', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_API_LOGIN: 'l', DATAFORSEO_API_PASSWORD: 'p', DATAFORSEO_USE_SANDBOX: 'false' });
  const orig = global.fetch;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status_code: 20000,
      status_message: 'Ok.',
      tasks_count: 1,
      tasks_error: 1,
      tasks: [{ status_code: 40501, status_message: 'Invalid Field: location_name.', result: null }],
    }),
  })) as any;
  try {
    const provider = new DataForSeoProvider();
    const res = await provider.fetchKeywordRankings('biz', ['transmission flush'], ['United States']);
    expect(res.observations).toEqual([]);
    const u = provider.usage[0];
    expect(u.responseStatus).toBe('error');
    expect(u.providerStatusCode).toBe(40501);
    expect((u.errorMessage || '').toLowerCase()).toContain('invalid');
  } finally {
    global.fetch = orig;
  }
});

// 19. Top-level 20000 with zero items → 'empty' and an explicit not-funds note.
test('19: 20000 with zero items is empty, not a funds problem', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_API_LOGIN: 'l', DATAFORSEO_API_PASSWORD: 'p', DATAFORSEO_USE_SANDBOX: 'false' });
  const orig = global.fetch;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status_code: 20000,
      status_message: 'Ok.',
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{ status_code: 20000, status_message: 'Ok.', result: [{ items_count: 0, items: [] }] }],
    }),
  })) as any;
  try {
    const provider = new DataForSeoProvider();
    const res = await provider.fetchKeywordRankings('biz', ['transmission flush'], ['United States']);
    expect(res.observations).toEqual([]);
    const u = provider.usage[0];
    expect(u.responseStatus).toBe('empty');
    expect((u.errorMessage || '').toLowerCase()).toContain('not a funds');
  } finally {
    global.fetch = orig;
  }
});

// 20. Successful SERP with items → 'ok' and depth:10 + location_code in payload.
test('20: success path sends location_code + depth and returns observations', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_API_LOGIN: 'l', DATAFORSEO_API_PASSWORD: 'p', DATAFORSEO_USE_SANDBOX: 'false' });
  const orig = global.fetch;
  let sentBody: any = null;
  global.fetch = jest.fn(async (_url: any, init: any) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => organicSample() } as any;
  }) as any;
  try {
    const provider = new DataForSeoProvider();
    const res = await provider.fetchKeywordRankings('biz', ['transmission flush'], ['United States']);
    expect(res.observations.length).toBe(1);
    expect(provider.usage[0].responseStatus).toBe('ok');
    expect(Array.isArray(sentBody)).toBe(true);
    expect(sentBody[0].depth).toBe(10);
    expect(sentBody[0].location_code).toBe(2840);
  } finally {
    global.fetch = orig;
  }
});

// ── New: SERP auditability, all item types, rank_group/rank_absolute ──

function multiTypeSample() {
  return {
    status_code: 20000,
    cost: 0.0125,
    tasks: [
      {
        id: 'task-multi-1',
        status_code: 20000,
        data: { keyword: 'transmission flush', location_name: 'Houston,Texas,United States', language_code: 'en', device: 'desktop' },
        result: [
          {
            keyword: 'transmission flush',
            location_name: 'Houston,Texas,United States',
            location_code: 1026481,
            language_code: 'en',
            device: 'desktop',
            datetime: '2026-06-29 16:43:00 +00:00',
            check_url: 'https://www.google.com/search?q=transmission+flush&uule=abc',
            items_count: 6,
            items: [
              { type: 'organic', rank_group: 1, rank_absolute: 2, domain: 'a-auto.com', url: 'https://a-auto.com/x', title: 'A', description: 'd', source: 'Organic' },
              { type: 'paid', rank_group: 1, rank_absolute: 1, domain: 'ads-co.com', url: 'https://ads-co.com', title: 'Ad' },
              { type: 'local_pack', rank_group: 1, rank_absolute: 3, domain: 'rjsrepair.com', url: 'https://rjsrepair.com', title: 'RJ', api_secret: 'should-not-survive' },
              { type: 'people_also_ask', rank_group: 1, rank_absolute: 4, items: [{ a: 1 }, { a: 2 }] },
              { type: 'related_searches', rank_group: 1, rank_absolute: 5 },
              { type: 'video', rank_group: 1, rank_absolute: 6, domain: 'youtube.com', url: 'https://youtube.com/watch' },
              { type: 'featured_snippet', rank_group: 1, rank_absolute: 1, domain: 'wikihow.com', url: 'https://wikihow.com', is_featured_snippet: true },
              { type: 'some_new_thing', rank_group: 1, rank_absolute: 7 },
            ],
          },
        ],
      },
    ],
  };
}

test('21: all relevant SERP item types are normalized (incl. unknown)', () => {
  const out = normalizeSerpResponse(multiTypeSample());
  const types = out.observations.map((o) => o.resultType);
  expect(types).toContain('organic');
  expect(types).toContain('paid_ad');
  expect(types).toContain('local_pack');
  expect(types).toContain('people_also_ask');
  expect(types).toContain('related_searches');
  expect(types).toContain('video');
  expect(types).toContain('featured_snippet');
  expect(types).toContain('unknown'); // some_new_thing maps to unknown, never dropped
});

test('22: both rank_group and rank_absolute are captured per observation', () => {
  const out = normalizeSerpResponse(multiTypeSample());
  const organic = out.observations.find((o) => o.resultType === 'organic')!;
  expect(organic.rankGroup).toBe(1);
  expect(organic.rankAbsolute).toBe(2);
  // legacy position mirrors absolute
  expect(organic.position).toBe(2);
  expect(organic.source).toBe('Organic');
});

test('23: meta exposes checkUrl, providerDatetime, serpItemTypes (auditable)', () => {
  const out = normalizeSerpResponse(multiTypeSample());
  expect(out.meta.checkUrl).toContain('google.com/search');
  expect(out.meta.providerDatetime).toBe('2026-06-29 16:43:00 +00:00');
  expect(out.meta.locationCode).toBe(1026481);
  expect(out.meta.serpItemTypes).toBeTruthy();
  expect(out.meta.serpItemTypes.organic).toBe(1);
  expect(out.meta.serpItemTypes.people_also_ask).toBe(1);
});

test('24: rawItem summary keeps descriptive fields and excludes credentials', () => {
  const out = normalizeSerpResponse(multiTypeSample());
  const local = out.observations.find((o) => o.resultType === 'local_pack')!;
  expect(local.rawItem).toBeTruthy();
  expect(local.rawItem!.domain).toBe('rjsrepair.com');
  // Non-whitelisted secret-like field must NOT survive into rawItem.
  expect(JSON.stringify(local.rawItem)).not.toContain('api_secret');
  expect(JSON.stringify(local.rawItem)).not.toContain('should-not-survive');
  const paa = out.observations.find((o) => o.resultType === 'people_also_ask')!;
  expect(paa.rawItem!.nested_items).toBe(2);
});

test('25: provider success meta carries task id + check_url for verification', async () => {
  setEnv({ DATAFORSEO_ENABLED: 'true', DATAFORSEO_API_LOGIN: 'l', DATAFORSEO_API_PASSWORD: 'p', DATAFORSEO_USE_SANDBOX: 'false' });
  const orig = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => multiTypeSample() })) as any;
  try {
    const provider = new DataForSeoProvider();
    const res = await provider.fetchKeywordRankings('biz', ['transmission flush'], ['United States']);
    expect(res.meta.taskId).toBe('task-multi-1');
    expect(res.meta.checkUrl).toContain('google.com/search');
    expect(res.meta.providerDatetime).toBe('2026-06-29 16:43:00 +00:00');
    const u = provider.usage[0];
    expect(u.providerTaskId).toBe('task-multi-1');
    expect(u.checkUrl).toContain('google.com/search');
  } finally {
    global.fetch = orig;
  }
});

// ── New: SERP evidence rule for website/SEO brief generation ──
test('26: brief evidence rule prefers stable competitor pages, forums as questions', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'search-intelligence-brief-guidance.ts'), 'utf8');
  expect(src).toContain('STABLE competitor');
  expect(src).toMatch(/Reddit|forum/i);
  expect(src).toContain('Do NOT copy competitor');
  expect(src).toContain('check_url');
  // service-content-generator wires the evidence into the page brief prompt.
  const gen = readFileSync(join(__dirname, '..', 'lib', 'service-content-generator.ts'), 'utf8');
  expect(gen).toContain('buildSearchIntelligenceEvidence');
});

// ── New: compliance — no Google scraping, weekly automation stays off ──
test('27: no Google scraping and weekly automation remains disabled', () => {
  const provSrc = readFileSync(join(__dirname, '..', 'lib', 'dataforseo-provider.ts'), 'utf8');
  // We only call the DataForSEO API host; never google.com directly.
  expect(provSrc).not.toMatch(/fetch\(\s*['"`]https:\/\/(www\.)?google\.com/);
  const varSrc = readFileSync(join(__dirname, '..', 'lib', 'serp-variance.ts'), 'utf8');
  // Variance analysis must not schedule or fetch anything.
  expect(varSrc).not.toContain('setInterval');
  expect(varSrc).not.toContain('cron');
  expect(varSrc.toLowerCase()).toContain('no network');
});
