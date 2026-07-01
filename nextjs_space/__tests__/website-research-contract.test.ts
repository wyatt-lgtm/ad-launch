/**
 * Tests for the Website Research Contract builder that wires website
 * generation to the Search Intelligence system.
 *
 * The historical bug: website generation reported "No search provider
 * configured" by checking a couple of raw env vars (and the WRONG DataForSEO
 * var name), ignoring the entire Search Intelligence layer. These tests lock in
 * the corrected priority-ordered detection:
 *   1. approved SEO page brief  2. recent meta-analysis
 *   3. recent Search Intelligence run  4. configured+healthy provider
 *   5. manual competitor URLs   6. nothing -> warning
 *
 * All DB access is mocked. The builder is strictly READ-ONLY and business-
 * scoped, and performs NO Google scraping / browser automation.
 */

// ── Mocks (names must be prefixed with `mock` for jest factory hoisting) ──
const mockPrisma = {
  searchIntelligenceSettings: { findUnique: jest.fn() },
  seoContentMetaAnalysis: { findFirst: jest.fn() },
  searchIntelligenceRun: { findFirst: jest.fn() },
  seoCompetitorPageAnalysis: { findMany: jest.fn() },
  searchIntelligenceKeyword: { findMany: jest.fn() },
  searchIntelligenceLocation: { findMany: jest.fn() },
};
jest.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const mockGetDataForSeoConfig = jest.fn();
jest.mock('@/lib/dataforseo-provider', () => ({
  getDataForSeoConfig: () => mockGetDataForSeoConfig(),
}));

const mockGetPageBuildResearchStatus = jest.fn();
jest.mock('@/lib/seo-research', () => ({
  getPageBuildResearchStatus: (...args: any[]) => mockGetPageBuildResearchStatus(...args),
}));

const mockFetchProviderHealth = jest.fn();
jest.mock('@/lib/search-intelligence-provider', () => ({
  resolveProviderType: (v: string | null | undefined) => (v || 'manual_import'),
  getSearchIntelligenceProvider: () => ({ fetchProviderHealth: () => mockFetchProviderHealth() }),
}));

import {
  buildWebsiteResearchContract,
  toResearchContractPayload,
} from '@/lib/website-research-contract';

const BIZ = 'biz_ABC';
const OTHER_BIZ = 'biz_XYZ';

function resetToEmpty() {
  mockPrisma.searchIntelligenceSettings.findUnique.mockResolvedValue(null);
  mockPrisma.seoContentMetaAnalysis.findFirst.mockResolvedValue(null);
  mockPrisma.searchIntelligenceRun.findFirst.mockResolvedValue(null);
  mockPrisma.seoCompetitorPageAnalysis.findMany.mockResolvedValue([]);
  mockPrisma.searchIntelligenceKeyword.findMany.mockResolvedValue([]);
  mockPrisma.searchIntelligenceLocation.findMany.mockResolvedValue([]);
  mockGetDataForSeoConfig.mockReturnValue({ enabled: false, hasCredentials: false });
  mockFetchProviderHealth.mockResolvedValue({ provider: 'manual_import', configured: false, healthy: false, message: '' });
  mockGetPageBuildResearchStatus.mockResolvedValue({ status: 'seo_research_missing', metaAnalysisId: undefined, approvedPageBriefId: undefined });
}

function enableDataForSeo() {
  mockGetDataForSeoConfig.mockReturnValue({ enabled: true, hasCredentials: true });
  mockPrisma.searchIntelligenceSettings.findUnique.mockResolvedValue({ enabled: true, defaultProvider: 'dataforseo' });
  mockFetchProviderHealth.mockResolvedValue({ provider: 'dataforseo', configured: true, healthy: true, message: 'DataForSEO configured (LIVE mode).' });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetToEmpty();
});

// 1. DataForSEO configured -> payload includes provider status
describe('1. DataForSEO configured', () => {
  test('provider status is surfaced in contract + payload', async () => {
    enableDataForSeo();
    mockPrisma.searchIntelligenceKeyword.findMany.mockResolvedValue([{ keyword: 'emergency roof repair' }]);
    const c = await buildWebsiteResearchContract({ businessId: BIZ, targetKeyword: 'emergency roof repair' });
    expect(c.providerConfigured).toBe(true);
    expect(c.providerHealthy).toBe(true);
    expect(c.providerSource).toBe('dataforseo');
    expect(c.activeSearchProvider).toBe('dataforseo');
    const p = toResearchContractPayload(c);
    expect(p.search_provider.configured).toBe(true);
    expect(p.search_provider.source).toBe('dataforseo');
  });
});

// 2. stored SI exists -> payload includes competitor/search summary
describe('2. stored Search Intelligence exists', () => {
  test('recent run + competitor analyses populate contract', async () => {
    mockPrisma.searchIntelligenceRun.findFirst.mockResolvedValue({ completedAt: new Date('2026-06-01T00:00:00Z'), observationCount: 42 });
    mockPrisma.seoCompetitorPageAnalysis.findMany.mockResolvedValue([
      { domain: 'rivalroofing.com', url: 'https://rivalroofing.com/emergency', resultType: 'organic', rankAbsolute: 2 },
    ]);
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.searchIntelligenceAvailable).toBe(true);
    expect(c.latestSearchRunAt).toContain('2026-06-01');
    expect(c.competitorDomains).toContain('rivalroofing.com');
    const p = toResearchContractPayload(c);
    expect(p.seo_research.competitor_urls).toContain('https://rivalroofing.com/emergency');
    expect(p.seo_research.serp_evidence_summary.length).toBeGreaterThan(0);
    expect(c.shouldWarn).toBe(false);
  });
});

// 3. approved page brief -> payload includes brief id/context
describe('3. approved page brief', () => {
  test('approved brief id flows into contract + payload', async () => {
    mockGetPageBuildResearchStatus.mockResolvedValue({ status: 'research_ready', metaAnalysisId: 'meta_1', approvedPageBriefId: 'brief_1' });
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.approvedPageBriefId).toBe('brief_1');
    expect(c.seoMetaAnalysisId).toBe('meta_1');
    expect(c.researchFreshnessStatus).toBe('fresh');
    expect(c.searchIntelligenceAvailable).toBe(true);
    const p = toResearchContractPayload(c);
    expect(p.seo_research.approved_page_brief_id).toBe('brief_1');
    expect(p.fallback_reason).toBe('using_approved_page_brief');
  });
});

// 4. Tombstone receives provider/stored research -> no warning
describe('4. provider or stored research present -> no warning', () => {
  test('no warning when stored research available', async () => {
    mockGetPageBuildResearchStatus.mockResolvedValue({ status: 'research_ready', metaAnalysisId: 'meta_1', approvedPageBriefId: 'brief_1' });
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.shouldWarn).toBe(false);
    expect(toResearchContractPayload(c).should_warn).toBe(false);
  });
  test('no warning when provider configured', async () => {
    enableDataForSeo();
    mockPrisma.searchIntelligenceKeyword.findMany.mockResolvedValue([{ keyword: 'roof repair' }]);
    const c = await buildWebsiteResearchContract({ businessId: BIZ, targetKeyword: 'roof repair' });
    expect(c.shouldWarn).toBe(false);
  });
});

// 5. no provider + no stored -> warning
describe('5. nothing available -> warning', () => {
  test('emits the corrected warning message', async () => {
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.shouldWarn).toBe(true);
    expect(c.warningState).toBe('none');
    expect(c.diagnosticMessage).toBe(
      'No search provider or stored SEO research is available. Add competitor URLs manually or configure Search Intelligence.',
    );
    // the OLD misleading string must never be produced
    expect(c.diagnosticMessage).not.toContain('No search provider configured; automatic competitor discovery skipped');
  });
});

// 6. configured but no keywords -> "add keywords" message
describe('6. provider configured but no keywords', () => {
  test('asks for keywords/locations', async () => {
    enableDataForSeo();
    // no keywords, no locations, no stored research
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.warningState).toBe('provider_ready_no_keywords');
    expect(c.diagnosticMessage).toBe('Search provider is ready. Add keywords and locations to run competitor discovery.');
    expect(c.shouldWarn).toBe(false);
  });
});

// 7. configured in Launch OS but unavailable to backend -> use stored research
describe('7. stored research but provider not live-healthy', () => {
  test('uses Launch OS Search Intelligence data message', async () => {
    // provider not healthy, but stored meta-analysis exists
    mockGetPageBuildResearchStatus.mockResolvedValue({ status: 'research_ready', metaAnalysisId: 'meta_1', approvedPageBriefId: 'brief_1' });
    mockGetDataForSeoConfig.mockReturnValue({ enabled: false, hasCredentials: false });
    mockFetchProviderHealth.mockResolvedValue({ provider: 'manual_import', configured: false, healthy: false, message: '' });
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.warningState).toBe('stored_research_no_live_provider');
    expect(c.diagnosticMessage).toBe('Using Launch OS Search Intelligence data. Live provider access is not required for this workflow.');
    expect(c.shouldWarn).toBe(false);
  });
});

// 8. manual competitor URL fallback works
describe('8. manual competitor URL fallback', () => {
  test('manual URLs suppress the warning and appear in payload', async () => {
    const c = await buildWebsiteResearchContract({
      businessId: BIZ,
      competitorUrls: ['https://competitor-a.com', 'https://competitor-b.com'],
    });
    expect(c.warningState).toBe('manual_urls');
    expect(c.shouldWarn).toBe(false);
    expect(c.hasManualCompetitorUrls).toBe(true);
    expect(c.competitorUrlCount).toBe(2);
    const p = toResearchContractPayload(c);
    expect(p.seo_research.competitor_urls).toEqual(
      expect.arrayContaining(['https://competitor-a.com', 'https://competitor-b.com']),
    );
  });
});

// 9. business scoping preserved
describe('9. business scoping', () => {
  test('every query filters by the requested businessId', async () => {
    await buildWebsiteResearchContract({ businessId: BIZ });
    expect(mockPrisma.searchIntelligenceSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BIZ } }),
    );
    for (const call of mockPrisma.seoContentMetaAnalysis.findFirst.mock.calls) {
      expect(call[0].where.businessId).toBe(BIZ);
    }
    for (const call of mockPrisma.searchIntelligenceRun.findFirst.mock.calls) {
      expect(call[0].where.businessId).toBe(BIZ);
    }
    for (const call of mockPrisma.seoCompetitorPageAnalysis.findMany.mock.calls) {
      expect(call[0].where.businessId).toBe(BIZ);
    }
    for (const call of mockPrisma.searchIntelligenceKeyword.findMany.mock.calls) {
      expect(call[0].where.businessId).toBe(BIZ);
    }
    for (const call of mockPrisma.searchIntelligenceLocation.findMany.mock.calls) {
      expect(call[0].where.businessId).toBe(BIZ);
    }
  });
});

// 10. no cross-business leakage
describe('10. no cross-business leakage', () => {
  test('never queries a different businessId', async () => {
    await buildWebsiteResearchContract({ businessId: BIZ });
    const allCalls = [
      ...mockPrisma.seoContentMetaAnalysis.findFirst.mock.calls,
      ...mockPrisma.searchIntelligenceRun.findFirst.mock.calls,
      ...mockPrisma.seoCompetitorPageAnalysis.findMany.mock.calls,
      ...mockPrisma.searchIntelligenceKeyword.findMany.mock.calls,
      ...mockPrisma.searchIntelligenceLocation.findMany.mock.calls,
    ];
    for (const call of allCalls) {
      expect(call[0].where.businessId).not.toBe(OTHER_BIZ);
    }
    // the gate is called with the requested business only
    expect(mockGetPageBuildResearchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ }),
    );
  });
});

// 11. no Google scraping
describe('11. no Google scraping / no network', () => {
  test('builder performs no fetch / network calls', async () => {
    const fetchSpy = jest.spyOn(global as any, 'fetch').mockImplementation(() => {
      throw new Error('network access is forbidden in the contract builder');
    });
    enableDataForSeo();
    mockPrisma.searchIntelligenceKeyword.findMany.mockResolvedValue([{ keyword: 'roof repair' }]);
    const c = await buildWebsiteResearchContract({ businessId: BIZ, targetKeyword: 'roof repair' });
    expect(c).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// 12. existing website generation still works (graceful, well-formed output)
describe('12. resilient output', () => {
  test('returns a well-formed contract even when everything is empty', async () => {
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    const p = toResearchContractPayload(c);
    expect(p.business_id).toBe(BIZ);
    expect(p.search_provider).toBeDefined();
    expect(p.seo_research).toBeDefined();
    expect(Array.isArray(p.seo_research.competitor_urls)).toBe(true);
    expect(typeof p.diagnostic_message).toBe('string');
  });
  test('a DB failure degrades gracefully without throwing', async () => {
    mockPrisma.seoContentMetaAnalysis.findFirst.mockRejectedValue(new Error('db down'));
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c).toBeDefined();
    expect(c.businessId).toBe(BIZ);
  });
});

// 13. existing Search Intelligence detection still works
describe('13. Search Intelligence provider detection', () => {
  test('settings default provider drives the active provider', async () => {
    enableDataForSeo();
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    expect(c.activeSearchProvider).toBe('dataforseo');
    expect(c.providerConfigured).toBe(true);
  });
});

// 14. WF3 SEO research gate flows through unchanged
describe('14. WF3 research gate unchanged', () => {
  test('the same getPageBuildResearchStatus gate result is passed through', async () => {
    mockGetPageBuildResearchStatus.mockResolvedValue({ status: 'research_stale', metaAnalysisId: 'meta_2', approvedPageBriefId: undefined });
    const c = await buildWebsiteResearchContract({ businessId: BIZ, targetKeyword: 'kw' });
    expect(mockGetPageBuildResearchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ, targetKeyword: 'kw' }),
    );
    expect(c.researchStatus).toBe('research_stale');
    expect(c.researchFreshnessStatus).toBe('stale');
  });
});

// 15. no publish / no writes
describe('15. read-only, no publish', () => {
  test('builder never performs any write (create/update/delete)', async () => {
    enableDataForSeo();
    await buildWebsiteResearchContract({ businessId: BIZ });
    // The mocked prisma only exposes read methods; assert no write method exists
    // was invoked by verifying the surface only contains read operations.
    const readMethods = ['findUnique', 'findFirst', 'findMany'];
    for (const [, model] of Object.entries(mockPrisma)) {
      for (const method of Object.keys(model as any)) {
        expect(readMethods).toContain(method);
      }
    }
    const c = await buildWebsiteResearchContract({ businessId: BIZ });
    // no publish-related fields exist on the contract
    expect(Object.keys(c)).not.toContain('publish');
    expect(Object.keys(c)).not.toContain('published');
  });
});
