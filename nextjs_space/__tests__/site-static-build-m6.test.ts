/**
 * Milestone 6 — sitemap-first static build tests (pure, no DB / no network).
 *
 * Exercises the gate, blueprint assembly, rendering, asset materialization
 * (via an injected deterministic fetcher) and post-build validation to prove
 * the build is driven by the approved sitemap + copy + approved images and
 * never by concept HTML, never leaks signed URLs / secrets, and never deploys.
 */

import { evaluateGateFromInputs } from '@/lib/site-builder/static-build-gate';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { renderStaticSite } from '@/lib/site-renderer';
import { materializeAssets, type AssetFetcher } from '@/lib/site-renderer/assets';
import { validateStaticPackage } from '@/lib/site-builder/post-build-validation';
import {
  sectionAssetKey,
  type ResolvedBuildInputs,
  type ResolvedImageAsset,
  type ResolvedCopyRow,
} from '@/lib/site-builder/sitemap-build-inputs';
import type { WebsiteSitemapArtifact, SitemapPage } from '@/lib/website-sitemap';
import type { PageCopy } from '@/lib/website-copy';

const BUSINESS_ID = 'biz_test_m6';
const SITEMAP_ID = 'sm_test_m6';
const COPY_ID = 'copy_test_m6';
const BRIEF_SET_ID = 'briefset_test_m6';

function page(p: Partial<SitemapPage> & { slug: string; pageType: SitemapPage['pageType']; h1: string; title: string }): SitemapPage {
  return {
    title: p.title,
    slug: p.slug,
    pageType: p.pageType,
    h1: p.h1,
    purpose: p.purpose,
    sections: p.sections || ['Hero'],
    parentSlug: p.parentSlug,
    serviceName: p.serviceName,
    confirmationStatus: p.confirmationStatus,
    source: p.source,
    approvalStatus: p.approvalStatus || 'approved',
    sortOrder: p.sortOrder ?? 0,
  } as SitemapPage;
}

function copyFor(p: SitemapPage): PageCopy {
  return {
    slug: p.slug,
    pageType: p.pageType,
    h1: p.h1,
    metaTitle: `${p.title} | Test Co`,
    metaDescription: `Meta description for ${p.title}.`,
    heroHeadline: `${p.title} headline`,
    heroSubheadline: `${p.title} subheadline`,
    primaryCta: 'Get a Free Quote',
    sections: [{ name: 'Overview', heading: 'Overview', body: 'Body copy for the page.' }],
    faqs: [],
    internalLinks: [],
    serviceAreaLine: 'Serving Houston, TX',
    imageNeeds: [],
    seoBriefStatus: 'none',
    stage: 'draft',
  } as unknown as PageCopy;
}

function heroAsset(slug: string, over?: Partial<ResolvedImageAsset>): ResolvedImageAsset {
  return {
    id: `img_${slug.replace(/\W+/g, '_')}`,
    pageSlug: slug,
    sectionName: 'Hero',
    sectionType: 'hero',
    assetRole: 'hero_image',
    status: 'approved',
    r2Bucket: 'tombstoner2',
    r2Key: `website-assets/${BUSINESS_ID}/2026-07/${BRIEF_SET_ID}/hero-${slug.replace(/\W+/g, '_')}.png`,
    mimeType: 'image/png',
    width: 1536,
    height: 1024,
    altText: `Hero image for ${slug}`,
    imageBriefSetId: BRIEF_SET_ID,
    sitemapId: SITEMAP_ID,
    copyArtifactId: COPY_ID,
    durable: true,
    ...over,
  };
}

/** Build a ResolvedBuildInputs fixture from page + image + copy arrays. */
function makeInputs(opts: {
  pages: SitemapPage[];
  images: ResolvedImageAsset[];
  copyStatus?: string;
  sitemapApproved?: boolean;
  briefSet?: boolean;
  omitCopyForSlugs?: string[];
}): ResolvedBuildInputs {
  const buildablePages = opts.pages
    .filter((p) => (p.approvalStatus || '').toLowerCase() !== 'rejected')
    .filter((p) => !(p.pageType === 'service_detail' && p.confirmationStatus !== 'confirmed'))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const copyRows: ResolvedCopyRow[] = [];
  const copyBySlug = new Map<string, ResolvedCopyRow>();
  for (const p of opts.pages) {
    if (opts.omitCopyForSlugs?.includes(p.slug)) continue;
    const row: ResolvedCopyRow = {
      id: COPY_ID,
      slug: p.slug,
      pageType: p.pageType,
      status: opts.copyStatus || 'draft',
      h1: p.h1,
      copy: copyFor(p),
    };
    copyRows.push(row);
    copyBySlug.set(p.slug, row);
  }

  const heroBySlug = new Map<string, ResolvedImageAsset>();
  const sectionAssetByKey = new Map<string, ResolvedImageAsset>();
  for (const img of opts.images) {
    if (!img.durable) continue;
    if (img.sectionType === 'hero') {
      if (!heroBySlug.has(img.pageSlug)) heroBySlug.set(img.pageSlug, img);
    } else {
      const k = sectionAssetKey(img.pageSlug, img.sectionName);
      if (!sectionAssetByKey.has(k)) sectionAssetByKey.set(k, img);
    }
  }

  const sitemap: WebsiteSitemapArtifact = {
    businessName: 'Test Co',
    industry: 'Marketing',
    primaryServiceArea: { city: 'Houston', state: 'TX' },
    websiteGoal: 'leads',
    serviceAreaMode: 'local',
    sourceSummary: '',
    serviceDiscovery: [],
    pages: opts.pages,
    userRequestedPages: [],
    approvalStatus: opts.sitemapApproved === false ? 'draft' : 'approved',
  } as unknown as WebsiteSitemapArtifact;

  return {
    business: {
      id: BUSINESS_ID,
      businessName: 'Test Co',
      businessCity: 'Houston',
      businessState: 'TX',
      businessZip: null,
      businessPhone: null,
      serviceAreaMode: 'local',
      primaryMarketCity: 'Houston',
      primaryMarketState: 'TX',
      defaultGhlUserEmail: null,
      forbiddenBrandTerms: [],
    },
    websiteProjectId: 'proj_test_m6',
    sitemapId: SITEMAP_ID,
    sitemapApproved: opts.sitemapApproved !== false,
    sitemap,
    buildablePages,
    copyRows,
    copyBySlug,
    briefSet: opts.briefSet === false ? null : { id: BRIEF_SET_ID, status: 'approved', sitemapId: SITEMAP_ID, copyArtifactId: COPY_ID },
    images: opts.images,
    heroBySlug,
    sectionAssetByKey,
  };
}

/** A deterministic fetcher that returns 1x1 PNG bytes for every asset. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const okFetcher: AssetFetcher = async () => ({ buffer: PNG_BYTES, contentType: 'image/png' });
const failFetcher: AssetFetcher = async () => null;

function fullSitePages(): SitemapPage[] {
  return [
    page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home', sortOrder: 0 }),
    page({ slug: '/services', pageType: 'service_hub', h1: 'Our Services in Houston, TX', title: 'Services', sortOrder: 1 }),
    page({ slug: '/services/seo', pageType: 'service_detail', h1: 'SEO in Houston, TX', title: 'SEO', serviceName: 'SEO', confirmationStatus: 'confirmed', parentSlug: '/services', sortOrder: 2 }),
    page({ slug: '/services/ppc', pageType: 'service_detail', h1: 'PPC in Houston, TX', title: 'PPC', serviceName: 'PPC', confirmationStatus: 'confirmed', parentSlug: '/services', sortOrder: 3 }),
  ];
}

describe('M6 static build gate', () => {
  it('blocks when no sitemap is approved', () => {
    const inputs = makeInputs({ pages: fullSitePages(), images: [heroAsset('/')], sitemapApproved: false });
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs);
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code.includes('sitemap'))).toBe(true);
  });

  it('blocks when a required page has no copy', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)), omitCopyForSlugs: ['/services/ppc'] });
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs);
    expect(gate.ok).toBe(false);
  });

  it('blocks when a required hero image is missing', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: [heroAsset('/')] }); // only home has a hero
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs);
    expect(gate.ok).toBe(false);
    expect(gate.refs.missingRequiredImageCount).toBeGreaterThan(0);
  });

  it('blocks a deploy/publish request outright', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs, { deployRequested: true });
    expect(gate.ok).toBe(false);
    expect(gate.blocking.some((b) => b.code === 'deploy_requested')).toBe(true);
  });

  it('passes when sitemap + copy + required images are present', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs);
    expect(gate.ok).toBe(true);
    expect(gate.refs.routes.sort()).toEqual(['/', '/services', '/services/ppc', '/services/seo']);
  });

  it('rejects a signed-URL image as non-durable (blocks build)', () => {
    const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home' })];
    const signed = heroAsset('/', { durable: false, r2Key: 'https://i.ytimg.com/vi/DYvKUrmll8w/maxresdefault.jpg' });
    const inputs = makeInputs({ pages, images: [signed] });
    const gate = evaluateGateFromInputs(BUSINESS_ID, inputs);
    expect(gate.ok).toBe(false);
  });
});

describe('M6 blueprint + render + materialize', () => {
  it('assembles a blueprint from sitemap/copy/images (not concept HTML) with all routes', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const paths = blueprint.pages.map((p) => p.path).sort();
    expect(paths).toEqual(['/', '/services', '/services/ppc', '/services/seo']);
    // Traceable to the sitemap, not a production record.
    expect(blueprint.productionId).toBe(SITEMAP_ID);
  });

  it('preserves the service-detail H1 verbatim', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const seo = blueprint.pages.find((p) => p.path === '/services/seo');
    expect(seo?.h1).toBe('SEO in Houston, TX');
  });

  it('links the services hub to every service detail and home to the hub', () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const hub = blueprint.pages.find((p) => p.path === '/services');
    const hubLinks = (hub?.internalLinks || []).map((l) => l.path);
    expect(hubLinks).toEqual(expect.arrayContaining(['/services/seo', '/services/ppc']));
    const home = blueprint.pages.find((p) => p.path === '/');
    expect((home?.internalLinks || []).map((l) => l.path)).toContain('/services');
  });

  it('excludes rejected service pages from the package', () => {
    const pages = [
      ...fullSitePages(),
      page({ slug: '/services/webdesign', pageType: 'service_detail', h1: 'Web Design in Houston, TX', title: 'Web Design', serviceName: 'Web Design', confirmationStatus: 'confirmed', approvalStatus: 'rejected', sortOrder: 4 }),
    ];
    const inputs = makeInputs({ pages, images: fullSitePages().map((p) => heroAsset(p.slug)) });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    expect(blueprint.pages.some((p) => p.path === '/services/webdesign')).toBe(false);
  });

  it('materializes durable R2 keys into local /images/... paths (no signed URLs)', async () => {
    const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home' })];
    const inputs = makeInputs({ pages, images: [heroAsset('/')] });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m6-test-out' });
    const mat = await materializeAssets(blueprint.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
    expect(mat.assets.length).toBeGreaterThan(0);
    for (const a of mat.assets) {
      expect(a.webPath.startsWith('/images/')).toBe(true);
      expect(a.webPath).not.toMatch(/X-Amz-Signature/);
    }
    // Manifest source is the bare durable key, never a signed URL.
    for (const e of blueprint.assetManifest) {
      expect(e.sourceKind).not.toBe('r2_signed');
      expect(e.source || '').not.toMatch(/X-Amz-Signature/);
    }
  });

  it('emits a package with .env.example placeholders only and no secrets', () => {
    const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home' })];
    const inputs = makeInputs({ pages, images: [heroAsset('/')] });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m6-test-out' });
    const env = pkg.files.find((f) => f.path === '.env.example');
    expect(env).toBeTruthy();
    expect(env!.content).toMatch(/NEXT_PUBLIC_SITE_URL=/);
    expect(env!.content).toMatch(/NEXT_PUBLIC_GHL_FORM_ID=/);
    expect(env!.content).toMatch(/NEXT_PUBLIC_GA_MEASUREMENT_ID=/);
    // Placeholders only — no assigned secret values.
    expect(env!.content).not.toMatch(/sk_live_|sk_test_|AKIA[0-9A-Z]{16}/);
  });
});

describe('M6 post-build validation', () => {
  it('passes for a well-formed package and produces ready state', async () => {
    const pages = fullSitePages();
    const inputs = makeInputs({ pages, images: pages.map((p) => heroAsset(p.slug)) });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m6-test-out' });
    const mat = await materializeAssets(blueprint.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
    const res = validateStaticPackage({ blueprint, renderManifest: pkg.manifest, materialization: mat, sitemap: inputs.sitemap!, files: pkg.files });
    expect(res.ok).toBe(true);
  });

  it('records a warning (not a hard failure) when a hero cannot be materialized', async () => {
    const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home' })];
    const inputs = makeInputs({ pages, images: [heroAsset('/')] });
    const { blueprint } = assembleSitemapBlueprint(inputs);
    const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m6-test-out' });
    const mat = await materializeAssets(blueprint.assetManifest, pkg.outputDir, failFetcher, { writeFiles: false });
    const res = validateStaticPackage({ blueprint, renderManifest: pkg.manifest, materialization: mat, sitemap: inputs.sitemap!, files: pkg.files });
    // Missing bytes is a materialization warning, not a signed-URL/secret leak.
    expect(res.ok).toBe(true);
    expect(mat.failed + mat.missing).toBeGreaterThan(0);
  });
});
