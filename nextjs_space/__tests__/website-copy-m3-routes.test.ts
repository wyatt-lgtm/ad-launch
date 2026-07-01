/**
 * Milestone 3 — Copy API route authorization, business scoping, and hard gate.
 *
 * Covers spec tests: 16 (business-scoped), 17 (wrong business → 403),
 * 18 (unauthenticated → 401), 1–3 (gate blocks → 422), 4 (approved → 200),
 * and 21 (route asserts no publish/deploy flags).
 *
 * next-auth, the access resolver, the website-project helper, and the copy store
 * are mocked so the handlers run in isolation with NO network / DB / LLM calls.
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

const sitemapStore = {
  loadLatestSitemap: jest.fn(),
};
jest.mock('@/lib/website-sitemap-store', () => sitemapStore);

const copyStore = {
  loadWebsiteCopy: jest.fn(),
  generateWebsiteCopy: jest.fn(),
  isCopyLlmConfigured: jest.fn(() => true),
};
jest.mock('@/lib/website-copy-store', () => copyStore);

import { GET as copyGET, POST as copyPOST } from '@/app/api/businesses/[id]/website/copy/route';
import {
  generateSitemap,
  approveSitemap,
  classifyServices,
  type WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';

function req(body?: any): any {
  return { json: async () => body ?? {} };
}
const P = (id: string) => ({ params: { id } });

function approvedSitemap(): WebsiteSitemapArtifact {
  return approveSitemap(
    generateSitemap({
      businessName: 'West Houston Auto Repair',
      industry: 'Auto Repair',
      businessType: 'Auto Repair Shop',
      serviceCategoryLabel: 'Auto Repair',
      primaryServiceArea: { city: 'Houston', state: 'Texas' },
      serviceAreaMode: 'local',
      services: classifyServices([
        { serviceName: 'Brake Repair', source: 'user', userSelected: true },
        { serviceName: 'Oil Change', source: 'user', userSelected: true },
      ]),
    }),
    'user-1',
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
  mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'user-1', role: 'user' }, isAdmin: false });
  mockEnsureWebsiteProject.mockResolvedValue({ id: 'proj-1' });
  copyStore.isCopyLlmConfigured.mockReturnValue(true);
  copyStore.loadWebsiteCopy.mockResolvedValue({ sitemapId: null, pages: [], generatedAt: null });
});

describe('authentication (test 18)', () => {
  it('copy GET returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await copyGET(req(), P('biz-A'));
    expect(res.status).toBe(401);
  });
  it('copy POST returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await copyPOST(req(), P('biz-A'));
    expect(res.status).toBe(401);
  });
});

describe('authorization (test 17 — wrong business → 403)', () => {
  it('copy GET returns 403 when no access', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    const res = await copyGET(req(), P('biz-B'));
    expect(res.status).toBe(403);
  });
  it('copy POST returns 403 when no access', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    const res = await copyPOST(req(), P('biz-B'));
    expect(res.status).toBe(403);
  });
});

describe('business scoping (test 16)', () => {
  it('GET scopes copy + sitemap loads by the businessId in the route', async () => {
    sitemapStore.loadLatestSitemap.mockResolvedValue(null);
    await copyGET(req(), P('biz-XYZ'));
    expect(mockResolveBusinessAccess).toHaveBeenCalledWith('owner@example.com', 'biz-XYZ');
    expect(sitemapStore.loadLatestSitemap).toHaveBeenCalledWith('biz-XYZ');
    expect(copyStore.loadWebsiteCopy).toHaveBeenCalledWith('biz-XYZ', null);
  });
});

describe('hard gate on POST (tests 1–3 → 422)', () => {
  it('returns 422 and generates NO copy when the gate blocks', async () => {
    copyStore.generateWebsiteCopy.mockResolvedValue({
      ok: false,
      gate: { allowed: false, code: 'sitemap_not_approved', reason: 'not approved' },
    });
    const res = await copyPOST(req(), P('biz-A'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.copyGate.allowed).toBe(false);
    expect(body.copyGate.code).toBe('sitemap_not_approved');
  });

  it('returns 503 when LLM not configured (no generation attempted)', async () => {
    copyStore.isCopyLlmConfigured.mockReturnValue(false);
    const res = await copyPOST(req(), P('biz-A'));
    expect(res.status).toBe(503);
    expect(copyStore.generateWebsiteCopy).not.toHaveBeenCalled();
  });
});

describe('happy path POST (test 4 → 200) + boundary flags (test 21)', () => {
  it('returns 200 with draft artifact and explicit no-publish/deploy flags', async () => {
    copyStore.generateWebsiteCopy.mockResolvedValue({
      ok: true,
      sitemapId: 'sm-1',
      artifact: { businessName: 'West Houston Auto Repair', industry: 'Auto Repair', pages: [{ slug: '/', pageType: 'home' }], generatedAt: 't', stage: 'draft' },
      pageIssues: [],
      uniquenessIssues: [],
    });
    const res = await copyPOST(req(), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('draft');
    expect(body.imageGenerationRun).toBe(false);
    expect(body.staticBuildRun).toBe(false);
    expect(body.publishRun).toBe(false);
    expect(copyStore.generateWebsiteCopy).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-A', websiteProjectId: 'proj-1', generatedByUserId: 'user-1' }),
    );
  });
});

describe('GET returns gate + copy artifact', () => {
  it('surfaces the copy gate derived from the latest sitemap', async () => {
    sitemapStore.loadLatestSitemap.mockResolvedValue({ id: 'sm-1', sitemapJson: approvedSitemap() });
    copyStore.loadWebsiteCopy.mockResolvedValue({ sitemapId: 'sm-1', pages: [{ slug: '/' } as any], generatedAt: 't' });
    const res = await copyGET(req(), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.copyGate.allowed).toBe(true);
    expect(body.copy.pageCount).toBe(1);
  });
});
