/**
 * Milestone 5 — Image generation behind APPROVED image briefs.
 * Pure-logic + gate + Don-contract + R2-key + QA + safety-scan coverage.
 */
import fs from 'fs';
import path from 'path';
import {
  canGenerateImages,
  buildDonRenderContract,
  buildWebsiteAssetR2Key,
  normalizeAndyRenderMetadata,
  evaluateHeroQa,
  evaluateNonHeroQa,
  deriveStatusFromQa,
  validateGeneratedAssets,
  canApproveAsset,
  buildImageAssetIdempotencyKey,
  isSignedUrl,
  isDurableR2Reference,
  briefRequestsLogoAsHero,
  GENERATED_IMAGE_BUCKET,
  CUSTOMER_ASSETS_BUCKET,
  HERO_VISUAL_PASS_THRESHOLD,
  type BriefSetForGeneration,
  type GeneratedImageAssetRecord,
} from '@/lib/website-image-generation';
import type { WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import type { CopyArtifactForBriefs } from '@/lib/website-image-briefs';

// ── Fixtures ────────────────────────────────────────────────────────────────
function heroBrief(over: Partial<any> = {}): any {
  return {
    briefId: over.briefId || 'brief_hero_1',
    sectionName: 'Hero',
    sectionType: 'hero',
    messageSupported: 'Trusted local service',
    visualObjective: 'Show a technician working on a vehicle in a clean bay',
    businessSpecificDirection: 'Feature the actual shop environment',
    industryDetails: ['brake rotor', 'lift'],
    localDetails: ['West Houston', 'Texas'],
    forbiddenVisuals: ['stock smiling headset agents', 'logo as hero image', 'logo-as-hero'],
    assetSourcePreference: 'generated_asset',
    aspectRatio: '16:9',
    mobileCropNotes: 'Keep subject centered for 4:5 crop',
    textSafeZone: 'Left third clear for headline',
    brandFitNotes: 'Accent with brand blue',
    donContractReady: true,
    andyRenderReady: false,
    allowTextInImage: false,
    ...over,
  };
}
function sectionBrief(over: Partial<any> = {}): any {
  return {
    ...heroBrief(),
    briefId: over.briefId || 'brief_sec_1',
    sectionName: 'Service detail',
    sectionType: 'section',
    textSafeZone: '',
    ...over,
  };
}
function page(slug: string, briefs: any[], pageType = 'service'): any {
  return { slug, pageType, h1: slug, briefs };
}
function artifact(pages: any[]): any {
  return {
    businessId: 'biz1',
    sitemapId: 'sm1',
    copyArtifactId: 'sm1',
    source: 'website_copy',
    status: 'approved',
    pages,
    summary: { pageCount: pages.length, briefCount: pages.reduce((n, p) => n + p.briefs.length, 0), heroBriefCount: 1, generatedAt: new Date().toISOString() },
  };
}
function briefSet(over: Partial<BriefSetForGeneration> = {}): BriefSetForGeneration {
  const pages = over.artifact?.pages || [page('/', [heroBrief()])];
  return {
    id: 'set1', businessId: 'biz1', sitemapId: 'sm1', copyArtifactId: 'sm1', status: 'approved',
    artifact: over.artifact || artifact(pages), ...over,
  } as BriefSetForGeneration;
}
const sitemap: WebsiteSitemapArtifact = {
  id: 'sm1',
  approvalStatus: 'approved',
  status: 'approved',
  pages: [{ slug: '/', pageType: 'home', h1: 'Home' } as any],
} as any;
const copy: CopyArtifactForBriefs = { sitemapId: 'sm1', status: 'approved', pages: [{ slug: '/', pageType: 'home', h1: 'Home' } as any] } as any;

// ── Gate ────────────────────────────────────────────────────────────────────
describe('canGenerateImages gate', () => {
  const opts = { sitemapId: 'sm1', businessId: 'biz1', requested: true };
  it('blocks when sitemap missing', () => {
    expect(canGenerateImages(null, copy, briefSet(), opts).allowed).toBe(false);
  });
  it('blocks when copy missing', () => {
    expect(canGenerateImages(sitemap, null, briefSet(), opts).allowed).toBe(false);
  });
  it('blocks when brief set missing', () => {
    const r = canGenerateImages(sitemap, copy, null, opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('brief_set_missing');
  });
  it('blocks when brief set not approved', () => {
    const r = canGenerateImages(sitemap, copy, briefSet({ status: 'draft' }), opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('brief_set_not_approved');
  });
  it('blocks when brief set belongs to another business', () => {
    const r = canGenerateImages(sitemap, copy, briefSet({ businessId: 'other' }), opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('brief_set_business_mismatch');
  });
  it('blocks when brief set references a different sitemap', () => {
    const r = canGenerateImages(sitemap, copy, briefSet({ sitemapId: 'smX' }), opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('brief_set_reference_mismatch');
  });
  it('blocks when a hero brief is missing a required field', () => {
    const bs = briefSet({ artifact: artifact([page('/', [heroBrief({ textSafeZone: '' })])]) });
    const r = canGenerateImages(sitemap, copy, bs, opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('brief_missing_fields');
  });
  it('blocks when a brief permits logo-as-hero', () => {
    const bs = briefSet({ artifact: artifact([page('/', [heroBrief({ visualObjective: 'Just the business logo used as the hero, centered' })])]) });
    const r = canGenerateImages(sitemap, copy, bs, opts);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('logo_as_hero_forbidden');
  });
  it('blocks when generation not requested', () => {
    const r = canGenerateImages(sitemap, copy, briefSet(), { ...opts, requested: false });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('not_requested');
  });
  it('allows when everything is approved and complete', () => {
    const r = canGenerateImages(sitemap, copy, briefSet(), opts);
    expect(r.allowed).toBe(true);
    expect(r.code).toBe('ok');
  });
});

// ── Don contract ────────────────────────────────────────────────────────────
describe('buildDonRenderContract', () => {
  it('produces a full hero contract from a brief', () => {
    const c = buildDonRenderContract(heroBrief(), page('/', [heroBrief()]), sitemap, { businessName: 'West Houston Auto Repair' });
    expect(c.sectionType).toBe('hero');
    expect(c.assetRole).toBe('hero_image');
    expect(c.businessName).toBe('West Houston Auto Repair');
    expect(c.textSafeZone).toBeTruthy();
    expect(c.mobileCropSafeZone).toBeTruthy();
    expect(c.forbiddenTextInImage).toBe(true);
    expect(c.forbiddenVisuals.length).toBeGreaterThan(0);
    expect(c.outputRequirements.format).toBe('png');
  });
});

// ── R2 key ──────────────────────────────────────────────────────────────────
describe('buildWebsiteAssetR2Key', () => {
  it('builds a durable, browsable key in the website-assets namespace', () => {
    const key = buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: 'brief_hero_1', sectionName: 'Hero', assetRole: 'hero_image', now: new Date('2026-07-01') });
    expect(key).toMatch(/^website-assets\/biz1\/2026-07\/brief_brief_hero_1\//);
    expect(key.endsWith('.png')).toBe(true);
    expect(isSignedUrl(key)).toBe(false);
    expect(isDurableR2Reference(GENERATED_IMAGE_BUCKET, key)).toBe(true);
  });
});

// ── Andy metadata normalization ─────────────────────────────────────────────
describe('normalizeAndyRenderMetadata', () => {
  const goodKey = buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: 'b', sectionName: 'Hero', assetRole: 'hero_image' });
  it('accepts a durable bucket/key in tombstoner2', () => {
    const r = normalizeAndyRenderMetadata({ r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: goodKey, provider: 'tombstone_andy', model: 'x' });
    expect(r.ok).toBe(true);
  });
  it('rejects a signed URL stored as durable ref', () => {
    const r = normalizeAndyRenderMetadata({ r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: 'https://placehold.co/1200x600/e2e8f0/1e293b?text=a_PNG_image_file_named__a_png__stored_in_the_tombs' });
    expect(r.ok).toBe(false);
  });
  it('rejects the customer-assets bucket', () => {
    const r = normalizeAndyRenderMetadata({ r2Bucket: CUSTOMER_ASSETS_BUCKET, r2Key: goodKey });
    expect(r.ok).toBe(false);
  });
  it('rejects a logo-as-hero result', () => {
    const r = normalizeAndyRenderMetadata({ r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: goodKey, rejectedLogoAsHero: true });
    expect(r.ok).toBe(false);
  });
});

// ── Hero QA ─────────────────────────────────────────────────────────────────
describe('hero QA', () => {
  const contract = buildDonRenderContract(heroBrief(), page('/', [heroBrief()]), sitemap, {});
  const meta = { provider: 'p', model: 'm', r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: 'b', sectionName: 'Hero', assetRole: 'hero_image' }), mimeType: 'image/png' } as any;
  it('passes and yields ready_for_review when score >= threshold', () => {
    const qa = evaluateHeroQa({ metadata: meta, contract, providerScores: { heroVisualScore: 90 } });
    expect(qa.qaStatus).toBe('passed');
    expect(qa.heroVisualScore).toBeGreaterThanOrEqual(HERO_VISUAL_PASS_THRESHOLD);
    expect(deriveStatusFromQa('hero', qa.qaStatus)).toBe('ready_for_review');
  });
  it('fails and blocks approval when score below threshold', () => {
    const qa = evaluateHeroQa({ metadata: meta, contract, providerScores: { heroVisualScore: 70 } });
    expect(qa.qaStatus).toBe('failed');
    expect(deriveStatusFromQa('hero', qa.qaStatus)).toBe('qa_failed');
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: 'failed', status: 'qa_failed' }).allowed).toBe(false);
  });
  it('non-hero uses lighter validation', () => {
    const c = buildDonRenderContract(sectionBrief(), page('/s', [sectionBrief()]), sitemap, {});
    const qa = evaluateNonHeroQa({ metadata: meta, contract: c, brief: sectionBrief() });
    expect(['passed', 'failed']).toContain(qa.qaStatus);
  });
});

// ── validateGeneratedAssets ─────────────────────────────────────────────────
describe('validateGeneratedAssets', () => {
  const base: GeneratedImageAssetRecord = {
    businessId: 'biz1', websiteProjectId: null, sitemapId: 'sm1', copyArtifactId: 'sm1',
    imageBriefSetId: 'set1', imageBriefId: 'b1', pageSlug: '/', sectionName: 'Hero', sectionType: 'hero',
    assetRole: 'hero_image', status: 'ready_for_review', provider: 'p', model: 'm',
    r2Bucket: GENERATED_IMAGE_BUCKET, r2Key: buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: 'b1', sectionName: 'Hero', assetRole: 'hero_image' }),
    mimeType: 'image/png', width: 1600, height: 900, altText: null, promptSummary: null, visualRationale: null,
    qualityScore: 90, brandFitScore: 88, mobileSafeScore: 88, textReadabilityScore: 88, focalPointScore: 88,
    qaStatus: 'passed', requiredFixes: [],
  };
  it('passes a valid durable hero record', () => {
    expect(validateGeneratedAssets([base])).toHaveLength(0);
  });
  it('flags a signed URL stored as durable ref', () => {
    const bad = { ...base, r2Key: 'https://placehold.co/1200x600/e2e8f0/1e293b?text=PNG_image_file_stored_in_tombstoner2_bucket_on_Clo' };
    const issues = validateGeneratedAssets([bad]);
    expect(issues.some((i) => i.kind === 'signed_url_stored' || i.kind === 'non_durable_r2')).toBe(true);
  });
  it('flags the wrong bucket', () => {
    const bad = { ...base, r2Bucket: CUSTOMER_ASSETS_BUCKET };
    expect(validateGeneratedAssets([bad]).some((i) => i.kind === 'wrong_bucket')).toBe(true);
  });
  it('exempts a failed diagnostic record from durability', () => {
    const failed = { ...base, status: 'failed' as const, r2Bucket: null, r2Key: null, qualityScore: null };
    expect(validateGeneratedAssets([failed])).toHaveLength(0);
  });
});

// ── West Houston Auto Repair ────────────────────────────────────────────────
describe('West Houston Auto Repair case (mocked)', () => {
  const services = ['Brake', 'Oil Change', 'Transmission', 'AC', 'Tire'];
  const pages = [
    page('/', [heroBrief({ briefId: 'home_hero' })], 'home'),
    page('/services', [heroBrief({ briefId: 'services_hero' })], 'services_hub'),
    ...services.map((s, i) => page(`/services/${s.toLowerCase().replace(/\s+/g, '-')}`, [heroBrief({ briefId: `svc_${i}_hero`, visualObjective: `Show a ${s} service being performed on a vehicle` })], 'service')),
  ];
  const bs = briefSet({ artifact: artifact(pages) });
  it('gate allows generation for the full approved set', () => {
    expect(canGenerateImages(sitemap, copy, bs, { sitemapId: 'sm1', businessId: 'biz1', requested: true }).allowed).toBe(true);
  });
  it('every hero brief yields a subject-specific Don contract + durable R2 key, no signed URLs', () => {
    for (const p of pages) {
      for (const b of p.briefs) {
        const c = buildDonRenderContract(b, p, sitemap, { businessName: 'West Houston Auto Repair' });
        expect(c.assetRole).toBe('hero_image');
        expect(briefRequestsLogoAsHero(b)).toBe(false);
        const key = buildWebsiteAssetR2Key({ businessId: 'biz1', imageBriefId: b.briefId, sectionName: b.sectionName, assetRole: 'hero_image' });
        expect(isDurableR2Reference(GENERATED_IMAGE_BUCKET, key)).toBe(true);
        expect(isSignedUrl(key)).toBe(false);
      }
    }
  });
});

// ── Safety source scan ──────────────────────────────────────────────────────
describe('safety source scan', () => {
  function readCode(rel: string): string {
    const raw = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }
  const files = [
    'lib/website-image-generation.ts',
    'lib/website-image-generation-store.ts',
    'lib/website-image-render-provider.ts',
  ];
  it('never references Flux or hardcoded local paths', () => {
    for (const f of files) {
      const code = readCode(f);
      expect(/flux/i.test(code)).toBe(false);
      expect(/\/home\/ubuntu|\/Users\//.test(code)).toBe(false);
    }
  });
  it('never performs static build / publish / deploy in the pure + store modules', () => {
    for (const f of ['lib/website-image-generation.ts', 'lib/website-image-generation-store.ts']) {
      const code = readCode(f).toLowerCase();
      expect(code).not.toContain('next build');
      expect(code).not.toContain('hostgator');
      expect(code).not.toContain('cloudflare pages');
    }
  });
  it('generated assets always target the tombstoner2 bucket, never the customer bucket', () => {
    const code = readCode('lib/website-image-generation.ts');
    expect(code).toContain("GENERATED_IMAGE_BUCKET = 'tombstoner2'");
    expect(code).toContain("CUSTOMER_ASSETS_BUCKET = 'tombstoner2customerassets'");
  });
});

// ── M5C hardening: approval allow-list + idempotency key ────────────────────
describe('canApproveAsset — approval allow-list', () => {
  it('allows a generated asset awaiting review', () => {
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: 'passed', status: 'generated' }).allowed).toBe(true);
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: 'passed', status: 'ready_for_review' }).allowed).toBe(true);
  });
  it('blocks a failed render', () => {
    const r = canApproveAsset({ assetRole: 'hero_image', qaStatus: 'failed', status: 'failed' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/failed asset cannot be approved/i);
  });
  it('blocks a qa_failed asset', () => {
    const r = canApproveAsset({ assetRole: 'hero_image', qaStatus: 'failed', status: 'qa_failed' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/failed QA/i);
  });
  it('blocks non-reviewable states (queued / generating / approved)', () => {
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: null, status: 'queued' }).allowed).toBe(false);
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: null, status: 'generating' }).allowed).toBe(false);
    expect(canApproveAsset({ assetRole: 'hero_image', qaStatus: 'passed', status: 'approved' }).allowed).toBe(false);
  });
});

describe('buildImageAssetIdempotencyKey', () => {
  const base = { businessId: 'biz1', imageBriefSetId: 'set1', imageBriefId: 'b1', pageSlug: '/', sectionName: 'Hero Section' };
  it('is stable for identical inputs', () => {
    expect(buildImageAssetIdempotencyKey(base)).toBe(buildImageAssetIdempotencyKey(base));
  });
  it('includes every identifying part and defaults version to v1', () => {
    const key = buildImageAssetIdempotencyKey(base);
    expect(key).toContain('biz1');
    expect(key).toContain('set1');
    expect(key).toContain('b1');
    expect(key).toContain('hero-section');
    expect(key.endsWith('::v1')).toBe(true);
  });
  it('changes when the attempt/version changes', () => {
    expect(buildImageAssetIdempotencyKey({ ...base, attempt: 2 })).not.toBe(buildImageAssetIdempotencyKey(base));
  });
  it('differs across briefs and sections', () => {
    expect(buildImageAssetIdempotencyKey({ ...base, imageBriefId: 'b2' })).not.toBe(buildImageAssetIdempotencyKey(base));
    expect(buildImageAssetIdempotencyKey({ ...base, sectionName: 'Other' })).not.toBe(buildImageAssetIdempotencyKey(base));
  });
});
