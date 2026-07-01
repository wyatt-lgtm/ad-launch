/**
 * Tests for the READ-ONLY website research-diagnostics endpoint
 *   GET /api/businesses/[id]/website/research-diagnostics
 *
 * Verifies:
 *  - auth / scoping (401 unauthenticated, 404 wrong business, 200 admin/owner)
 *  - it reuses buildWebsiteResearchContract + toResearchContractPayload
 *  - the response exposes every requested diagnostic field
 *  - the warning rule matches generation (warn only when discovery on + shouldWarn)
 *  - provider health maps to yes/no/unknown
 *  - DataForSEO detection uses the correct env-var names
 *  - it is strictly read-only (no write/mission/publish helpers invoked)
 */

const mockResolveBusinessAccess = jest.fn();
const mockBuildContract = jest.fn();
const mockToPayload = jest.fn();
const mockGetDfsConfig = jest.fn();

jest.mock('@/lib/tracking-auth', () => ({
  resolveBusinessAccess: (...a: any[]) => mockResolveBusinessAccess(...a),
}));
jest.mock('@/lib/website-research-contract', () => ({
  buildWebsiteResearchContract: (...a: any[]) => mockBuildContract(...a),
  toResearchContractPayload: (...a: any[]) => mockToPayload(...a),
}));
jest.mock('@/lib/dataforseo-provider', () => ({
  getDataForSeoConfig: (...a: any[]) => mockGetDfsConfig(...a),
}));

import { GET } from '@/app/api/businesses/[id]/website/research-diagnostics/route';

function makeReq(url = 'http://localhost/api/businesses/biz_1/website/research-diagnostics') {
  return { url } as any;
}

function providerReadyContract(overrides: Record<string, any> = {}) {
  return {
    businessId: 'biz_1',
    activeSearchProvider: 'dataforseo',
    providerConfigured: true,
    providerHealthy: true,
    providerSource: 'provider_registry',
    searchIntelligenceAvailable: false,
    latestSearchRunAt: null,
    seoMetaAnalysisId: null,
    approvedPageBriefId: null,
    researchStatus: 'research_ready',
    researchFreshnessStatus: 'none',
    targetKeywords: [],
    targetLocations: [],
    competitorUrls: [],
    competitorDomains: [],
    manualCompetitorUrls: [],
    competitorUrlCount: 0,
    hasManualCompetitorUrls: false,
    serpEvidenceSummary: [],
    fallbackReason: 'provider_ready_awaiting_keywords',
    warningState: 'provider_ready_no_keywords',
    diagnosticMessage: 'Search provider is ready. Add keywords and locations to run competitor discovery.',
    shouldWarn: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockToPayload.mockImplementation((c: any) => ({ business_id: c.businessId, should_warn: c.shouldWarn }));
  mockGetDfsConfig.mockReturnValue({ enabled: true, hasCredentials: true, useSandbox: false });
  process.env.DATAFORSEO_ENABLED = 'true';
  process.env.DATAFORSEO_API_LOGIN = 'login';
  process.env.DATAFORSEO_API_PASSWORD = 'pass';
});

describe('auth / scoping', () => {
  it('returns 401 when unauthenticated', async () => {
    mockResolveBusinessAccess.mockResolvedValue({ error: 'Unauthorized', status: 401 });
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    expect(res.status).toBe(401);
    expect(mockBuildContract).not.toHaveBeenCalled();
  });

  it('returns 404 for a wrong / non-owned business', async () => {
    mockResolveBusinessAccess.mockResolvedValue({ error: 'Business not found', status: 404 });
    const res = await GET(makeReq(), { params: { id: 'other' } });
    expect(res.status).toBe(404);
    expect(mockBuildContract).not.toHaveBeenCalled();
  });

  it('returns 200 for an authorized admin/owner', async () => {
    mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'u1', role: 'admin' }, business: { id: 'biz_1', businessName: 'B' } });
    mockBuildContract.mockResolvedValue(providerReadyContract());
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    expect(res.status).toBe(200);
    expect(mockBuildContract).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1' }));
  });
});

describe('response shape + diagnostics', () => {
  beforeEach(() => {
    mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'u1', role: 'user' }, business: { id: 'biz_1', businessName: 'B' } });
  });

  it('exposes all requested diagnostic fields (provider-ready case)', async () => {
    mockBuildContract.mockResolvedValue(providerReadyContract());
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    const body = await res.json();
    expect(body.readOnly).toBe(true);
    expect(body.searchDiagnostics).toBeDefined();
    expect(body.warnings).toEqual([]);
    expect(body.research_contract).toEqual({ business_id: 'biz_1', should_warn: false });
    expect(body.providerConfigured).toBe('yes');
    expect(body.providerHealthy).toBe('yes');
    expect(body.activeProvider).toBe('dataforseo');
    expect(body.dataForSeoConfigDetected).toBe('yes');
    expect(body.storedSearchIntelligenceAvailable).toBe('no');
    expect(body.latestSearchIntelligenceRunDate).toBeNull();
    expect(body.competitorUrlCount).toBe(0);
    expect(body.warningState).toBe('provider_ready_no_keywords');
    expect(body.diagnosticMessage).toContain('Add keywords and locations');
    expect(body.should_warn).toBe(false);
  });

  it('surfaces a warning ONLY when discovery is on and shouldWarn is true', async () => {
    mockBuildContract.mockResolvedValue(
      providerReadyContract({
        providerConfigured: false,
        providerHealthy: false,
        activeSearchProvider: null,
        warningState: 'none',
        shouldWarn: true,
        diagnosticMessage: 'No search provider or stored SEO research is available. Add competitor URLs manually or configure Search Intelligence.',
        fallbackReason: 'no_search_provider_or_stored_research',
      }),
    );
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    const body = await res.json();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('No search provider or stored SEO research');
    expect(body.providerHealthy).toBe('unknown'); // not configured -> unknown
  });

  it('does NOT warn when discovery is disabled even if shouldWarn is true', async () => {
    mockBuildContract.mockResolvedValue(providerReadyContract({ shouldWarn: true, warningState: 'none' }));
    const res = await GET(
      makeReq('http://localhost/api/businesses/biz_1/website/research-diagnostics?analyzeCompetitors=false'),
      { params: { id: 'biz_1' } },
    );
    const body = await res.json();
    expect(body.warnings).toEqual([]);
  });

  it('reports stored Search Intelligence + approved brief when present', async () => {
    mockBuildContract.mockResolvedValue(
      providerReadyContract({
        searchIntelligenceAvailable: true,
        latestSearchRunAt: '2026-06-24T15:04:00.000Z',
        approvedPageBriefId: 'brief_1',
        seoMetaAnalysisId: 'meta_1',
        warningState: 'stored_research',
        diagnosticMessage: 'Using stored Search Intelligence research from 2026-06-24.',
        shouldWarn: false,
      }),
    );
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    const body = await res.json();
    expect(body.storedSearchIntelligenceAvailable).toBe('yes');
    expect(body.latestSearchIntelligenceRunDate).toBe('2026-06-24T15:04:00.000Z');
    expect(body.approvedPageBriefId).toBe('brief_1');
    expect(body.metaAnalysisId).toBe('meta_1');
    expect(body.diagnosticMessage).toContain('Using stored Search Intelligence research');
  });

  it('reports DataForSEO NOT detected when env vars are missing', async () => {
    delete process.env.DATAFORSEO_API_LOGIN;
    mockBuildContract.mockResolvedValue(providerReadyContract());
    const res = await GET(makeReq(), { params: { id: 'biz_1' } });
    const body = await res.json();
    expect(body.dataForSeoConfigDetected).toBe('no');
    expect(body.dataForSeoEnvVarsChecked).toEqual(['DATAFORSEO_API_LOGIN', 'DATAFORSEO_API_PASSWORD', 'DATAFORSEO_ENABLED']);
  });

  it('passes query params (keyword/locations/competitorUrls) through to the helper', async () => {
    mockBuildContract.mockResolvedValue(providerReadyContract());
    await GET(
      makeReq('http://localhost/api/businesses/biz_1/website/research-diagnostics?targetKeyword=roof+repair&targetLocations=Austin,TX&competitorUrls=https://a.com,https://b.com'),
      { params: { id: 'biz_1' } },
    );
    expect(mockBuildContract).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        targetKeyword: 'roof repair',
        targetLocations: ['Austin', 'TX'],
        competitorUrls: ['https://a.com', 'https://b.com'],
      }),
    );
  });
});
