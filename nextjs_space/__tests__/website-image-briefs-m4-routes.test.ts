/**
 * Milestone 4 — Image Briefs API route authorization, business scoping, and the
 * hard gate. next-auth, the access resolver, the website-project helper, and the
 * image-brief store are mocked so the handlers run in isolation with NO network
 * / DB / LLM / image / R2 / build / publish calls.
 *
 * Covers: unauthenticated → 401, wrong business → 403, business scoping,
 * gate blocks → 422 (no briefs written), LLM unconfigured → 503, happy path →
 * 200 with explicit no-image/no-R2/no-build/no-publish boundary flags, plus the
 * single brief-set GET/PUT and approve routes.
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
  loadImageBriefState: jest.fn(),
  generateImageBriefs: jest.fn(),
  getImageBriefSet: jest.fn(),
  updateImageBriefSet: jest.fn(),
  approveImageBriefSet: jest.fn(),
  isImageBriefLlmConfigured: jest.fn(() => true),
};
jest.mock('@/lib/website-image-briefs-store', () => store);

import { GET as listGET, POST as genPOST } from '@/app/api/businesses/[id]/website/image-briefs/route';
import { GET as oneGET, PUT as onePUT } from '@/app/api/businesses/[id]/website/image-briefs/[briefSetId]/route';
import { POST as approvePOST } from '@/app/api/businesses/[id]/website/image-briefs/[briefSetId]/approve/route';

function req(body?: any): any {
  return { json: async () => body ?? {} };
}
const P = (id: string) => ({ params: { id } });
const PB = (id: string, briefSetId: string) => ({ params: { id, briefSetId } });

const FAKE_SET = {
  id: 'brief-1',
  status: 'ready_for_review',
  sitemapId: 'sm-1',
  copyArtifactId: 'sm-1',
  pageCount: 10,
  briefCount: 11,
  createdAt: 't',
  updatedAt: 't',
  artifact: { sitemapId: 'sm-1', copyArtifactId: 'sm-1', status: 'ready_for_review', pages: [], summary: { pageCount: 10, briefCount: 11, heroBriefCount: 10, generatedAt: 't' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
  mockResolveBusinessAccess.mockResolvedValue({ user: { id: 'user-1', role: 'user' }, isAdmin: false });
  mockEnsureWebsiteProject.mockResolvedValue({ id: 'proj-1' });
  store.isImageBriefLlmConfigured.mockReturnValue(true);
  store.loadImageBriefState.mockResolvedValue({
    gate: { allowed: true, code: 'ok', reason: 'ready' },
    sitemapId: 'sm-1', copyArtifactId: 'sm-1', copyPresent: true, latest: null, history: [],
  });
});

describe('authentication (401)', () => {
  it('list GET 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await listGET(req(), P('biz-A'))).status).toBe(401);
  });
  it('generate POST 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await genPOST(req(), P('biz-A'))).status).toBe(401);
  });
  it('approve POST 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await approvePOST(req(), PB('biz-A', 'brief-1'))).status).toBe(401);
  });
});

describe('authorization (wrong business → 403)', () => {
  it('list GET 403 when no access', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    expect((await listGET(req(), P('biz-B'))).status).toBe(403);
  });
  it('generate POST 403 when no access', async () => {
    mockResolveBusinessAccess.mockResolvedValue(null);
    expect((await genPOST(req(), P('biz-B'))).status).toBe(403);
  });
});

describe('business scoping', () => {
  it('GET scopes brief-state load by the businessId in the route', async () => {
    await listGET(req(), P('biz-XYZ'));
    expect(mockResolveBusinessAccess).toHaveBeenCalledWith('owner@example.com', 'biz-XYZ');
    expect(store.loadImageBriefState).toHaveBeenCalledWith('biz-XYZ');
  });
  it('single GET scopes fetch by businessId + briefSetId', async () => {
    store.getImageBriefSet.mockResolvedValue(FAKE_SET);
    await oneGET(req(), PB('biz-XYZ', 'brief-1'));
    expect(store.getImageBriefSet).toHaveBeenCalledWith('biz-XYZ', 'brief-1');
  });
});

describe('hard gate on POST (→ 422, no briefs written)', () => {
  it('returns 422 and generates NO briefs when the gate blocks', async () => {
    store.generateImageBriefs.mockResolvedValue({
      ok: false,
      gate: { allowed: false, code: 'copy_missing', reason: 'copy required' },
      imageGenerationRun: false, r2UploadRun: false, staticBuildRun: false, publishRun: false,
    });
    const res = await genPOST(req(), P('biz-A'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.briefGate.allowed).toBe(false);
    expect(body.briefGate.code).toBe('copy_missing');
  });

  it('returns 503 when LLM not configured (no generation attempted)', async () => {
    store.isImageBriefLlmConfigured.mockReturnValue(false);
    const res = await genPOST(req(), P('biz-A'));
    expect(res.status).toBe(503);
    expect(store.generateImageBriefs).not.toHaveBeenCalled();
  });
});

describe('happy path POST (→ 200) + boundary flags', () => {
  it('returns 200 with brief set and explicit no-image/R2/build/publish flags', async () => {
    store.generateImageBriefs.mockResolvedValue({
      ok: true, briefSet: FAKE_SET, issues: [], fallbackSlugs: undefined,
      imageGenerationRun: false, r2UploadRun: false, staticBuildRun: false, publishRun: false,
    });
    const res = await genPOST(req(), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefSet.id).toBe('brief-1');
    expect(body.imageGenerationRun).toBe(false);
    expect(body.r2UploadRun).toBe(false);
    expect(body.staticBuildRun).toBe(false);
    expect(body.publishRun).toBe(false);
    expect(store.generateImageBriefs).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-A', websiteProjectId: 'proj-1', generatedByUserId: 'user-1' }),
    );
  });
});

describe('GET list surfaces gate + next-milestone note', () => {
  it('returns gate, copyPresent and imageGenerationAvailable=false', async () => {
    const res = await listGET(req(), P('biz-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefGate.allowed).toBe(true);
    expect(body.copyPresent).toBe(true);
    expect(body.imageGenerationAvailable).toBe(false);
    expect(body.note).toMatch(/later milestone/i);
  });
});

describe('single brief-set GET / PUT', () => {
  it('GET 404 when not found', async () => {
    store.getImageBriefSet.mockResolvedValue(null);
    expect((await oneGET(req(), PB('biz-A', 'missing'))).status).toBe(404);
  });
  it('PUT applies a low-risk status transition and returns boundary flags', async () => {
    store.updateImageBriefSet.mockResolvedValue({ ok: true, briefSet: { ...FAKE_SET, status: 'revision_requested' }, issues: [] });
    const res = await onePUT(req({ status: 'revision_requested' }), PB('biz-A', 'brief-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefSet.status).toBe('revision_requested');
    expect(body.imageGenerationRun).toBe(false);
    expect(body.publishRun).toBe(false);
    expect(store.updateImageBriefSet).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-A', briefSetId: 'brief-1', status: 'revision_requested' }),
    );
  });
  it('PUT 404 when the store reports not_found', async () => {
    store.updateImageBriefSet.mockResolvedValue({ ok: false, error: 'not_found' });
    expect((await onePUT(req({ status: 'draft' }), PB('biz-A', 'missing'))).status).toBe(404);
  });
});

describe('approve route (review only)', () => {
  it('approves and returns explicit no-image/R2/build/publish flags', async () => {
    store.approveImageBriefSet.mockResolvedValue({ ok: true, briefSet: { ...FAKE_SET, status: 'approved' } });
    const res = await approvePOST(req(), PB('biz-A', 'brief-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.briefSet.status).toBe('approved');
    expect(body.imageGenerationRun).toBe(false);
    expect(body.r2UploadRun).toBe(false);
    expect(body.staticBuildRun).toBe(false);
    expect(body.publishRun).toBe(false);
  });
  it('404 when approving a missing brief set', async () => {
    store.approveImageBriefSet.mockResolvedValue({ ok: false, error: 'not_found' });
    expect((await approvePOST(req(), PB('biz-A', 'missing'))).status).toBe(404);
  });
});
