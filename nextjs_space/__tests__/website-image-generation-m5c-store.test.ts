/**
 * Milestone 5C — store-level generation behavior with an INJECTED provider mock
 * (no network, no real DB). The prisma client and the sitemap / copy / brief
 * loaders are mocked so `generateWebsiteImages` runs in isolation. Verifies:
 *   - the hard gate blocks with no asset rows written,
 *   - maxImages/limit bounding,
 *   - dry-run validates + reports the durable key but persists NOTHING,
 *   - a live result persists the DURABLE R2 key (never a signed URL),
 *   - QA scores are persisted; a failed hero QA is stored as qa_failed,
 *   - the provider seam receives the businessId (business-scoped key), and the
 *     dry-run flag is forwarded.
 */
const prisma = {
  business: { findUnique: jest.fn() },
  websiteGeneratedImageAsset: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
};
jest.mock('@/lib/db', () => ({ prisma }));

const mockLoadLatestSitemap = jest.fn();
const mockLoadWebsiteCopy = jest.fn();
const mockGetImageBriefSet = jest.fn();
const mockLoadImageBriefState = jest.fn();
jest.mock('@/lib/website-sitemap-store', () => ({ loadLatestSitemap: (...a: any[]) => mockLoadLatestSitemap(...a) }));
jest.mock('@/lib/website-copy-store', () => ({ loadWebsiteCopy: (...a: any[]) => mockLoadWebsiteCopy(...a) }));
jest.mock('@/lib/website-image-briefs-store', () => ({
  getImageBriefSet: (...a: any[]) => mockGetImageBriefSet(...a),
  loadImageBriefState: (...a: any[]) => mockLoadImageBriefState(...a),
}));

import { generateWebsiteImages } from '@/lib/website-image-generation-store';
import { buildWebsiteAssetR2Key, GENERATED_IMAGE_BUCKET } from '@/lib/website-image-generation';
import type { WebsiteImageRenderProvider } from '@/lib/website-image-render-provider';

// ── Fixtures that satisfy the gate ──────────────────────────────────────────
function heroBrief(over: Partial<any> = {}): any {
  return {
    briefId: over.briefId || 'brief_hero_1',
    sectionName: over.sectionName || 'Hero',
    sectionType: 'hero',
    visualObjective: 'Show a technician working on a vehicle in a clean bay',
    businessSpecificDirection: 'Feature the actual shop environment',
    industryDetails: ['brake rotor'],
    localDetails: ['West Houston'],
    forbiddenVisuals: ['stock smiling headset agents', 'logo as hero image', 'logo-as-hero'],
    assetSourcePreference: 'generated_asset',
    aspectRatio: '16:9',
    mobileCropNotes: 'Keep subject centered for 4:5 crop',
    textSafeZone: 'Left third clear for headline',
    allowTextInImage: false,
    ...over,
  };
}
function page(slug: string, briefs: any[]): any {
  return { slug, pageType: 'service', h1: slug, briefs };
}
function artifact(pages: any[]): any {
  return { sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'approved', pages, summary: { pageCount: pages.length, briefCount: 0, heroBriefCount: 1, generatedAt: 't' } };
}
const SITEMAP_JSON = { id: 'sm1', approvalStatus: 'approved', status: 'approved', pages: [{ slug: '/', pageType: 'home', h1: 'Home' }] };

function setupGatePasses(pages: any[]) {
  mockLoadLatestSitemap.mockResolvedValue({ id: 'sm1', sitemapJson: SITEMAP_JSON });
  mockLoadWebsiteCopy.mockResolvedValue({ sitemapId: 'sm1', status: 'approved', pages: [{ slug: '/', pageType: 'home', h1: 'Home' }] });
  const record = { id: 'set1', businessId: 'biz1', sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'approved', artifact: artifact(pages) };
  mockGetImageBriefSet.mockResolvedValue(record);
  mockLoadImageBriefState.mockResolvedValue({ latest: record, history: [] });
  prisma.business.findUnique.mockResolvedValue({ businessName: 'West Houston Auto Repair', businessCity: 'Houston', businessState: 'TX', contentProfile: { industry: 'auto repair', audienceSegments: [] } });
}

function durableKey(briefId: string, sectionName: string) {
  return buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: briefId, sectionName, assetRole: 'hero_image' });
}

// Echo the created row back so rowToAsset maps it.
prisma.websiteGeneratedImageAsset.create.mockImplementation(async ({ data }: any) => ({
  ...data, id: `row_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(),
}));

function passingProvider(scores?: Record<string, number>): WebsiteImageRenderProvider {
  return jest.fn(async (contract: any, ctx: any) => ({
    ok: true,
    dryRun: ctx?.dryRun === true,
    result: {
      provider: 'tombstone_andy', model: 'gpt-image-1', r2Bucket: GENERATED_IMAGE_BUCKET,
      r2Key: durableKey(contract.briefId, contract.sectionName), mimeType: 'image/png', width: 1600, height: 900,
      status: ctx?.dryRun ? 'validated' : 'ready',
      heroQa: ctx?.dryRun ? undefined : { heroVisualScore: scores?.hero ?? 92, mobileHeroScore: scores?.mobile ?? 88, brandFitScore: scores?.brand ?? 95, textReadabilityScore: scores?.text ?? 90, focalPointScore: scores?.focal ?? 88, requiredFixes: [] },
    },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // By default there is NO prior asset for the request (idempotency lookup).
  prisma.websiteGeneratedImageAsset.findFirst.mockResolvedValue(null);
  prisma.websiteGeneratedImageAsset.create.mockImplementation(async ({ data }: any) => ({
    ...data, id: `row_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(),
  }));
});

// A provider that fails cleanly (e.g. a render timeout) and reports it as retryable.
function timingOutProvider(): WebsiteImageRenderProvider {
  return jest.fn(async () => ({
    ok: false,
    error: 'Render provider unreachable: The operation was aborted due to timeout',
    retryable: true,
  }));
}

describe('hard gate blocks with no rows written', () => {
  it('blocks when the brief set is not approved and writes nothing', async () => {
    setupGatePasses([page('/', [heroBrief()])]);
    mockGetImageBriefSet.mockResolvedValue({ id: 'set1', businessId: 'biz1', sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'draft', artifact: artifact([page('/', [heroBrief()])]) });
    mockLoadImageBriefState.mockResolvedValue({ latest: { id: 'set1', businessId: 'biz1', sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'draft', artifact: artifact([page('/', [heroBrief()])]) } });
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider: passingProvider(), limit: 1 });
    expect(res.ok).toBe(false);
    expect(res.gate?.allowed).toBe(false);
    expect(res.gate?.code).toBe('brief_set_not_approved');
    expect(prisma.websiteGeneratedImageAsset.create).not.toHaveBeenCalled();
  });

  it('blocks a brief set belonging to another business', async () => {
    setupGatePasses([page('/', [heroBrief()])]);
    const other = { id: 'set1', businessId: 'OTHER', sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'approved', artifact: artifact([page('/', [heroBrief()])]) };
    mockGetImageBriefSet.mockResolvedValue(other);
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider: passingProvider(), limit: 1 });
    expect(res.ok).toBe(false);
    expect(res.gate?.code).toBe('brief_set_business_mismatch');
    expect(prisma.websiteGeneratedImageAsset.create).not.toHaveBeenCalled();
  });
});

describe('maxImages / limit bounding', () => {
  it('renders at most `limit` assets even when more briefs exist', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' }), heroBrief({ briefId: 'b2', sectionName: 'Hero 2' }), heroBrief({ briefId: 'b3', sectionName: 'Hero 3' })])]);
    const provider = passingProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(res.ok).toBe(true);
    expect(res.assets).toHaveLength(1);
    expect(prisma.websiteGeneratedImageAsset.create).toHaveBeenCalledTimes(1);
  });
});

describe('dry-run validates but persists nothing', () => {
  it('returns validated items with the durable expected key and never calls create', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const provider = passingProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1, dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.validated).toHaveLength(1);
    expect(res.validated![0].status).toBe('validated');
    expect(res.validated![0].expectedR2Key).toBe(durableKey('b1', 'Hero'));
    expect(res.validated![0].r2Bucket).toBe(GENERATED_IMAGE_BUCKET);
    expect(res.assets).toBeUndefined();
    expect(prisma.websiteGeneratedImageAsset.create).not.toHaveBeenCalled();
    // Provider was called with the dry-run flag + businessId (business-scoped).
    expect(provider).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ businessId: 'biz1', dryRun: true }));
  });
});

describe('live result persistence', () => {
  it('stores the DURABLE R2 key (never a signed URL) and QA scores', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider: passingProvider(), limit: 1 });
    expect(res.ok).toBe(true);
    const a = res.assets![0];
    expect(a.r2Bucket).toBe(GENERATED_IMAGE_BUCKET);
    expect(a.r2Key).toBe(durableKey('b1', 'Hero'));
    expect(a.r2Key!.startsWith('http')).toBe(false); // not a signed URL
    expect(a.qualityScore).toBe(92);
    expect(a.brandFitScore).toBe(95);
    expect(a.textReadabilityScore).toBe(90);
    expect(a.qaStatus).toBe('passed');
    // The persisted row carried the durable key + scores.
    const created = prisma.websiteGeneratedImageAsset.create.mock.calls[0][0].data;
    expect(created.r2Key).toBe(durableKey('b1', 'Hero'));
    expect(created.qualityScore).toBe(92);
  });

  it('stores a failed hero QA as qa_failed', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider: passingProvider({ hero: 60 }), limit: 1 });
    expect(res.ok).toBe(true);
    expect(res.assets![0].qaStatus).toBe('failed');
    expect(res.assets![0].status).toBe('qa_failed');
  });
});

describe('M5C hardening — timeout, idempotency, no auto-retry', () => {
  it('stores a clean failed asset when the render times out (no r2Key, fixes recorded)', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const provider = timingOutProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(res.ok).toBe(true);
    const a = res.assets![0];
    expect(a.status).toBe('failed');
    expect(a.qaStatus).toBe('failed');
    expect(a.r2Key).toBeFalsy();
    expect(a.requiredFixes.join(' ')).toMatch(/timeout/i);
    expect(res.failedBriefIds).toContain('b1');
  });

  it('does NOT auto-retry — the provider is called exactly once on a retryable failure', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const provider = timingOutProvider();
    await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('reuses a prior successful asset instead of rendering again (idempotency)', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const priorSuccess = {
      id: 'existing_row', businessId: 'biz1', imageBriefSetId: 'set1', imageBriefId: 'b1',
      pageSlug: '/', sectionName: 'Hero', assetRole: 'hero_image',
      status: 'ready_for_review', qaStatus: 'passed',
      r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: durableKey('b1', 'Hero'),
      requiredFixesJson: [], createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.websiteGeneratedImageAsset.findFirst.mockResolvedValue(priorSuccess);
    const provider = passingProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(res.ok).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(prisma.websiteGeneratedImageAsset.create).not.toHaveBeenCalled();
    expect(res.reusedBriefIds).toContain('b1');
    expect(res.assets![0].r2Key).toBe(durableKey('b1', 'Hero'));
  });

  it('does not re-render a moderation-blocked prior failure unchanged', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const priorBlocked = {
      id: 'blocked_row', businessId: 'biz1', imageBriefSetId: 'set1', imageBriefId: 'b1',
      pageSlug: '/', sectionName: 'Hero', assetRole: 'hero_image',
      status: 'failed', qaStatus: 'failed', r2Bucket: null, r2Key: null,
      requiredFixesJson: ['Prompt blocked by safety moderation policy'],
      createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.websiteGeneratedImageAsset.findFirst.mockResolvedValue(priorBlocked);
    const provider = passingProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(res.ok).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(prisma.websiteGeneratedImageAsset.create).not.toHaveBeenCalled();
    expect(res.failedBriefIds).toContain('b1');
  });

  it('DOES re-render a prior non-moderation failure (transient timeout is retryable)', async () => {
    setupGatePasses([page('/', [heroBrief({ briefId: 'b1' })])]);
    const priorTransient = {
      id: 'transient_row', businessId: 'biz1', imageBriefSetId: 'set1', imageBriefId: 'b1',
      pageSlug: '/', sectionName: 'Hero', assetRole: 'hero_image',
      status: 'failed', qaStatus: 'failed', r2Bucket: null, r2Key: null,
      requiredFixesJson: ['Render provider unreachable: The operation was aborted due to timeout'],
      createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.websiteGeneratedImageAsset.findFirst.mockResolvedValue(priorTransient);
    const provider = passingProvider();
    const res = await generateWebsiteImages({ businessId: 'biz1', briefSetId: 'set1', provider, limit: 1 });
    expect(res.ok).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(res.assets![0].r2Key).toBe(durableKey('b1', 'Hero'));
  });
});
