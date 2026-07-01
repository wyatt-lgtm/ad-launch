/**
 * Milestone 1 — sitemap-first persistence layer.
 *
 * Asserts that every read/write is business-scoped (test 14: no cross-business
 * leakage) and that saving a sitemap persists denormalized approval state.
 */
const mockDiscoveryCreate = jest.fn();
const mockDiscoveryFindFirst = jest.fn();
const mockSitemapCreate = jest.fn();
const mockSitemapFindFirst = jest.fn();
const mockSitemapUpdateMany = jest.fn();
const mockRevisionCreate = jest.fn();
const mockRevisionFindMany = jest.fn();

jest.mock('@/lib/db', () => ({
  prisma: {
    websiteServiceDiscovery: {
      create: (...a: any[]) => mockDiscoveryCreate(...a),
      findFirst: (...a: any[]) => mockDiscoveryFindFirst(...a),
    },
    websiteSitemap: {
      create: (...a: any[]) => mockSitemapCreate(...a),
      findFirst: (...a: any[]) => mockSitemapFindFirst(...a),
      updateMany: (...a: any[]) => mockSitemapUpdateMany(...a),
    },
    websiteSitemapRevision: {
      create: (...a: any[]) => mockRevisionCreate(...a),
      findMany: (...a: any[]) => mockRevisionFindMany(...a),
    },
  },
}));

import {
  saveServiceDiscovery,
  loadLatestSitemap,
  loadSitemapById,
  saveSitemap,
  updateSitemapArtifact,
  saveSitemapRevision,
  listSitemapRevisions,
  resolveCopyGate,
} from '@/lib/website-sitemap-store';
import {
  generateSitemap,
  approveSitemap,
  classifyService,
  addUserRequestedPage,
  WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';

const HOUSTON = { city: 'Houston', state: 'Texas' };

function sampleSitemap(): WebsiteSitemapArtifact {
  return generateSitemap({
    businessName: 'West Houston Auto Repair',
    industry: 'Auto Repair',
    businessType: 'Auto Repair Shop',
    serviceCategoryLabel: 'Auto Repair',
    primaryServiceArea: HOUSTON,
    services: [classifyService({ serviceName: 'Brake Repair', source: 'user', userSelected: true })],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('business scoping (test 14 — no cross-business leakage)', () => {
  it('loadLatestSitemap always filters by businessId', async () => {
    mockSitemapFindFirst.mockResolvedValue(null);
    await loadLatestSitemap('biz-A', 'proj-1');
    expect(mockSitemapFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz-A', websiteProjectId: 'proj-1' }) }),
    );
  });

  it('loadSitemapById scopes by businessId (rejects other businesses)', async () => {
    mockSitemapFindFirst.mockResolvedValue(null);
    await loadSitemapById('biz-A', 'sitemap-99');
    expect(mockSitemapFindFirst).toHaveBeenCalledWith({ where: { id: 'sitemap-99', businessId: 'biz-A' } });
  });

  it('updateSitemapArtifact keeps businessId in the WHERE clause', async () => {
    mockSitemapUpdateMany.mockResolvedValue({ count: 1 });
    await updateSitemapArtifact({ businessId: 'biz-A', sitemapId: 's1', sitemap: sampleSitemap() });
    const arg = mockSitemapUpdateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 's1', businessId: 'biz-A' });
  });

  it('saveSitemapRevision refuses to write when the sitemap is not owned by the business', async () => {
    mockSitemapFindFirst.mockResolvedValue(null); // not owned
    const { revision } = addUserRequestedPage(sampleSitemap(), { title: 'Tombstone vs Tabloo', requestedByUserId: 'u1' });
    const res = await saveSitemapRevision({ businessId: 'biz-A', sitemapId: 's-other', revision });
    expect(res).toBeNull();
    expect(mockRevisionCreate).not.toHaveBeenCalled();
    expect(mockSitemapFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-other', businessId: 'biz-A' } }),
    );
  });

  it('listSitemapRevisions filters by businessId + sitemapId', async () => {
    mockRevisionFindMany.mockResolvedValue([]);
    await listSitemapRevisions('biz-A', 's1');
    expect(mockRevisionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz-A', sitemapId: 's1' } }),
    );
  });
});

describe('persistence writes', () => {
  it('saveServiceDiscovery persists counts + businessId', async () => {
    mockDiscoveryCreate.mockResolvedValue({ id: 'd1' });
    const services = [
      classifyService({ serviceName: 'Brake Repair', source: 'user', userSelected: true }),
      classifyService({ serviceName: 'Diesel Repair', source: 'industry_knowledge', broadIndustryInference: true }),
    ];
    await saveServiceDiscovery({ businessId: 'biz-A', services });
    const data = mockDiscoveryCreate.mock.calls[0][0].data;
    expect(data.businessId).toBe('biz-A');
    expect(data.confirmedCount).toBe(1);
    expect(data.needsConfirmationCount).toBe(1);
  });

  it('saveSitemap persists approval fields + businessId', async () => {
    mockSitemapCreate.mockResolvedValue({ id: 's1' });
    const approved = approveSitemap(sampleSitemap(), 'u1');
    await saveSitemap({ businessId: 'biz-A', websiteProjectId: 'proj-1', sitemap: approved });
    const data = mockSitemapCreate.mock.calls[0][0].data;
    expect(data.businessId).toBe('biz-A');
    expect(data.approvalStatus).toBe('approved');
    expect(data.approvedByUserId).toBe('u1');
  });

  it('saveSitemapRevision writes user_requested source when the sitemap is owned', async () => {
    mockSitemapFindFirst.mockResolvedValue({ id: 's1' }); // owned
    mockRevisionCreate.mockResolvedValue({ id: 'r1' });
    const { revision } = addUserRequestedPage(sampleSitemap(), { title: 'Tombstone vs Tabloo', requestedByUserId: 'u1' });
    await saveSitemapRevision({ businessId: 'biz-A', sitemapId: 's1', revision });
    const data = mockRevisionCreate.mock.calls[0][0].data;
    expect(data.businessId).toBe('biz-A');
    expect(data.pageSource).toBe('user_requested');
    expect(data.pageSlug).toBe('/compare/tombstone-vs-tabloo');
  });
});

describe('resolveCopyGate (persistence-aware gate)', () => {
  it('blocks when no sitemap exists', async () => {
    mockSitemapFindFirst.mockResolvedValue(null);
    const gate = await resolveCopyGate('biz-A');
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_missing');
  });

  it('blocks when the stored sitemap is not approved', async () => {
    mockSitemapFindFirst.mockResolvedValue({ sitemapJson: sampleSitemap() });
    const gate = await resolveCopyGate('biz-A');
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_not_approved');
  });

  it('allows when the stored sitemap is approved', async () => {
    mockSitemapFindFirst.mockResolvedValue({ sitemapJson: approveSitemap(sampleSitemap(), 'u1') });
    const gate = await resolveCopyGate('biz-A');
    expect(gate.allowed).toBe(true);
  });
});
