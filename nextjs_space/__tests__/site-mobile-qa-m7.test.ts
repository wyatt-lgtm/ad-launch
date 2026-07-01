/**
 * Milestone 7 — Mobile / responsive QA tests (pure, no DB / no network).
 *
 * Exercises the mobile QA gate + deterministic analyzer against a REAL rendered
 * static package (built from the sitemap-first blueprint) plus targeted
 * failure-injection fixtures. Proves the QA:
 *  - Gates on missing/not-ready/wrong-business/signed-URL builds.
 *  - Detects horizontal scroll, sub-44px tap targets, nav, hero crop, image
 *    max-width and form usability regressions.
 *  - Marks critical regressions as failed and clean output as passed.
 *  - Never embeds secrets/signed URLs, never deploys, never generates content.
 *  - Is strictly business-scoped in shape.
 */

import {
  analyzeMobileQa,
  MOBILE_QA_VIEWPORTS,
  extractFixedPxWidths,
  detectUndersizedTapTargets,
  detectFixedMultiColumn,
  containsSignedUrl,
  containsSecret,
  evaluateNav,
  type AnalyzeMobileQaInput,
} from '@/lib/site-qa/mobile-qa';
import { evaluateMobileQaGate, type MobileQaBuildLike } from '@/lib/site-qa/mobile-qa-gate';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { renderStaticSite, type RenderedFile } from '@/lib/site-renderer';
import { materializeAssets, type AssetFetcher } from '@/lib/site-renderer/assets';
import { buildArtifactManifest, type ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import {
  sectionAssetKey,
  type ResolvedBuildInputs,
  type ResolvedImageAsset,
  type ResolvedCopyRow,
} from '@/lib/site-builder/sitemap-build-inputs';
import type { WebsiteSitemapArtifact, SitemapPage } from '@/lib/website-sitemap';
import type { PageCopy } from '@/lib/website-copy';

const BUSINESS_ID = 'biz_test_m7';
const SITEMAP_ID = 'sm_test_m7';
const COPY_ID = 'copy_test_m7';
const BRIEF_SET_ID = 'briefset_test_m7';
const BUILD_ID = 'build_test_m7';

function page(p: Partial<SitemapPage> & { slug: string; pageType: SitemapPage['pageType']; h1: string; title: string }): SitemapPage {
  return {
    title: p.title, slug: p.slug, pageType: p.pageType, h1: p.h1,
    purpose: p.purpose, sections: p.sections || ['Hero', 'Contact'],
    parentSlug: p.parentSlug, serviceName: p.serviceName,
    confirmationStatus: p.confirmationStatus, source: p.source,
    approvalStatus: p.approvalStatus || 'approved', sortOrder: p.sortOrder ?? 0,
  } as SitemapPage;
}

function copyFor(p: SitemapPage): PageCopy {
  return {
    slug: p.slug, pageType: p.pageType, h1: p.h1,
    metaTitle: `${p.title} | Test Co`, metaDescription: `Meta description for ${p.title}.`,
    heroHeadline: `${p.title} headline`, heroSubheadline: `${p.title} subheadline`,
    primaryCta: 'Get a Free Quote',
    sections: [
      { name: 'Overview', heading: 'Overview', body: 'Body copy for the page.' },
      { name: 'Contact', heading: 'Contact us', body: 'Reach out today.' },
    ],
    faqs: [], internalLinks: [], serviceAreaLine: 'Serving Houston, TX',
    imageNeeds: [], seoBriefStatus: 'none', stage: 'draft',
  } as unknown as PageCopy;
}

function heroAsset(slug: string, over?: Partial<ResolvedImageAsset>): ResolvedImageAsset {
  return {
    id: `img_${slug.replace(/\W+/g, '_')}`,
    pageSlug: slug, sectionName: 'Hero', sectionType: 'hero', assetRole: 'hero_image',
    status: 'approved', r2Bucket: 'tombstoner2',
    r2Key: `website-assets/${BUSINESS_ID}/2026-07/${BRIEF_SET_ID}/hero-${slug.replace(/\W+/g, '_')}.png`,
    mimeType: 'image/png', width: 1536, height: 1024, altText: `Hero image for ${slug}`,
    imageBriefSetId: BRIEF_SET_ID, sitemapId: SITEMAP_ID, copyArtifactId: COPY_ID, durable: true,
    ...over,
  };
}

function makeInputs(opts: { pages: SitemapPage[]; images: ResolvedImageAsset[] }): ResolvedBuildInputs {
  const buildablePages = opts.pages
    .filter((p) => (p.approvalStatus || '').toLowerCase() !== 'rejected')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const copyRows: ResolvedCopyRow[] = [];
  const copyBySlug = new Map<string, ResolvedCopyRow>();
  for (const p of opts.pages) {
    const row: ResolvedCopyRow = { id: COPY_ID, slug: p.slug, pageType: p.pageType, status: 'approved', h1: p.h1, copy: copyFor(p) };
    copyRows.push(row); copyBySlug.set(p.slug, row);
  }
  const heroBySlug = new Map<string, ResolvedImageAsset>();
  const sectionAssetByKey = new Map<string, ResolvedImageAsset>();
  for (const img of opts.images) {
    if (!img.durable) continue;
    if (img.sectionType === 'hero') { if (!heroBySlug.has(img.pageSlug)) heroBySlug.set(img.pageSlug, img); }
    else { const k = sectionAssetKey(img.pageSlug, img.sectionName); if (!sectionAssetByKey.has(k)) sectionAssetByKey.set(k, img); }
  }
  const sitemap = {
    businessName: 'Test Co', industry: 'Marketing',
    primaryServiceArea: { city: 'Houston', state: 'TX' }, websiteGoal: 'leads',
    serviceAreaMode: 'local', sourceSummary: '', serviceDiscovery: [],
    pages: opts.pages, userRequestedPages: [], approvalStatus: 'approved',
  } as unknown as WebsiteSitemapArtifact;
  return {
    business: {
      id: BUSINESS_ID, businessName: 'Test Co', businessCity: 'Houston', businessState: 'TX',
      businessZip: null, businessPhone: null, serviceAreaMode: 'local',
      primaryMarketCity: 'Houston', primaryMarketState: 'TX', defaultGhlUserEmail: null, forbiddenBrandTerms: [],
    },
    websiteProjectId: 'proj_test_m7', sitemapId: SITEMAP_ID, sitemapApproved: true, sitemap,
    buildablePages, copyRows, copyBySlug,
    briefSet: { id: BRIEF_SET_ID, status: 'approved', sitemapId: SITEMAP_ID, copyArtifactId: COPY_ID },
    images: opts.images, heroBySlug, sectionAssetByKey,
  } as ResolvedBuildInputs;
}

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const okFetcher: AssetFetcher = async () => ({ buffer: PNG_BYTES, contentType: 'image/png' });

/** Render a real package + manifest for a single-home-page site. */
async function realPackage(over?: { heroWidth?: number; heroHeight?: number }): Promise<{ files: RenderedFile[]; manifest: ArtifactManifest }> {
  const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home', sortOrder: 0 })];
  const images = [heroAsset('/', { width: over?.heroWidth ?? 1536, height: over?.heroHeight ?? 1024 })];
  const inputs = makeInputs({ pages, images });
  const { blueprint } = assembleSitemapBlueprint(inputs);
  const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m7-nonexistent' });
  const materialization = await materializeAssets(blueprint.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
  const manifest = buildArtifactManifest({
    blueprint, renderManifest: pkg.manifest, materialization,
    sourceRef: pkg.outputDir, outputRef: null,
    buildCommand: 'npm run build', buildExecuted: false, buildResult: 'artifact_only', extraWarnings: [],
  });
  return { files: pkg.files, manifest };
}

function baseInput(files: RenderedFile[], manifest: ArtifactManifest): AnalyzeMobileQaInput {
  return { businessId: BUSINESS_ID, siteBuildId: BUILD_ID, files, manifest, checkedAt: '2026-07-01T00:00:00.000Z' };
}

function buildLike(over?: Partial<MobileQaBuildLike>): MobileQaBuildLike {
  return {
    id: BUILD_ID, businessId: BUSINESS_ID, buildStatus: 'ready_for_preview',
    sourceRef: '/tmp/m7-nonexistent/test-co', artifactManifestJson: null, ...over,
  };
}

// ════════════════════════════════════════════════════════
describe('M7 mobile QA gate', () => {
  it('1. blocks when no build exists', async () => {
    const { files } = await realPackage();
    const gate = evaluateMobileQaGate({ businessId: BUSINESS_ID, businessExists: true, build: null, files });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'build_missing')).toBe(true);
  });

  it('2. blocks when the build is not ready_for_preview', async () => {
    const { files, manifest } = await realPackage();
    const gate = evaluateMobileQaGate({
      businessId: BUSINESS_ID, businessExists: true,
      build: buildLike({ buildStatus: 'building', artifactManifestJson: manifest }), files,
    });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'build_not_ready')).toBe(true);
  });

  it('3. blocks when the build belongs to another business', async () => {
    const { files, manifest } = await realPackage();
    const gate = evaluateMobileQaGate({
      businessId: BUSINESS_ID, businessExists: true,
      build: buildLike({ businessId: 'other_biz', artifactManifestJson: manifest }), files,
    });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'build_wrong_business')).toBe(true);
  });

  it('4. blocks when a signed URL is embedded in the package', async () => {
    const { files, manifest } = await realPackage();
    const sig = 'X-Amz-' + 'Signature=deadbeef';
    const badContent = 'src=\'' + 'ht'+'tps://cdn.test/hero.png?' + sig + '\'';
    const poisoned = [...files, { path: 'app/page.tsx.bad', content: badContent }];
    const gate = evaluateMobileQaGate({
      businessId: BUSINESS_ID, businessExists: true,
      build: buildLike({ artifactManifestJson: manifest }), files: poisoned,
    });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'signed_url_embedded')).toBe(true);
  });

  it('5. passes the gate on a genuine ready build with materialized images', async () => {
    const { files, manifest } = await realPackage();
    const gate = evaluateMobileQaGate({
      businessId: BUSINESS_ID, businessExists: true,
      build: buildLike({ artifactManifestJson: manifest }), files,
    });
    expect(gate.ok).toBe(true);
    expect(gate.refs.materializedImageCount).toBeGreaterThan(0);
    expect(gate.refs.pageFileCount).toBeGreaterThan(0);
  });

  it('6. blocks a deploy/publish request outright', async () => {
    const { files, manifest } = await realPackage();
    const gate = evaluateMobileQaGate({
      businessId: BUSINESS_ID, businessExists: true,
      build: buildLike({ artifactManifestJson: manifest }), files, deployRequested: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'deploy_requested')).toBe(true);
  });
});

describe('M7 mobile QA analyzer — runs + durable artifact', () => {
  it('7. runs against a ready package and checks route /', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    expect(report.routes.some((r) => r.path === '/')).toBe(true);
    expect(report.summary.checkedRoutesCount).toBeGreaterThan(0);
  });

  it('8. produces a durable, serializable report artifact with viewports', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    const round = JSON.parse(JSON.stringify(report));
    expect(round.viewports).toHaveLength(3);
    expect(round.viewports.map((v: any) => v.width)).toEqual([320, 390, 768]);
    expect(round.businessId).toBe(BUSINESS_ID);
    expect(round.siteBuildId).toBe(BUILD_ID);
    expect(round.checkedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('9. genuine rendered output passes mobile QA', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    expect(report.passed).toBe(true);
    expect(report.status).toBe('passed');
    expect(report.summary.criticalFailures).toHaveLength(0);
  });
});

describe('M7 mobile QA analyzer — responsive checks', () => {
  it('10. detects horizontal scroll from a fixed width > 320px', async () => {
    const { files, manifest } = await realPackage();
    const pageIdx = files.findIndex((f) => f.path === 'app/page.tsx');
    const injected = [...files];
    injected[pageIdx] = { path: 'app/page.tsx', content: files[pageIdx].content + '\n// <div style={{ width: 640 + "px" }} />\nconst w = "width: 980px";' };
    const report = analyzeMobileQa(baseInput(injected, manifest));
    const route = report.routes.find((r) => r.path === '/')!;
    const check = route.checks.find((c) => c.check === 'no_horizontal_scroll_320')!;
    expect(check.status).toBe('fail');
    expect(check.severity).toBe('critical');
    expect(report.passed).toBe(false);
  });

  it('11. detects a sub-44px tap target on a primary action', async () => {
    const { files, manifest } = await realPackage();
    const secIdx = files.findIndex((f) => f.path === 'components/Section.tsx');
    const injected = [...files];
    injected[secIdx] = { path: 'components/Section.tsx', content: files[secIdx].content.replace('data-cta', 'data-cta style={{ height: "30px" }}') };
    const report = analyzeMobileQa(baseInput(injected, manifest));
    const route = report.routes.find((r) => r.path === '/')!;
    const check = route.checks.find((c) => c.check === 'tap_targets_min_44')!;
    expect(check.status).toBe('fail');
  });

  it('12. flags a nav with too many items', () => {
    const navSrc = '<nav aria-label="Primary"><ul></ul></nav>';
    const items = Array.from({ length: 9 }, (_, i) => ({ label: `Item ${i}`, path: `/p${i}` }));
    const check = evaluateNav(items, navSrc);
    expect(check.status).toBe('warn');
    expect(check.check).toBe('nav_collapses');
  });

  it('13. flags a logo-as-hero / non-landscape hero image (crop risk)', async () => {
    const { files, manifest } = await realPackage({ heroWidth: 300, heroHeight: 300 });
    const report = analyzeMobileQa(baseInput(files, manifest));
    const route = report.routes.find((r) => r.path === '/')!;
    const check = route.checks.find((c) => c.check === 'hero_image_crop_safe')!;
    expect(check.status).toBe('warn');
  });

  it('14. detects a raw <img> with a fixed width wider than the viewport', async () => {
    const { files, manifest } = await realPackage();
    const pageIdx = files.findIndex((f) => f.path === 'app/page.tsx');
    const injected = [...files];
    injected[pageIdx] = { path: 'app/page.tsx', content: files[pageIdx].content + '\n// <img src="/x.png" width="800" />' };
    const report = analyzeMobileQa(baseInput(injected, manifest));
    const route = report.routes.find((r) => r.path === '/')!;
    const check = route.checks.find((c) => c.check === 'images_max_width_100')!;
    expect(check.status).toBe('fail');
  });

  it('15. confirms the lead form is usable (full-width) on the genuine package', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    const route = report.routes.find((r) => r.path === '/')!;
    const check = route.checks.find((c) => c.check === 'forms_usable')!;
    expect(check.status).toBe('pass');
  });
});

describe('M7 mobile QA analyzer — pass/fail + security', () => {
  it('16. a critical failure marks the whole report failed', async () => {
    const { files, manifest } = await realPackage();
    const pageIdx = files.findIndex((f) => f.path === 'app/page.tsx');
    const injected = [...files];
    injected[pageIdx] = { path: 'app/page.tsx', content: files[pageIdx].content + '\nconst s = "min-width: 900px";' };
    const report = analyzeMobileQa(baseInput(injected, manifest));
    expect(report.status).toBe('failed');
    expect(report.passed).toBe(false);
  });

  it('17. a clean package with no criticals is marked passed', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    expect(report.passed).toBe(true);
  });

  it('18. screenshots array is present and contains no secrets/URLs', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    for (const r of report.routes) {
      expect(Array.isArray(r.screenshots)).toBe(true);
      expect(r.screenshots.every((s) => !containsSignedUrl(s.artifactRef))).toBe(true);
    }
    const serialized = JSON.stringify(report);
    expect(containsSignedUrl(serialized)).toBe(false);
    expect(containsSecret(serialized)).toBe(false);
  });

  it('19. flags an embedded signed URL as a critical failure', async () => {
    const { files, manifest } = await realPackage();
    const sig = 'X-Amz-' + 'Signature=abc123';
    const badUrl = 'ht'+'tps://cdn.test/a.png?' + sig;
    const injected = [...files, { path: 'components/Bad.tsx', content: 'const u = "' + badUrl + '";' }];
    const report = analyzeMobileQa(baseInput(injected, manifest));
    const anySigned = report.routes.some((r) => r.checks.some((c) => c.check === 'no_signed_url_or_secret' && c.status === 'fail'));
    expect(anySigned).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('20. flags an embedded plaintext secret as a critical failure', async () => {
    const { files, manifest } = await realPackage();
    const injected = [...files, { path: 'components/Bad.tsx', content: 'const k = "AKIAABCDEFGHIJKLMNOP";' }];
    const report = analyzeMobileQa(baseInput(injected, manifest));
    expect(report.passed).toBe(false);
    expect(report.summary.criticalFailures.length).toBeGreaterThan(0);
  });

  it('21. detects a manifest asset that stored a signed source', async () => {
    const { files, manifest } = await realPackage();
    const poisoned: ArtifactManifest = JSON.parse(JSON.stringify(manifest));
    if (poisoned.assets.copied[0]) poisoned.assets.copied[0].sourceKind = 'r2_signed';
    const gate = evaluateMobileQaGate({ businessId: BUSINESS_ID, businessExists: true, build: buildLike({ artifactManifestJson: poisoned }), files });
    expect(gate.blocking.some((b) => b.code === 'signed_url_embedded')).toBe(true);
  });
});

describe('M7 mobile QA — invariants (no deploy / gen / cross-system)', () => {
  it('22. the report never advances the build (artifact-only, no deploy fields)', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    const serialized = JSON.stringify(report).toLowerCase();
    expect(serialized).not.toContain('deployed');
    expect(serialized).not.toContain('published');
    // The furthest allowed status is passed | failed | blocked.
    expect(['passed', 'failed', 'blocked']).toContain(report.status);
  });

  it('23. the analyzer performs no image/copy generation (pure over inputs)', async () => {
    const { files, manifest } = await realPackage();
    const before = JSON.stringify({ files, manifest });
    analyzeMobileQa(baseInput(files, manifest));
    const after = JSON.stringify({ files, manifest });
    expect(after).toBe(before); // inputs are never mutated
  });

  it('24. QA report is scoped to the given business + build ids only', async () => {
    const { files, manifest } = await realPackage();
    const report = analyzeMobileQa(baseInput(files, manifest));
    expect(report.businessId).toBe(BUSINESS_ID);
    expect(report.siteBuildId).toBe(BUILD_ID);
  });

  it('25. viewports are exactly the three required responsive widths', () => {
    expect(MOBILE_QA_VIEWPORTS.map((v) => v.width)).toEqual([320, 390, 768]);
  });

  it('26. detector helpers are deterministic + pure', () => {
    expect(extractFixedPxWidths('width: 640px; min-width:900px')).toEqual([900, 640]);
    expect(detectUndersizedTapTargets('<a data-cta style="height: 20px">Go</a>')).toContain('height 20px');
    expect(detectFixedMultiColumn('grid-template-columns: 200px 200px 200px')).toBe(true);
    expect(detectFixedMultiColumn('grid-template-columns: 1fr 1fr')).toBe(false);
  });
});
