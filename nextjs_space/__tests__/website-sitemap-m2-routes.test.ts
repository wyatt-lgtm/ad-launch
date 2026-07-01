/**
 * Milestone 2 — API route authorization + business scoping.
 *
 * Tests 1–4 (business-scoped reads/writes), 16 (wrong business → 403), and
 * 17 (unauthenticated → 401). next-auth, the access resolver, and the store are
 * mocked so the handlers can be exercised in isolation.
 */
const mockGetServerSession = jest.fn();
const mockResolveBusinessAccess = jest.fn();
const mockEnsureWebsiteProject = jest.fn();

jest.mock('next-auth', () => ({ getServerSession: (...a: any[]) => mockGetServerSession(...a) }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/website-workflow', () => ({
  resolveBusinessAccess: (...a: any[]) => mockResolveBusinessAccess(...a),
  ensureWebsiteProject: (...a: any[]) => mockEnsureWebsiteProject(...a),
}));

const store = {
  loadLatestServiceDiscovery: jest.fn(),
  saveServiceDiscovery: jest.fn(),
  seedServiceCandidatesFromOfferings: jest.fn(),
  loadLatestSitemap: jest.fn(),
  saveSitemap: jest.fn(),
  loadSitemapById: jest.fn(),
  updateSitemapArtifact: jest.fn(),
  saveSitemapRevision: jest.fn(),
  listSitemapRevisions: jest.fn(),
  recordRevision: jest.fn(),
  resolveCopyGate: jest.fn(),
  buildSitemapGenerationInput: jest.fn(),
};
jest.mock('@/lib/website-sitemap-store', () => store);

import { GET as discoveryGET, POST as discoveryPOST } from '@/app/api/businesses/[id]/website/service-discovery/route';
import { GET as sitemapGET, POST as sitemapPOST } from '@/app/api/businesses/[id]/website/sitemap/route';
import { GET as copyGateGET } from '@/app/api/businesses/[id]/website/copy-gate/route';

function req(body?: any): any {
  return { json: async () => body ?? {} };
}
const P = (id: string) => ({ params: { id } });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
  mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'user-1', role: 'user' }, isAdmin: false });
  mockEnsureWebsiteProject.mockResolvedValue({ id: 'proj-1' });
});

describe('authentication (test 17)', () => {
  it('service-discovery GET returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await discoveryGET(req(), P('biz-A'));
    expect(res.status).toBe(401);
  });

  it('sitemap GET returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await sitemapGET(req(), P('biz-A'));
    expect(res.status).toBe(401);
  });

  it('copy-gate GET returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await copyGateGET(req(), P('biz-A'));
    expect(res.status).toBe(401);
  });
});

describe('authorization — wrong business (test 16)', () => {
  it('service-discovery GET returns 403 when the user has no access to the business', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    const res = await discoveryGET(req(), P('biz-OTHER'));
    expect(res.status).toBe(403);
    expect(store.loadLatestServiceDiscovery).not.toHaveBeenCalled();
  });

  it('sitemap POST returns 403 when the user has no access to the business', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    const res = await sitemapPOST(req(), P('biz-OTHER'));
    expect(res.status).toBe(403);
    expect(store.saveSitemap).not.toHaveBeenCalled();
  });
});

describe('business scoping (tests 1–4)', () => {
  it('test 1 — service-discovery GET loads discovery scoped to the URL business', async () => {
    store.loadLatestServiceDiscovery.mockResolvedValue(null);
    const res = await discoveryGET(req(), P('biz-A'));
    expect(res.status).toBe(200);
    expect(store.loadLatestServiceDiscovery).toHaveBeenCalledWith('biz-A');
  });

  it('test 2 — service-discovery POST saves classified services scoped to the business', async () => {
    store.saveServiceDiscovery.mockResolvedValue({ id: 'd1', version: 1, source: 'user' });
    const body = { services: [{ serviceName: 'Brake Repair', slug: '/services/brake-repair', confirmationStatus: 'confirmed', source: 'user', evidence: '', confidence: 1 }] };
    const res = await discoveryPOST(req(body), P('biz-A'));
    expect(res.status).toBe(200);
    expect(store.saveServiceDiscovery).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-A' }));
  });

  it('test 2 — service-discovery POST seeds candidates from the business offerings', async () => {
    store.seedServiceCandidatesFromOfferings.mockResolvedValue([{ serviceName: 'Oil Change', source: 'business_settings', userSelected: true }]);
    store.saveServiceDiscovery.mockResolvedValue({ id: 'd2', version: 2, source: 'business_settings' });
    const res = await discoveryPOST(req({ seed: true }), P('biz-A'));
    expect(res.status).toBe(200);
    expect(store.seedServiceCandidatesFromOfferings).toHaveBeenCalledWith('biz-A');
    expect(store.saveServiceDiscovery).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-A' }));
  });

  it('test 3 — sitemap GET loads the latest sitemap scoped to the business', async () => {
    store.loadLatestSitemap.mockResolvedValue(null);
    const res = await sitemapGET(req(), P('biz-A'));
    expect(res.status).toBe(200);
    expect(store.loadLatestSitemap).toHaveBeenCalledWith('biz-A');
  });

  it('test 4 — sitemap POST generates + saves scoped to the business', async () => {
    store.buildSitemapGenerationInput.mockResolvedValue({
      businessName: 'West Houston Auto Repair', industry: 'Auto Repair',
      primaryServiceArea: { city: 'Houston', state: 'Texas' }, serviceAreaMode: 'local',
      services: [{ serviceName: 'Brake Repair', slug: '/services/brake-repair', confirmationStatus: 'confirmed', source: 'user', evidence: '', confidence: 1 }],
    });
    store.saveSitemap.mockResolvedValue({ id: 's1' });
    const res = await sitemapPOST(req(), P('biz-A'));
    expect(res.status).toBe(200);
    expect(store.buildSitemapGenerationInput).toHaveBeenCalledWith('biz-A');
    expect(store.saveSitemap).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-A' }));
    const payload = await res.json();
    expect(payload.sitemapId).toBe('s1');
    expect(payload.sitemap.pages.length).toBeGreaterThan(0);
  });

  it('sitemap POST returns 404 when the business has no generation input', async () => {
    store.buildSitemapGenerationInput.mockResolvedValue(null);
    const res = await sitemapPOST(req(), P('biz-A'));
    expect(res.status).toBe(404);
  });
});
