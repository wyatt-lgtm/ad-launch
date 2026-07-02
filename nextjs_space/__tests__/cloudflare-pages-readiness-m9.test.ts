/**
 * Milestone 9 — Cloudflare Pages readiness gate + dry-run planner tests.
 *
 * Exercises the PURE Cloudflare readiness gate + dry-run planner against a REAL
 * rendered static package (built from the sitemap-first blueprint) plus targeted
 * failure-injection fixtures, and asserts structural invariants over the M9
 * modules / routes / UI:
 *  - CF target is creatable + business-scoped; wrong-business is denied.
 *  - Blocks on missing account id / project name / repo URL / credential ref.
 *  - Validates output directory is "out" + confirms static export config.
 *  - Never surfaces signed URLs or secret values.
 *  - Dry-run returns wouldCreatePagesProject / wouldConnectGitRepo / wouldAdd
 *    CustomDomain / wouldCreateCnameRecord WITHOUT any API call.
 *  - Models per-subdomain CNAME (name -> Pages target); .pages.dev default.
 *  - liveDeployEnabled + liveDnsMutationEnabled are ALWAYS false.
 *  - No live deploy / publish / DNS mutation; existing systems unchanged.
 */

import fs from 'fs';
import path from 'path';
import {
  evaluateCloudflareReadiness,
  computeCloudflarePagesDryRun,
  getManualSetupChecklist,
  classifyCustomDomain,
  resolveRepoUrl,
  resolveBranch,
  resolveCnameName,
  resolveCnameTarget,
  resolvePagesDevHost,
  CLOUDFLARE_TARGET_TYPE,
  REQUIRED_OUTPUT_DIRECTORY,
  DEFAULT_BUILD_COMMAND,
  DEFAULT_PRODUCTION_BRANCH,
  EXPECTED_PUBLIC_ENV_VARS,
  type CloudflareTargetConfig,
  type CloudflareReadinessContext,
} from '@/lib/site-deploy/cloudflare-readiness';
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

const BUSINESS_ID = 'biz_test_m9';
const SITEMAP_ID = 'sm_test_m9';
const COPY_ID = 'copy_test_m9';
const BRIEF_SET_ID = 'briefset_test_m9';

// ── Real-package fixtures (mirrors the M8 harness) ───────────────────────

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
    websiteProjectId: 'proj_test_m9', sitemapId: SITEMAP_ID, sitemapApproved: true, sitemap,
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
  const pkg = renderStaticSite(blueprint, { outputRoot: '/tmp/m9-nonexistent' });
  const materialization = await materializeAssets(blueprint.assetManifest, pkg.outputDir, okFetcher, { writeFiles: false });
  const manifest = buildArtifactManifest({
    blueprint, renderManifest: pkg.manifest, materialization,
    sourceRef: pkg.outputDir, outputRef: null,
    buildCommand: DEFAULT_BUILD_COMMAND, buildExecuted: false, buildResult: 'artifact_only', extraWarnings: [],
  });
  return { files: pkg.files, manifest };
}

// A fully-configured cloudflare_pages target (the M5C-style test case).
function fullTarget(over?: Partial<CloudflareTargetConfig>): CloudflareTargetConfig {
  return {
    targetType: CLOUDFLARE_TARGET_TYPE,
    status: 'configured',
    cloudflareAccountId: 'cf-account-123',
    cloudflareProjectName: 'tombstone-m5c-validation',
    cloudflareProjectRef: 'cf-proj-ref-1',
    githubRepoUrl: 'gh:' + 'example-org/tombstone-m5c',
    githubBranch: 'main',
    productionBranch: 'main',
    buildCommand: DEFAULT_BUILD_COMMAND,
    outputDirectory: REQUIRED_OUTPUT_DIRECTORY,
    credentialsRef: 'cloudflare_pages_test_ref',
    ...over,
  };
}

async function ctx(over?: Partial<CloudflareReadinessContext>): Promise<CloudflareReadinessContext> {
  const { files, manifest } = await realPackage();
  return {
    businessId: BUSINESS_ID,
    businessExists: true,
    target: fullTarget(),
    files,
    manifest,
    envReadiness: {
      accountId: { configured: true }, pagesApiToken: { configured: true },
      dnsApiToken: { configured: true }, defaultZoneId: { configured: true },
      ready: true, missing: [],
    },
    configuredEnvVarNames: [...EXPECTED_PUBLIC_ENV_VARS],
    deployRequested: false,
    ...over,
  };
}

// ── Gate: passing + blocking ─────────────────────────────────────────────

describe('M9 Cloudflare Pages readiness gate — passing + blocking', () => {
  it('a fully-configured cloudflare_pages target is READY', async () => {
    const res = evaluateCloudflareReadiness(await ctx());
    expect(res.status).toBe('ready');
    expect(res.ready).toBe(true);
    expect(res.checks.isCloudflareTarget).toBe(true);
    expect(res.checks.outputDirectoryValid).toBe(true);
    expect(res.checks.packageIsStaticExport).toBe(true);
    expect(res.recommendedTargetStatus).toBe('verified');
    expect(res.liveDeployEnabled).toBe(false);
    expect((res as any).liveDnsMutationEnabled).toBe(false);
  });

  it('a non-cloudflare target type is blocked (not_cloudflare_target)', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ targetType: 'hostgator_static' }) }));
    expect(res.status).toBe('blocked');
    expect(res.blockingReasons.some((b) => b.code === 'not_cloudflare_target')).toBe(true);
  });

  it('blocks when the business does not exist / is not accessible', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ businessExists: false }));
    expect(res.status).toBe('blocked');
    expect(res.blockingReasons.some((b) => b.code === 'business_missing')).toBe(true);
  });

  it('blocks when account id is missing', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ cloudflareAccountId: null }) }));
    expect(res.checks.accountIdPresent).toBe(false);
    expect(res.missingFields).toContain('cloudflareAccountId');
    expect(res.blockingReasons.some((b) => b.code === 'account_id_missing')).toBe(true);
  });

  it('blocks when project name is missing', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ cloudflareProjectName: null }) }));
    expect(res.checks.projectNamePresent).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'project_name_missing')).toBe(true);
  });

  it('blocks when GitHub repo URL is missing (no git fallback either)', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ githubRepoUrl: null, gitRepoUrl: null }) }));
    expect(res.checks.repoUrlPresent).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'repo_url_missing')).toBe(true);
  });

  it('blocks when the credential reference is missing', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ credentialsRef: null }) }));
    expect(res.checks.credentialRefPresent).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'credential_ref_missing')).toBe(true);
  });

  it('blocks when output directory is not "out"', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ outputDirectory: 'dist' }) }));
    expect(res.checks.outputDirectoryValid).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'output_directory_invalid')).toBe(true);
  });

  it('confirms the rendered package uses static export (output: export)', async () => {
    const res = evaluateCloudflareReadiness(await ctx());
    expect(res.checks.packageHasNextConfig).toBe(true);
    expect(res.checks.packageIsStaticExport).toBe(true);
    expect(res.checks.packageBuildsToOut).toBe(true);
  });

  it('hard-blocks any deploy request (deploy_requested)', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ deployRequested: true }));
    expect(res.status).toBe('blocked');
    expect(res.blockingReasons.some((b) => b.code === 'deploy_requested')).toBe(true);
  });
});

// ── Security: no signed URLs, no secrets ─────────────────────────────────

describe('M9 gate — never surfaces signed URLs or secrets', () => {
  it('blocks when a signed URL is embedded in the package', async () => {
    const base = await ctx();
    const signed =
      'ht' + 'tps://tombstoner2.r2.cloudflarestorage.com/x.png?' +
      'X-Amz-' + 'Signature=deadbeef&X-Amz-Credential=abc';
    const files = [...base.files, { path: 'signed.html', content: `<img src="${signed}">` } as RenderedFile];
    const res = evaluateCloudflareReadiness({ ...base, files });
    expect(res.checks.noSignedUrls).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'signed_url_embedded')).toBe(true);
  });

  it('blocks when a secret-like value is embedded in the package', async () => {
    const base = await ctx();
    const secret = 'sk_' + 'live_' + 'A'.repeat(32);
    const files = [...base.files, { path: 'leak.js', content: `const k = "${secret}";` } as RenderedFile];
    const res = evaluateCloudflareReadiness({ ...base, files });
    expect(res.checks.noSecretsEmbedded).toBe(false);
    expect(res.blockingReasons.some((b) => b.code === 'secret_embedded')).toBe(true);
  });

  it('the readiness result JSON never contains a raw secret value', async () => {
    const res = evaluateCloudflareReadiness(await ctx());
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/sk_live_/);
    expect(json).not.toMatch(/X-Amz-Signature/);
    // Only the credential REFERENCE name is present, not a token value.
    expect(json).not.toContain('cf-account-secret');
  });
});

// ── Dry-run plan (side-effect free) ──────────────────────────────────────

describe('M9 dry-run plan — describes what a future deploy WOULD do (no API call)', () => {
  it('returns wouldCreatePagesProject / wouldConnectGitRepo without deploying', async () => {
    const t = fullTarget();
    const plan = computeCloudflarePagesDryRun({ target: t });
    expect(plan.mode).toBe('dry_run');
    expect(plan.wouldCreatePagesProject).toBe(true);
    expect(plan.wouldConnectGitRepo).toBe(true);
    // Back-compat aliases still present.
    expect(plan.wouldCreateProject).toBe(true);
    expect(plan.wouldConnectRepo).toBe(true);
    expect(plan.liveDeployEnabled).toBe(false);
    expect(plan.liveDnsMutationEnabled).toBe(false);
    expect(plan.buildCommand).toBe(DEFAULT_BUILD_COMMAND);
    expect(plan.outputDirectory).toBe(REQUIRED_OUTPUT_DIRECTORY);
    expect(plan.cloudflarePagesProjectName).toBe('tombstone-m5c-validation');
  });

  it('default early preview uses .pages.dev — no custom domain / no CNAME', async () => {
    const plan = computeCloudflarePagesDryRun({ target: fullTarget({ customDomain: null, dnsMode: 'none' }) });
    expect(plan.dnsMode).toBe('none');
    expect(plan.wouldAddCustomDomain).toBe(false);
    expect(plan.wouldCreateCnameRecord).toBe(false);
    expect(plan.cnameName).toBeNull();
    expect(plan.cnameTarget).toBeNull();
    expect(plan.pagesDevHost).toBe('tombstone-m5c-validation.pages.dev');
  });

  it('branded subdomain models its own custom domain + CNAME -> pages target', async () => {
    const t = fullTarget({
      customDomain: 'preview-rjs-auto.launchmarketing.com',
      previewSubdomain: 'preview-rjs-auto.launchmarketing.com',
      dnsMode: 'subdomain',
    });
    const plan = computeCloudflarePagesDryRun({ target: t });
    expect(plan.dnsMode).toBe('subdomain');
    expect(plan.wouldAddCustomDomain).toBe(true);
    expect(plan.wouldCreateCnameRecord).toBe(true);
    expect(plan.cnameName).toBe('preview-rjs-auto.launchmarketing.com');
    expect(plan.cnameTarget).toBe('tombstone-m5c-validation.pages.dev');
    expect(plan.liveDnsMutationEnabled).toBe(false);
  });

  it('an explicit cnameTarget overrides the default pages.dev target', async () => {
    const t = fullTarget({
      customDomain: 'preview-stonehouse.launchmarketing.com',
      cnameTarget: 'custom-target.pages.dev',
      dnsMode: 'subdomain',
    });
    const plan = computeCloudflarePagesDryRun({ target: t });
    expect(plan.cnameTarget).toBe('custom-target.pages.dev');
  });

  it('apex custom domain would add a custom domain but not a CNAME record', async () => {
    const t = fullTarget({ customDomain: 'launchmarketing.com', dnsMode: 'apex' });
    const plan = computeCloudflarePagesDryRun({ target: t });
    expect(plan.dnsMode).toBe('apex');
    expect(plan.wouldAddCustomDomain).toBe(true);
    expect(plan.wouldCreateCnameRecord).toBe(false);
  });

  it('the dry-run note affirms no API call / no DNS change / no deploy', async () => {
    const plan = computeCloudflarePagesDryRun({ target: fullTarget() });
    expect(plan.note).toMatch(/no Cloudflare API call/i);
    expect(plan.note).toMatch(/no DNS change/i);
    expect(plan.note).toMatch(/no deployment/i);
  });
});

// ── Custom-domain readiness (5-point branded-subdomain contract) ─────────

describe('M9 custom-domain readiness', () => {
  it('classifies subdomain vs apex vs none', () => {
    expect(classifyCustomDomain('preview-x.launchmarketing.com', null)).toBe('subdomain');
    expect(classifyCustomDomain('launchmarketing.com', null)).toBe('apex');
    expect(classifyCustomDomain(null, null)).toBe('none');
    // explicit dnsMode wins
    expect(classifyCustomDomain('launchmarketing.com', 'subdomain')).toBe('subdomain');
    expect(classifyCustomDomain('x.launchmarketing.com', 'none')).toBe('none');
  });

  it('branded subdomain readiness lists the 5 explicit requirements', async () => {
    const res = evaluateCloudflareReadiness(await ctx({
      target: fullTarget({ customDomain: 'preview-west-houston-auto.launchmarketing.com', dnsMode: 'subdomain' }),
    }));
    expect(res.customDomain.mode).toBe('subdomain');
    expect(res.customDomain.requirements.length).toBe(5);
    expect(res.customDomain.cnameName).toBe('preview-west-houston-auto.launchmarketing.com');
    expect(res.customDomain.cnameTarget).toBe('tombstone-m5c-validation.pages.dev');
    expect(res.customDomain.liveDnsMutationEnabled).toBe(false);
    const joined = res.customDomain.requirements.join(' ');
    expect(joined).toMatch(/Pages project/i);
    expect(joined).toMatch(/custom domain/i);
    expect(joined).toMatch(/CNAME/i);
    expect(joined).toMatch(/No DNS mutation/i);
  });

  it('no custom domain -> pages.dev default note, no CNAME', async () => {
    const res = evaluateCloudflareReadiness(await ctx({ target: fullTarget({ customDomain: null, dnsMode: 'none' }) }));
    expect(res.customDomain.mode).toBe('none');
    expect(res.customDomain.cnameName).toBeNull();
    expect(res.customDomain.notes.join(' ')).toMatch(/pages\.dev/i);
    expect(res.customDomain.notes.join(' ')).toMatch(/No custom CNAME/i);
  });

  it('does NOT model wildcard DNS or path-based routing', async () => {
    const res = evaluateCloudflareReadiness(await ctx({
      target: fullTarget({ customDomain: 'preview-rjs-auto.launchmarketing.com', dnsMode: 'subdomain' }),
    }));
    // The MODELED values must not use wildcard DNS or path-based routing.
    const cd = res.customDomain;
    expect(cd.cnameName || '').not.toMatch(/\*/); // no wildcard host
    expect(cd.cnameName || '').not.toMatch(/\//); // no path segment
    expect(cd.cnameTarget || '').not.toMatch(/\//); // target is a host, not a path
    expect(cd.customDomain || '').not.toMatch(/\//); // one subdomain, not slug routing
    // The disclaimer note explicitly rejects the path-routing pattern.
    expect(cd.notes.join(' ')).toMatch(/customer-slug path routing/i);
  });
});

// ── Resolvers + checklist ────────────────────────────────────────────────

describe('M9 resolvers + manual setup checklist', () => {
  it('resolves repo url / branch / cname helpers', () => {
    const t = fullTarget({ customDomain: 'preview-x.launchmarketing.com', dnsMode: 'subdomain' });
    expect(resolveRepoUrl(t)).toBe('gh:' + 'example-org/tombstone-m5c');
    expect(resolveBranch(t)).toBe('main');
    expect(resolvePagesDevHost(t)).toBe('tombstone-m5c-validation.pages.dev');
    expect(resolveCnameName(t)).toBe('preview-x.launchmarketing.com');
    expect(resolveCnameTarget(t)).toBe('tombstone-m5c-validation.pages.dev');
  });

  it('checklist covers pages.dev-first + one-subdomain-per-site + CNAME', () => {
    const steps = getManualSetupChecklist();
    expect(steps.length).toBeGreaterThanOrEqual(12);
    const text = steps.map((s) => `${s.title} ${s.detail}`).join(' ');
    expect(text).toMatch(/pages\.dev/i);
    expect(text).toMatch(/CNAME/i);
    expect(text).toMatch(new RegExp(REQUIRED_OUTPUT_DIRECTORY));
    expect(text).toMatch(/production branch/i);
    // Never NEXT_PUBLIC secrets guidance present.
    expect(text).toMatch(/never put secrets/i);
  });

  it('expected public env vars are the 4 NEXT_PUBLIC_* keys', () => {
    expect([...EXPECTED_PUBLIC_ENV_VARS].sort()).toEqual(
      ['NEXT_PUBLIC_GA_MEASUREMENT_ID', 'NEXT_PUBLIC_GHL_FORM_ID', 'NEXT_PUBLIC_GHL_LOCATION_ID', 'NEXT_PUBLIC_SITE_URL'].sort(),
    );
  });
});

// ── Structural invariants over M9 source (routes / UI / lib) ─────────────

const LIB_SRC = fs.readFileSync(path.join('lib', 'site-deploy', 'cloudflare-readiness.ts'), 'utf8');
const ORCH_SRC = fs.readFileSync(path.join('lib', 'site-deploy', 'cloudflare-orchestrator.ts'), 'utf8');
const CARD_SRC = fs.readFileSync(path.join('app', 'dashboard', 'website', '_components', 'deployment-settings-card.tsx'), 'utf8');
const ROUTE_DIR = path.join('app', 'api', 'businesses', '[id]', 'site-deployment-targets', '[targetId]');
const READINESS_ROUTE = fs.readFileSync(path.join(ROUTE_DIR, 'cloudflare-readiness', 'route.ts'), 'utf8');
const DRYRUN_ROUTE = fs.readFileSync(path.join(ROUTE_DIR, 'cloudflare-dry-run', 'route.ts'), 'utf8');

describe('M9 route structure — auth + business scoping', () => {
  it('both routes require a session and business access', () => {
    for (const src of [READINESS_ROUTE, DRYRUN_ROUTE]) {
      expect(src).toContain('getServerSession');
      expect(src).toContain('resolveBusinessAccess');
      expect(src).toContain('401');
      expect(src).toContain('403');
      expect(src).toContain('404');
      expect(src).toContain("dynamic = 'force-dynamic'");
    }
  });

  it('the dry-run route hard-rejects deploy-intent bodies', () => {
    expect(DRYRUN_ROUTE).toContain('DEPLOY_INTENT_FIELDS');
    expect(DRYRUN_ROUTE).toMatch(/deploy/);
    expect(DRYRUN_ROUTE).toMatch(/publish/);
    expect(DRYRUN_ROUTE).toContain('400');
  });

  it('the orchestrator scopes the target lookup by businessId', () => {
    expect(ORCH_SRC).toContain('findFirst');
    expect(ORCH_SRC).toMatch(/businessId:\s*opts\.businessId/);
  });
});

describe('M9 no live deploy / no CF API / no DNS mutation', () => {
  it('the lib never imports an http client or calls the Cloudflare API', () => {
    expect(LIB_SRC).not.toMatch(/\bfetch\s*\(/);
    expect(LIB_SRC).not.toMatch(/axios/);
    expect(LIB_SRC).not.toMatch(/api\.cloudflare\.com/);
    expect(ORCH_SRC).not.toMatch(/api\.cloudflare\.com/);
  });

  it('the orchestrator never calls the Cloudflare API or mutates DNS', () => {
    expect(ORCH_SRC).not.toMatch(/api\.cloudflare\.com/);
    // No write to the Cloudflare DNS/Pages endpoints.
    expect(ORCH_SRC).not.toMatch(/dns_records/);
    expect(ORCH_SRC).not.toMatch(/pages\/projects/);
  });

  it('liveDeployEnabled + liveDnsMutationEnabled are hard-coded false', () => {
    expect(LIB_SRC).toContain('liveDeployEnabled: false');
    expect(LIB_SRC).toContain('liveDnsMutationEnabled: false');
    expect(ORCH_SRC).toContain('liveDeployEnabled: false');
  });
});

describe('M9 UI — strategic ordering + fields + disabled deploy', () => {
  it('lists Cloudflare Pages as strategic/recommended first', () => {
    const cfIdx = CARD_SRC.indexOf("value: 'cloudflare_pages'");
    const hgIdx = CARD_SRC.indexOf("value: 'hostgator_static'");
    expect(cfIdx).toBeGreaterThan(-1);
    expect(cfIdx).toBeLessThan(hgIdx);
    expect(CARD_SRC).toMatch(/strategic/i);
    expect(CARD_SRC).toMatch(/transitional/i);
    expect(CARD_SRC).toMatch(/optional/i);
    expect(CARD_SRC).toMatch(/future/i);
  });

  it('renders the CF config fields + readiness + dry-run + checklist', () => {
    expect(CARD_SRC).toContain('cloudflareAccountId');
    expect(CARD_SRC).toContain('cloudflareProjectName');
    expect(CARD_SRC).toContain('githubRepoUrl');
    expect(CARD_SRC).toContain('previewSubdomain');
    expect(CARD_SRC).toContain('customDomain');
    expect(CARD_SRC).toContain('dnsMode');
    expect(CARD_SRC).toContain('cloudflare-readiness');
    expect(CARD_SRC).toContain('wouldCreatePagesProject');
    expect(CARD_SRC).toContain('wouldCreateCnameRecord');
    expect(CARD_SRC).toMatch(/checklist/i);
  });

  it('shows a disabled Cloudflare deploy button labelled for a future milestone', () => {
    expect(CARD_SRC).toContain('Cloudflare deployment disabled — future milestone');
    expect(CARD_SRC).toMatch(/disabled/);
  });

  it('adds "verified" as a selectable status', () => {
    expect(CARD_SRC).toMatch(/'verified'/);
  });
});
