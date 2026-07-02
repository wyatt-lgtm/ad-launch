/**
 * Milestone 8 — Preview approval + deployment-readiness gate tests.
 *
 * Exercises the PURE readiness gate + report builder against a REAL rendered
 * static package (built from the sitemap-first blueprint) plus targeted
 * failure-injection fixtures, and asserts structural invariants over the M8
 * modules/routes/UI (auth gating, no live deploy/publish, no image/copy gen, no
 * Google scraping, no Flux/local paths). Proves the gate:
 *  - Blocks on missing/wrong-business/not-ready/qa-missing/qa-failed/signed-url/
 *    secret builds.
 *  - Passes on a clean, QA'd preview and recommends a readiness (never deployed)
 *    status.
 *  - Treats deployment-target incompleteness as SEPARATE from preview readiness.
 *  - Produces a durable readiness report with a dry-run plan (liveDeploy false).
 *  - Never embeds secrets/signed URLs, never deploys/publishes, and does not
 *    regress existing systems.
 */

import fs from 'fs';
import path from 'path';
import {
  evaluatePreviewReadiness,
  buildReadinessReport,
  containsHardcodedHostPath,
  type PreviewBuildLike,
  type PreviewMobileQaLike,
  type PreviewReadinessContext,
} from '@/lib/site-preview-approval/readiness-gate';
import { assembleSitemapBlueprint } from '@/lib/site-builder/sitemap-blueprint';
import { renderStaticSite, type RenderedFile } from '@/lib/site-renderer';
import { materializeAssets, type AssetFetcher } from '@/lib/site-renderer/assets';
import { buildArtifactManifest, type ArtifactManifest } from '@/lib/site-builder/artifact-manifest';
import { computeDryRunPlan, type DryRunPlan, type DeployTargetConfig } from '@/lib/site-deploy/dry-run';
import {
  sectionAssetKey,
  type ResolvedBuildInputs,
  type ResolvedImageAsset,
  type ResolvedCopyRow,
} from '@/lib/site-builder/sitemap-build-inputs';
import type { WebsiteSitemapArtifact, SitemapPage } from '@/lib/website-sitemap';
import type { PageCopy } from '@/lib/website-copy';

const BUSINESS_ID = 'biz_test_m8';
const SITEMAP_ID = 'sm_test_m8';
const COPY_ID = 'copy_test_m8';
const BRIEF_SET_ID = 'briefset_test_m8';
const BUILD_ID = 'build_test_m8';
const QA_ID = 'qa_test_m8';

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
    websiteProjectId: 'proj_test_m8', sitemapId: SITEMAP_ID, sitemapApproved: true, sitemap,
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

async function realPackage(): Promise<{ files: RenderedFile[]; manifest: ArtifactManifest }> {
  const pages = [page({ slug: '/', pageType: 'home', h1: 'Home', title: 'Home', sortOrder: 0 })];
  const images = [heroAsset('/')];
  const inputs = makeInputs({ pages, images });
  const { blueprint } = assembleSitemapBlueprint(inputs);
  const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m8-nonexistent' });
  const materialization = await materializeAssets(blueprint.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
  const manifest = buildArtifactManifest({
    blueprint, renderManifest: pkg.manifest, materialization,
    sourceRef: pkg.outputDir, outputRef: null,
    buildCommand: 'npm run build', buildExecuted: false, buildResult: 'artifact_only', extraWarnings: [],
  });
  return { files: pkg.files, manifest };
}

function buildLike(over?: Partial<PreviewBuildLike>): PreviewBuildLike {
  return {
    id: BUILD_ID, businessId: BUSINESS_ID, buildStatus: 'ready_for_preview',
    sourceRef: '/tmp/m8-nonexistent/test-co', artifactManifestJson: null, ...over,
  };
}

function qaLike(over?: Partial<PreviewMobileQaLike>): PreviewMobileQaLike {
  return {
    id: QA_ID, siteBuildId: BUILD_ID, status: 'passed', passed: true, score: 100,
    checkedRoutesCount: 1, failedRoutesCount: 0, warningCount: 0, qaJson: { routes: [] }, ...over,
  };
}

function readyTarget(): DeployTargetConfig {
  return {
    targetType: 'hostgator_static', domain: 'example.com', siteUrl: null,
    deployBasePath: '/public_html', credentialsRef: 'HOSTGATOR_MAIN',
  };
}

function dryRun(manifest: ArtifactManifest, target?: DeployTargetConfig): DryRunPlan {
  return computeDryRunPlan({ target: target || readyTarget(), manifest });
}

async function fullCtx(over?: Partial<PreviewReadinessContext>): Promise<PreviewReadinessContext> {
  const { files, manifest } = await realPackage();
  return {
    businessId: BUSINESS_ID,
    businessExists: true,
    build: buildLike({ artifactManifestJson: manifest }),
    files,
    mobileQa: qaLike(),
    sitemapApproved: true,
    copyArtifactExists: true,
    target: readyTarget(),
    targetStatusRaw: 'configured',
    dryRunPlan: dryRun(manifest),
    deployRequested: false,
    ...over,
  };
}

// Source paths (jest runs from nextjs_space root).
const GATE_SRC = fs.readFileSync(path.join('lib', 'site-preview-approval', 'readiness-gate.ts'), 'utf8');
const ORCH_SRC = fs.readFileSync(path.join('lib', 'site-preview-approval', 'index.ts'), 'utf8');
const CARD_SRC = fs.readFileSync(path.join('app', 'dashboard', 'website', '_components', 'preview-approval-card.tsx'), 'utf8');
const ROUTE_DIR = path.join('app', 'api', 'businesses', '[id]', 'website', 'preview-approvals');
function routeSrc(rel: string) { return fs.readFileSync(path.join(ROUTE_DIR, rel), 'utf8'); }

// ═════════════════════════════════════════
describe('M8 preview readiness gate — blocking + passing', () => {
  it('1. blocks when the SiteBuild is missing', async () => {
    const ctx = await fullCtx({ build: null });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.previewStatus).toBe('preview_blocked');
    expect(r.blockingReasons.some((b) => b.code === 'build_missing')).toBe(true);
  });

  it('2. blocks when the build belongs to another business', async () => {
    const { files, manifest } = await realPackage();
    const ctx = await fullCtx({ build: buildLike({ businessId: 'other_biz', artifactManifestJson: manifest }), files });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'build_wrong_business')).toBe(true);
  });

  it('3. blocks when the build is not ready_for_preview', async () => {
    const { manifest } = await realPackage();
    const ctx = await fullCtx({ build: buildLike({ buildStatus: 'building', artifactManifestJson: manifest }) });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'build_not_ready')).toBe(true);
  });

  it('4. blocks when no mobile QA exists for the build', async () => {
    const ctx = await fullCtx({ mobileQa: null });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'mobile_qa_missing')).toBe(true);
  });

  it('5. blocks when the mobile QA did not pass', async () => {
    const ctx = await fullCtx({ mobileQa: qaLike({ status: 'failed', passed: false, score: 40 }) });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'mobile_qa_not_passed')).toBe(true);
  });

  it('5b. blocks when mobile QA reports critical route failures', async () => {
    const ctx = await fullCtx({
      mobileQa: qaLike({ failedRoutesCount: 2, qaJson: { routes: [] } }),
    });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'mobile_qa_critical_failures')).toBe(true);
  });

  it('6. blocks when the manifest stored a signed URL source', async () => {
    const { files, manifest } = await realPackage();
    const poisoned = JSON.parse(JSON.stringify(manifest)) as ArtifactManifest;
    if (poisoned.assets.copied[0]) poisoned.assets.copied[0].sourceKind = 'r2_signed' as any;
    const ctx = await fullCtx({ build: buildLike({ artifactManifestJson: poisoned }), files });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.checks.noSignedUrls).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'signed_url_embedded')).toBe(true);
  });

  it('6b. blocks when a signed URL is embedded in a package file', async () => {
    const { files, manifest } = await realPackage();
    const sig = 'X-Amz-' + 'Signature=deadbeef';
    const badContent = 'src=\'' + 'ht' + 'tps://cdn.test/hero.png?' + sig + '\'';
    const poisoned = [...files, { path: 'app/page.tsx.bad', content: badContent }];
    const ctx = await fullCtx({ build: buildLike({ artifactManifestJson: manifest }), files: poisoned });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'signed_url_embedded')).toBe(true);
  });

  it('7. blocks when a secret is embedded in a package file', async () => {
    const { files, manifest } = await realPackage();
    const secret = 'sk_' + 'live_' + 'ABCDEF0123456789abcdef';
    const poisoned = [...files, { path: 'app/leak.tsx.bad', content: `const k = '${secret}';` }];
    const ctx = await fullCtx({ build: buildLike({ artifactManifestJson: manifest }), files: poisoned });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.checks.noSecretsEmbedded).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'secret_embedded')).toBe(true);
  });

  it('7b. blocks when a hardcoded host/cPanel path is embedded in a package file', async () => {
    const { files, manifest } = await realPackage();
    const poisoned = [...files, { path: 'app/bad.tsx.bad', content: 'const p = "/home/tombuser/public_html/index.html";' }];
    const ctx = await fullCtx({ build: buildLike({ artifactManifestJson: manifest }), files: poisoned });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.checks.noHardcodedHostPaths).toBe(false);
    expect(r.blockingReasons.some((b) => b.code === 'hardcoded_host_path')).toBe(true);
  });

  it('8. passes a clean, QA\'d preview with a ready target', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(true);
    expect(r.previewStatus).toBe('preview_ready');
    expect(r.targetStatus).toBe('target_ready_for_future_deploy');
    expect(r.recommendedStatus).toBe('approved_for_deployment_readiness');
    expect(r.blockingReasons).toHaveLength(0);
    expect(r.checks.siteBuildReady).toBe(true);
    expect(r.checks.mobileQaPassed).toBe(true);
    expect(r.checks.routesGenerated).toBe(true);
    expect(r.checks.assetsPortable).toBe(true);
    expect(r.checks.liveDeployDisabled).toBe(true);
  });
});

describe('M8 approval / rejection decision logic + report', () => {
  it('9. approval requires a passing gate (blocked → not approvable, recommended blocked)', async () => {
    const ctx = await fullCtx({ mobileQa: null });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.approvable).toBe(false);
    expect(r.recommendedStatus).toBe('blocked');
  });

  it('10. rejection report preserves deployment-disabled invariants', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    const report = buildReadinessReport({
      result: r, status: 'rejected', manifest: ctx.build!.artifactManifestJson,
      mobileQa: ctx.mobileQa, deploymentTargetId: null, dryRunPlan: ctx.dryRunPlan,
      checkedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(report.status).toBe('rejected');
    expect(report.deploymentDisabled).toBe(true);
    expect(report.dryRunPlan?.liveDeployEnabled).toBe(false);
  });

  it('11. approval report records approvedBy + approvedAt + notes', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    const report = buildReadinessReport({
      result: r, status: 'approved_for_deployment_readiness',
      manifest: ctx.build!.artifactManifestJson, mobileQa: ctx.mobileQa,
      deploymentTargetId: 'tgt_1', dryRunPlan: ctx.dryRunPlan,
      checkedAt: '2026-07-01T00:00:00.000Z',
      approval: { approvedBy: 'user_1', approvedAt: '2026-07-01T00:00:00.000Z', notes: 'looks good' },
    });
    expect(report.status).toBe('approved_for_deployment_readiness');
    expect(report.approval?.approvedBy).toBe('user_1');
    expect(report.approval?.approvedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(report.approval?.notes).toBe('looks good');
  });

  it('12. no status value ever implies a live/deployed/published site', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    const forbidden = ['deployed', 'published', 'live', 'launched'];
    expect(forbidden).not.toContain(r.recommendedStatus);
    // Report + gate source must never emit those statuses.
    for (const f of forbidden) {
      expect(new RegExp(`status["'\`:\\s]+${f}\\b`).test(GATE_SRC)).toBe(false);
    }
  });

  it('13. no deploy is triggered (dry-run plan disables live deploy)', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    expect(r.checks.liveDeployDisabled).toBe(true);
    expect(ctx.dryRunPlan?.mode).toBe('dry_run');
    expect(ctx.dryRunPlan?.liveDeployEnabled).toBe(false);
    // Orchestrator never advances SiteBuild.buildStatus: the ONLY prisma.siteBuild
    // call is a read (findUnique); there is no siteBuild.update / write at all.
    expect(/prisma\.siteBuild\.update|prisma\.siteBuild\.updateMany|siteBuild\.update\(/.test(ORCH_SRC)).toBe(false);
    expect(/prisma\.siteBuild\.findUnique/.test(ORCH_SRC)).toBe(true);
  });

  it('14. no publish is triggered (orchestrator has no publish/upload/deploy calls)', () => {
    expect(/\bpublish\s*\(/.test(ORCH_SRC)).toBe(false);
    expect(/uploadTo|sftp|scp|cloudflarePages|deployTo/i.test(ORCH_SRC)).toBe(false);
  });

  it('15. readiness report embeds the dry-run plan', async () => {
    const ctx = await fullCtx();
    const r = evaluatePreviewReadiness(ctx);
    const report = buildReadinessReport({
      result: r, status: 'pending_review', manifest: ctx.build!.artifactManifestJson,
      mobileQa: ctx.mobileQa, deploymentTargetId: 'tgt_1', dryRunPlan: ctx.dryRunPlan,
      checkedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(report.dryRunPlan).toBeTruthy();
    expect(report.dryRunPlan?.mode).toBe('dry_run');
    expect(report.dryRunPlan?.liveDeployEnabled).toBe(false);
    expect(report.dryRunPlan?.wouldUploadCount).toBeGreaterThan(0);
    expect(report.routes.length).toBeGreaterThan(0);
    const round = JSON.parse(JSON.stringify(report));
    expect(round.checks.liveDeployDisabled).toBe(true);
  });

  it('16. a missing/incomplete target does NOT block a good preview', async () => {
    const noTarget = await fullCtx({ target: null, targetStatusRaw: null });
    const r1 = evaluatePreviewReadiness(noTarget);
    expect(r1.approvable).toBe(true);
    expect(r1.previewStatus).toBe('preview_ready');
    expect(r1.targetStatus).toBe('target_not_configured');
    expect(r1.recommendedStatus).toBe('approved_preview_only_target_incomplete');

    const incomplete = await fullCtx({
      target: { targetType: 'hostgator_static', domain: null, deployBasePath: null, credentialsRef: null },
      targetStatusRaw: 'draft',
    });
    const r2 = evaluatePreviewReadiness(incomplete);
    expect(r2.approvable).toBe(true);
    expect(r2.targetStatus).toBe('target_incomplete');
    expect(r2.recommendedStatus).toBe('approved_preview_only_target_incomplete');
  });
});

describe('M8 business scoping + auth (route structure)', () => {
  it('17. gate is strictly business-scoped (cross-business build blocked, refs echo businessId)', async () => {
    const { files, manifest } = await realPackage();
    const ctx = await fullCtx({ build: buildLike({ businessId: 'evil_biz', artifactManifestJson: manifest }), files });
    const r = evaluatePreviewReadiness(ctx);
    expect(r.refs.businessId).toBe(BUSINESS_ID);
    expect(r.blockingReasons.some((b) => b.code === 'build_wrong_business')).toBe(true);
  });

  it('18. {approvalId} routes enforce business scoping (404 on cross-business)', () => {
    for (const rel of ['[approvalId]/route.ts', '[approvalId]/approve/route.ts', '[approvalId]/reject/route.ts', '[approvalId]/readiness-report/route.ts']) {
      const src = routeSrc(rel);
      expect(src.includes('resolveBusinessAccess')).toBe(true);
      expect(/businessId/.test(src)).toBe(true);
    }
    // GET-one + readiness-report explicitly compare businessId and 404.
    for (const rel of ['[approvalId]/route.ts', '[approvalId]/readiness-report/route.ts']) {
      const src = routeSrc(rel);
      expect(/businessId\s*!==\s*businessId|businessId\s*!==/.test(src)).toBe(true);
      expect(src.includes('404')).toBe(true);
    }
  });

  it('19. every route requires an authenticated session (401) + access (403)', () => {
    for (const rel of ['route.ts', 'evaluate/route.ts', '[approvalId]/route.ts', '[approvalId]/approve/route.ts', '[approvalId]/reject/route.ts', '[approvalId]/readiness-report/route.ts']) {
      const src = routeSrc(rel);
      expect(src.includes('getServerSession')).toBe(true);
      expect(src.includes('401')).toBe(true);
      expect(src.includes('403')).toBe(true);
      expect(src.includes("export const dynamic = 'force-dynamic'")).toBe(true);
    }
    // Mutating routes reject deploy/publish/launch body fields.
    for (const rel of ['evaluate/route.ts', '[approvalId]/approve/route.ts']) {
      const src = routeSrc(rel);
      expect(/deploy\s*===\s*true/.test(src)).toBe(true);
      expect(/publish\s*===\s*true/.test(src)).toBe(true);
      expect(src.includes('400')).toBe(true);
    }
  });

  it('20. UI exposes NO live deploy/publish/launch action; deploy button is disabled + labelled', () => {
    // No fetch to a deploy/publish/launch endpoint.
    expect(/fetch\([^)]*deploy(?!ment-)/.test(CARD_SRC)).toBe(false);
    expect(/\/publish|\/launch/.test(CARD_SRC)).toBe(false);
    // The only forward control is disabled + labelled as a future milestone.
    expect(CARD_SRC.includes('Deployment disabled — future milestone')).toBe(true);
    expect(/disabled\s*\n?\s*title="Deployment disabled/.test(CARD_SRC) || CARD_SRC.includes('cursor-not-allowed')).toBe(true);
    // Required readiness labels are present.
    expect(CARD_SRC.includes('Preview approval only')).toBe(true);
    expect(CARD_SRC.includes('This does not publish or deploy the website')).toBe(true);
    expect(CARD_SRC.includes('Future deployment requires a separate approval step')).toBe(true);
    expect(CARD_SRC.includes('Deployment disabled — dry run only')).toBe(true);
  });
});

describe('M8 does not regress existing systems + hard constraints', () => {
  it('21. existing mobile QA module remains intact + importable', () => {
    const mod = require('@/lib/site-qa/mobile-qa-gate');
    expect(typeof mod.evaluateMobileQaGate).toBe('function');
  });

  it('22. existing static-build gate remains intact + importable', () => {
    const mod = require('@/lib/site-builder/static-build-gate');
    expect(typeof mod.evaluateStaticBuildGate).toBe('function');
    expect(typeof mod.evaluateGateFromInputs).toBe('function');
  });

  it('23. M8 never generates or references image generation', () => {
    expect(/image-generation|generateImage|flux|routellm|modalities/i.test(GATE_SRC)).toBe(false);
    expect(/image-generation|generateImage|flux/i.test(ORCH_SRC)).toBe(false);
  });

  it('24. M8 reads copy/sitemap read-only (no copy generation)', () => {
    // Re-render + read-only sitemap inputs only; no copy/sitemap generation calls.
    expect(ORCH_SRC.includes('resolveSitemapBuildInputs')).toBe(true);
    expect(/generateCopy|generateSitemap|writeCopy|createSitemap/i.test(ORCH_SRC)).toBe(false);
  });

  it('25. M8 does not touch Search Intelligence / DataForSEO', () => {
    expect(/search-intelligence|dataforseo|serp/i.test(GATE_SRC)).toBe(false);
    expect(/search-intelligence|dataforseo|serp/i.test(ORCH_SRC)).toBe(false);
  });

  it('26. M8 does not touch social generation/publishing', () => {
    expect(/social|scout-stories|clark-kent/i.test(GATE_SRC)).toBe(false);
    expect(/social|scout-stories|clark-kent/i.test(ORCH_SRC)).toBe(false);
  });

  it('27. M8 performs no Google scraping / browser automation', () => {
    for (const src of [GATE_SRC, ORCH_SRC]) {
      expect(/puppeteer|playwright|headless|scrape|google\.com\/search/i.test(src)).toBe(false);
    }
  });

  it('28. M8 uses no Flux + no hardcoded host/local paths in source', () => {
    for (const src of [GATE_SRC, ORCH_SRC]) {
      expect(/\bflux\b/i.test(src)).toBe(false);
    }
    // The gate DEFINES host-path detection patterns (allowed) but must not embed
    // an actual hardcoded deploy path as a literal string constant.
    expect(containsHardcodedHostPath('/home/someuser/public_html/index.html')).toBe(true);
    expect(containsHardcodedHostPath('app/page.tsx')).toBe(false);
    // Orchestrator must not hardcode a cPanel/HostGator absolute path.
    expect(/\/home\/[a-z0-9_]+\/public_html/i.test(ORCH_SRC)).toBe(false);
  });
});
