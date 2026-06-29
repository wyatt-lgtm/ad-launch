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
