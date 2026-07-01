/**
 * Milestone 5C — dedicated /generate route: auth, business scoping, cost
 * control (bounded maxImages), dry-run, and the hard gate. next-auth, the
 * access resolver, the website-project helper, and the generation store are
 * mocked so the handler runs in isolation with NO network / DB / image / R2 /
 * build / publish calls. Also asserts the server-side token is never accepted
 * from or returned to the client, and there is no cross-business leakage.
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
  generateWebsiteImages: jest.fn(),
  isImageRenderProviderConfigured: jest.fn(() => true),
};
jest.mock('@/lib/website-image-generation-store', () => store);

import { POST as generatePOST } from '@/app/api/businesses/[id]/website/generated-images/generate/route';

function req(body?: any): any {
  return { json: async () => body ?? {} };
}
const P = (id: string) => ({ params: { id } });

const LIVE_ASSET = {
  id: 'asset-1', imageBriefSetId: 'set-1', imageBriefId: 'b1', pageSlug: '/', sectionName: 'Hero',
  sectionType: 'hero', assetRole: 'hero_image', status: 'ready_for_review', provider: 'tombstone_andy',
  model: 'gpt-image-1', r2Bucket: 'tombstoner2', r2Key: 'website-assets/biz-A/2026-07/brief_b1/hero-hero-image.png',
  mimeType: 'image/png', width: 1600, height: 900, altText: null, promptSummary: null, visualRationale: null,
  qualityScore: 92, brandFitScore: 95, mobileSafeScore: 88, textReadabilityScore: 90, focalPointScore: 88,
  qaStatus: 'passed', requiredFixes: [], createdAt: 't',
};
const BOUNDARIES = { staticBuildRun: false, mobileQaRun: false, publishRun: false, deployRun: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
  mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'user-1', role: 'user' } });
  mockEnsureWebsiteProject.mockResolvedValue({ id: 'proj-1' });
  store.isImageRenderProviderConfigured.mockReturnValue(true);
  store.generateWebsiteImages.mockResolvedValue({ ok: true, assets: [LIVE_ASSET], failedBriefIds: [], ...BOUNDARIES });
});

describe('auth + scoping', () => {
  it('401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await generatePOST(req({}), P('biz-A'))).status).toBe(401);
    expect(store.generateWebsiteImages).not.toHaveBeenCalled();
  });
  it('403 for wrong business (no cross-business leakage)', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    expect((await generatePOST(req({}), P('biz-B'))).status).toBe(403);
    expect(store.generateWebsiteImages).not.toHaveBeenCalled();
  });
  it('scopes generation to the route businessId, never a client-supplied one', async () => {
    await generatePOST(req({ businessId: 'ATTACKER', imageBriefSetId: 'set-1', imageBriefIds: ['b1'] }), P('biz-A'));
    expect(mockResolveBusinessAccess).toHaveBeenCalledWith('owner@example.com', 'biz-A');
    expect(store.generateWebsiteImages).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-A' }));
    // The client-supplied businessId must NOT be used.
    expect(store.generateWebsiteImages).not.toHaveBeenCalledWith(expect.objectContaining({ businessId: 'ATTACKER' }));
  });
});

describe('hard gate (blocked when briefs not approved)', () => {
  it('returns 422 + imageGate and generates nothing', async () => {
    store.generateWebsiteImages.mockResolvedValue({ ok: false, gate: { allowed: false, code: 'brief_set_not_approved', reason: 'not approved' }, ...BOUNDARIES });
    const res = await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'] }), P('biz-A'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.imageGate.allowed).toBe(false);
    expect(body.imageGate.code).toBe('brief_set_not_approved');
    expect(body.assets).toBeUndefined();
  });
  it('returns 422 when there is no approved brief set at all', async () => {
    store.generateWebsiteImages.mockResolvedValue({ ok: false, gate: { allowed: false, code: 'brief_set_missing', reason: 'no approved briefs' }, ...BOUNDARIES });
    const res = await generatePOST(req({}), P('biz-A'));
    expect(res.status).toBe(422);
    expect((await res.json()).imageGate.code).toBe('brief_set_missing');
  });
});

describe('cost control — maxImages bounding', () => {
  it('defaults to 1 image when maxImages is omitted', async () => {
    await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'] }), P('biz-A'));
    expect(store.generateWebsiteImages).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });
  it('caps an oversized maxImages request', async () => {
    await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'], maxImages: 999 }), P('biz-A'));
    const call = store.generateWebsiteImages.mock.calls[0][0];
    expect(call.limit).toBeLessThanOrEqual(10);
  });
  it('passes the requested (small) maxImages through', async () => {
    await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1', 'b2'], maxImages: 2 }), P('biz-A'));
    expect(store.generateWebsiteImages).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });
});

describe('dry-run', () => {
  it('forwards dryRun and returns validated preview with no assets', async () => {
    store.generateWebsiteImages.mockResolvedValue({ ok: true, dryRun: true, validated: [{ briefId: 'b1', pageSlug: '/', sectionName: 'Hero', sectionType: 'hero', assetRole: 'hero_image', status: 'validated', expectedR2Key: 'website-assets/biz-A/2026-07/brief_b1/hero-hero-image.png', r2Bucket: 'tombstoner2' }], ...BOUNDARIES });
    const res = await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'], dryRun: true }), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.validated).toHaveLength(1);
    expect(body.validated[0].expectedR2Key).toContain('website-assets/');
    expect(body.assets).toEqual([]);
    expect(store.generateWebsiteImages).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});

describe('live result + boundaries', () => {
  it('returns the generated asset with durable key + QA scores and boundary flags false', async () => {
    const res = await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'], maxImages: 1 }), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(false);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].r2Key).toContain('website-assets/');
    expect(body.assets[0].qualityScore).toBe(92);
    expect(body.staticBuildRun).toBe(false);
    expect(body.mobileQaRun).toBe(false);
    expect(body.publishRun).toBe(false);
    expect(body.deployRun).toBe(false);
  });
  it('503 when the render provider is not configured', async () => {
    store.isImageRenderProviderConfigured.mockReturnValue(false);
    const res = await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'] }), P('biz-A'));
    expect(res.status).toBe(503);
    expect(store.generateWebsiteImages).not.toHaveBeenCalled();
  });
});

describe('token safety', () => {
  it('never returns a service token in the response body', async () => {
    const res = await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'] }), P('biz-A'));
    const raw = JSON.stringify(await res.json());
    expect(/servicetoken|x-service-token|service_token|WEBSITE_RENDER_SERVICE_TOKEN/i.test(raw)).toBe(false);
  });
  it('never forwards a client-supplied token or backend URL into generation', async () => {
    await generatePOST(req({ imageBriefSetId: 'set-1', imageBriefIds: ['b1'], token: 'SEKRET', tombstoneUrl: 'https://evil.example' }), P('biz-A'));
    const call = store.generateWebsiteImages.mock.calls[0][0];
    expect(JSON.stringify(call)).not.toContain('SEKRET');
    expect(JSON.stringify(call)).not.toContain('evil.example');
  });
});
