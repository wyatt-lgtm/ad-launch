/**
 * Phase 3 — static package build, asset materialization, artifact manifest,
 * env validation, and dry-run deploy planner.
 *
 * Hard invariants asserted here:
 *  - Assets are materialized to local public/images paths (no signed URLs).
 *  - Signed-URL query strings never appear in code or manifests.
 *  - Missing/failed assets are recorded as warnings, not swallowed.
 *  - SiteBuild persists on success AND on failure.
 *  - Artifact manifest carries pages/routes/assets/env (names only).
 *  - .env.example lists public placeholders only.
 *  - Dry-run planner validates config, never uploads, never leaks secrets.
 */

// URLs assembled from fragments so no literal image URL appears in source
// (defends against any asset-URL rewriting of test fixtures).
const PROTO = 'htt' + 'ps' + '://';
const EXT = '.' + 'jpg';
const HOST = PROTO + 'assets.' + 'invalid';
const PUBLIC_IMG = HOST + '/acme/hero' + EXT;
const SIG = '?X-Amz-Sig' + 'nature=secret123&X-Amz-Expires=86400';
const SIGNED_IMG = HOST + '/acme/team' + EXT + SIG;

// ── Mock prisma (used by builder orchestrator + blueprint serializer) ────────
const mockProductionFindFirst = jest.fn();
const mockBusinessFindUnique = jest.fn();
const mockSiteBuildCreate = jest.fn();
const mockSiteBuildUpdate = jest.fn();
const mockSiteBuildFindFirst = jest.fn();
const mockWebsiteAssetFindMany = jest.fn();

jest.mock('@/lib/db', () => ({
  prisma: {
    websiteProduction: { findFirst: (...a: any[]) => mockProductionFindFirst(...a) },
    business: { findUnique: (...a: any[]) => mockBusinessFindUnique(...a) },
    siteBuild: {
      create: (...a: any[]) => mockSiteBuildCreate(...a),
      update: (...a: any[]) => mockSiteBuildUpdate(...a),
      findFirst: (...a: any[]) => mockSiteBuildFindFirst(...a),
    },
    websiteAsset: { findMany: (...a: any[]) => mockWebsiteAssetFindMany(...a) },
  },
}));

import path from 'path';
import os from 'os';
import {
  materializeAssets,
  sanitizeFileName,
  localFileForAsset,
  type AssetFetcher,
} from '@/lib/site-renderer/assets';
import { buildArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { validateEnvVars } from '@/lib/site-builder/env-validation';
import { computeDryRunPlan } from '@/lib/site-deploy/dry-run';
import { buildStaticSite, BUILD_STATUS } from '@/lib/site-builder';
import { buildSiteBlueprint, type SiteBlueprint } from '@/lib/site-blueprint';
import { renderStaticSite } from '@/lib/site-renderer';
import { envExample } from '@/lib/site-renderer/templates';

// ── Shared blueprint fixture (structured production → blueprint) ─────────────
function installMockProduction() {
  mockProductionFindFirst.mockResolvedValue({
    id: 'prod-1',
    websiteProjectId: 'proj-1',
    sitemapJson: { pages: [{ path: '/' }] },
    robotsTxt: 'User-agent: *\nAllow: /\n',
    schemaJson: { '@type': 'LocalBusiness' },
    pages: [
      {
        id: 'page-home', pageType: 'home', title: 'Acme Plumbing', slug: '', path: '/',
        metaTitle: 'Acme Plumbing | Denver', metaDescription: 'Trusted plumbing.',
        canonicalUrl: null, h1: 'Acme Plumbing', marketOrientation: 'local',
        city: 'Denver', county: null, state: 'CO', targetKeywordsJson: ['denver plumber'],
        sortOrder: 0,
        sections: [{
          id: 'sec-hero', sectionType: 'hero', heading: 'Acme', body: null,
          ctaText: 'Quote', ctaTarget: '/contact', sortOrder: 0, assetIdsJson: ['asset-hero'],
        }],
      },
      {
        id: 'page-contact', pageType: 'contact', title: 'Contact', slug: 'contact', path: '/contact',
        metaTitle: 'Contact Acme', metaDescription: 'Reach us.', canonicalUrl: null,
        h1: 'Contact', marketOrientation: null, city: null, county: null, state: null,
        targetKeywordsJson: null, sortOrder: 1,
        sections: [{
          id: 'sec-contact', sectionType: 'contact', heading: 'Get in Touch', body: 'Fast.',
          ctaText: null, ctaTarget: null, sortOrder: 0, assetIdsJson: null,
        }],
      },
    ],
    assets: [
      { id: 'asset-hero', assetType: 'hero_image', r2Key: 'businesses/acme/hero.jpg',
        publicUrl: PUBLIC_IMG, altText: 'Plumber at work', width: 1600, height: 900, status: 'ready' },
      { id: 'asset-signed', assetType: 'section_image', r2Key: 'businesses/acme/team.jpg',
        publicUrl: SIGNED_IMG, altText: 'Our team', width: 800, height: 600, status: 'ready' },
      { id: 'asset-missing', assetType: 'section_image', r2Key: null,
        publicUrl: null, altText: 'No source', width: null, height: null, status: 'ready' },
    ],
  });
  mockBusinessFindUnique.mockResolvedValue({
    id: 'biz-1', businessName: 'Acme Plumbing', websiteUrl: 'https://acme.example.test',
  });
}

async function makeBlueprint(): Promise<SiteBlueprint> {
  installMockProduction();
  return buildSiteBlueprint({ businessId: 'biz-1', websiteProductionId: 'prod-1' });
}

// Deterministic fetcher: returns bytes for everything with a source, null else.
const okFetcher: AssetFetcher = async (entry) =>
  entry.source ? { buffer: Buffer.from('FAKEIMAGEBYTES'), contentType: 'image/jpeg' } : null;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── sanitize / local path helpers ────────────────────────────────────────────
describe('asset path helpers', () => {
  test('sanitizeFileName strips dirs, query strings and unsafe chars', () => {
    expect(sanitizeFileName('a/b/My File!.jpg' + SIG)).toBe('My-File-.jpg');
    expect(sanitizeFileName('')).toBe('asset');
  });

  test('localFileForAsset yields public/images web + local paths', () => {
    const { localPath, webPath } = localFileForAsset({
      assetId: 'x', assetType: 'hero_image', source: PUBLIC_IMG, sourceKind: 'r2_public',
      intendedLocalPath: 'public/images/hero_image-x.jpg', portability: 'portable',
    } as any);
    expect(localPath.startsWith('public/images/')).toBe(true);
    expect(webPath.startsWith('/images/')).toBe(true);
    expect(webPath).not.toContain('public/');
  });
});

// ── Case 1, 4, 5: materialization ────────────────────────────────────────────
describe('materializeAssets', () => {
  test('case 1/5: copies assets to local public/images paths', async () => {
    const bp = await makeBlueprint();
    const res = await materializeAssets(bp.assetManifest, '/tmp/none', okFetcher, { writeFiles: false });
    const copied = res.assets.filter((a) => a.status === 'copied');
    expect(copied.length).toBeGreaterThanOrEqual(1);
    for (const a of copied) {
      expect(a.webPath.startsWith('/images/')).toBe(true);
      expect(a.localPath.startsWith('public/images/')).toBe(true);
      // No signed query strings ever survive onto a local path.
      expect(a.webPath).not.toContain('X-Amz');
      expect(a.localPath).not.toContain('?');
    }
  });

  test('case 4: assets with no source are recorded as missing warnings', async () => {
    const bp = await makeBlueprint();
    const res = await materializeAssets(bp.assetManifest, '/tmp/none', okFetcher, { writeFiles: false });
    const missing = res.assets.filter((a) => a.status === 'missing');
    expect(missing.find((a) => a.assetId === 'asset-missing')).toBeTruthy();
    expect(res.warnings.some((w) => w.includes('asset-missing'))).toBe(true);
  });

  test('failed downloads are recorded, not swallowed', async () => {
    const bp = await makeBlueprint();
    const failFetcher: AssetFetcher = async () => null;
    const res = await materializeAssets(bp.assetManifest, '/tmp/none', failFetcher, { writeFiles: false });
    // Entries that HAD a source but could not be fetched become failed_download.
    expect(res.failed).toBeGreaterThanOrEqual(1);
    expect(res.assets.some((a) => a.status === 'failed_download')).toBe(true);
  });
});

// ── Case 2, 3, 8, 13: artifact manifest ──────────────────────────────────────
describe('buildArtifactManifest', () => {
  async function makeManifest() {
    const bp = await makeBlueprint();
    const pkg = renderStaticSite(bp, { outputRoot: path.join(os.tmpdir(), 'cs-test') });
    const materialization = await materializeAssets(bp.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
    return buildArtifactManifest({
      blueprint: bp, renderManifest: pkg.manifest, materialization,
      sourceRef: pkg.outputDir, outputRef: null,
      buildCommand: 'npm run build', buildExecuted: false, buildResult: 'artifact_only',
    });
  }

  test('case 8: includes pages, routes, assets and env keys', async () => {
    const m = await makeManifest();
    expect(m.pages.length).toBe(2);
    expect(m.routes).toContain('/');
    expect(m.routes).toContain('/contact');
    expect(m.assets.totals.total).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(m.env.publicKeys)).toBe(true);
    expect(m.env.publicKeys.every((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(true);
    expect(m.env.secretRefs.every((k) => !k.startsWith('NEXT_PUBLIC_'))).toBe(true);
  });

  test('case 2/3/13: no signed URL or secret query string in the manifest', async () => {
    const m = await makeManifest();
    const blob = JSON.stringify(m);
    expect(blob).not.toContain('X-Amz');
    expect(blob).not.toContain('secret123');
    expect(blob).not.toContain(SIG);
  });
});

// ── Case 14: env validation (public placeholders only) ───────────────────────
describe('validateEnvVars + .env.example', () => {
  test('case 14: .env.example contains only NEXT_PUBLIC_ placeholders, no values', () => {
    const txt = envExample();
    const assignments = txt.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      const [key, ...rest] = line.split('=');
      expect(key.trim().startsWith('NEXT_PUBLIC_')).toBe(true);
      expect(rest.join('=').trim()).toBe(''); // placeholder only, never a value
    }
  });

  test('flags a NEXT_PUBLIC_ var that carries a secret-looking value', () => {
    const res = validateEnvVars([
      { key: 'NEXT_PUBLIC_SITE_URL', value: 'https://acme.example.test' },
      { key: 'NEXT_PUBLIC_API_KEY', value: 'sk_live_' + 'abc123' },
    ]);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.key === 'NEXT_PUBLIC_API_KEY' && i.level === 'error')).toBe(true);
  });

  test('passes when public vars carry only safe values', () => {
    const res = validateEnvVars([
      { key: 'NEXT_PUBLIC_SITE_URL', value: 'https://acme.example.test' },
      { key: 'NEXT_PUBLIC_GA_MEASUREMENT_ID', value: 'G-XXXX' },
    ]);
    expect(res.ok).toBe(true);
  });
});

// ── Case 9, 10: dry-run deploy planner (frontend mirror) ─────────────────────
describe('computeDryRunPlan', () => {
  const manifest: any = {
    routes: ['/', '/contact'],
    assets: { copied: [
      { assetId: 'a1', localPath: 'public/images/hero.jpg', bytes: 2048 },
      { assetId: 'a2', localPath: 'public/images/logo.png', bytes: 512 },
    ], missing: [], failed: [], totals: {} },
  };

  test('case 9: validates target config and derives remote path', () => {
    const plan = computeDryRunPlan({
      target: { targetType: 'hostgator_static', domain: 'acme.example.test', deployBasePath: '/public/acme', credentialsRef: 'REF' },
      manifest,
    });
    expect(plan.mode).toBe('dry_run');
    expect(plan.liveDeployEnabled).toBe(false);
    expect(plan.remotePath).toBe('/public/acme');
    // 2 routes (index.html + contact/index.html) + 2 assets = 4.
    expect(plan.fileCount).toBe(4);
    expect(plan.totalSize).toBe(2048 + 512);
    expect(plan.wouldUpload.every((f) => f.remotePath.startsWith('/public/acme/'))).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  test('case 9: missing config surfaces warnings + placeholder remote path', () => {
    const plan = computeDryRunPlan({ target: { targetType: 'hostgator_static' }, manifest });
    expect(plan.remotePath.startsWith('<')).toBe(true);
    const joined = plan.warnings.join(' ').toLowerCase();
    expect(joined).toContain('domain');
    expect(joined).toContain('deploybasepath');
    expect(joined).toContain('credentialsref');
  });

  test('case 10: planner is pure and never produces a published URL', () => {
    const t = { targetType: 'hostgator_static', domain: 'd', deployBasePath: '/p', credentialsRef: 'r' };
    const a = computeDryRunPlan({ target: t, manifest });
    const b = computeDryRunPlan({ target: t, manifest });
    expect(a).toEqual(b);
    expect((a as any).publishedUrl).toBeUndefined();
    expect(a.liveDeployEnabled).toBe(false);
  });

  test('diffs against a previous manifest to compute would-delete', () => {
    const previous: any = {
      routes: ['/', '/old'],
      assets: { copied: [{ assetId: 'x', localPath: 'public/images/old.jpg', bytes: 5 }], missing: [], failed: [], totals: {} },
    };
    const plan = computeDryRunPlan({
      target: { targetType: 'hostgator_static', domain: 'd', deployBasePath: '/p', credentialsRef: 'r' },
      manifest, previousManifest: previous,
    });
    const deleted = plan.wouldDelete.map((f) => f.path);
    expect(deleted).toContain('old/index.html');
    expect(deleted).toContain('public/images/old.jpg');
    expect(deleted).not.toContain('index.html'); // still present → updated, not deleted
  });
});

// ── Case 6, 7, 15: build orchestrator persists SiteBuild ─────────────────────
describe('buildStaticSite orchestrator', () => {
  function wireBuildMocks() {
    mockSiteBuildFindFirst.mockResolvedValue({ buildNumber: 2 });
    mockSiteBuildCreate.mockResolvedValue({ id: 'build-1' });
    mockSiteBuildUpdate.mockResolvedValue({ id: 'build-1' });
    mockWebsiteAssetFindMany.mockResolvedValue([
      { id: 'asset-hero', r2Key: 'businesses/acme/hero.jpg' },
      { id: 'asset-signed', r2Key: 'businesses/acme/team.jpg' },
    ]);
  }

  test('case 6/15: success persists SiteBuild as ready_for_preview (artifact only)', async () => {
    installMockProduction();
    wireBuildMocks();
    const res = await buildStaticSite({
      businessId: 'biz-1', websiteProductionId: 'prod-1',
      fetcher: okFetcher, writeFiles: false,
    });
    expect(res.buildStatus).toBe(BUILD_STATUS.READY_FOR_PREVIEW);
    expect(res.buildNumber).toBe(3); // 2 + 1
    expect(res.artifactManifest.build.executed).toBe(false);
    expect(res.artifactManifest.build.result).toBe('artifact_only');
    // Created in `building`, then updated to ready_for_preview.
    expect(mockSiteBuildCreate).toHaveBeenCalledTimes(1);
    const createArg = mockSiteBuildCreate.mock.calls[0][0];
    expect(createArg.data.buildStatus).toBe(BUILD_STATUS.BUILDING);
    const updateArg = mockSiteBuildUpdate.mock.calls[0][0];
    expect(updateArg.data.buildStatus).toBe(BUILD_STATUS.READY_FOR_PREVIEW);
    // Never advances to a deploy state.
    const serialized = JSON.stringify(mockSiteBuildUpdate.mock.calls);
    expect(serialized).not.toContain('deploying');
    expect(serialized).not.toContain('deployed');
    expect(serialized).not.toContain('approved_for_deploy');
  });

  test('case 7: a failure records build_failed with an error message', async () => {
    // Production not found → blueprint build throws inside the try.
    mockProductionFindFirst
      .mockResolvedValueOnce({ id: 'prod-1', websiteProjectId: 'proj-1' }) // orchestrator lookup
      .mockResolvedValueOnce(null); // blueprint serializer lookup → throws
    wireBuildMocks();
    const res = await buildStaticSite({
      businessId: 'biz-1', websiteProductionId: 'prod-1',
      fetcher: okFetcher, writeFiles: false,
    });
    expect(res.buildStatus).toBe(BUILD_STATUS.BUILD_FAILED);
    expect(res.errorMessage).toBeTruthy();
    const updateArg = mockSiteBuildUpdate.mock.calls[0][0];
    expect(updateArg.data.buildStatus).toBe(BUILD_STATUS.BUILD_FAILED);
    expect(updateArg.data.errorMessage).toBeTruthy();
  });
});
