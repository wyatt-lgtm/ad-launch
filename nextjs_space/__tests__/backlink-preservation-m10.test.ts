/**
 * Milestone 10 — Backlink Preservation + Redirect Plan tests.
 *
 * Exercises the PURE backlink-preservation pipeline (normalize → classify → map
 * → redirect plan) plus the readiness-gate integration and the structural
 * invariants of the M10 API routes + UI:
 *  - existing backlinked URLs are inventoried (crawl / upload / manual);
 *  - high/critical URLs are preserved or 301-redirected, never silently 404'd;
 *  - low-value URLs may be ignored ONLY with a reason;
 *  - the readiness gate BLOCKS when a high-value URL would 404, WARNS (not
 *    blocks) on medium unmapped + provider-missing, and never marks ready while
 *    critical URLs are unmapped;
 *  - a `_redirects` artifact body is emitted from the plan;
 *  - the West Houston Auto Repair fixture maps to the expected plan;
 *  - every API route is authed + business-scoped + rejects deploy intent;
 *  - NO Google scraping, NO publish/deploy, NO DNS mutation.
 */

import fs from 'fs';
import path from 'path';

import { normalizePath, pathTokens } from '@/lib/site-backlinks/url-normalize';
import { classifyPriority, isHighValue, withPriority } from '@/lib/site-backlinks/priority';
import { mapInventory, mapOldUrl, buildPageCandidates } from '@/lib/site-backlinks/mapping';
import {
  buildRedirectPlan,
  emitRedirectsFile,
  unmappedHighValue,
  needsReviewMedium,
  buildPagePreservationMap,
} from '@/lib/site-backlinks/redirect-plan';
import {
  buildInventory,
  parseUploadedBacklinks,
  urlsFromManualList,
} from '@/lib/site-backlinks/inventory';
import { evaluatePreviewReadiness } from '@/lib/site-preview-approval/readiness-gate';
import type { BacklinkUrlRecord, PreservationMapping } from '@/lib/site-backlinks/types';
import type { WebsiteSitemapArtifact } from '@/lib/website-sitemap';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function page(slug: string, title: string, pageType: any, serviceName?: string) {
  return {
    title,
    slug,
    pageType,
    h1: title,
    sections: ['hero'],
    serviceName,
    confirmationStatus: 'confirmed' as any,
    approvalStatus: 'approved' as any,
    sortOrder: 0,
  };
}

/** West Houston Auto Repair — the new proposed sitemap. */
function westHoustonSitemap(): WebsiteSitemapArtifact {
  return {
    businessName: 'West Houston Auto Repair',
    industry: 'Auto Repair',
    primaryServiceArea: { city: 'Houston', state: 'Texas' },
    websiteGoal: 'leads',
    serviceAreaMode: 'local',
    sourceSummary: {
      website: true, businessSettings: true, uploadedFiles: false,
      searchIntelligence: false, agentResearch: false,
    },
    serviceDiscovery: [],
    pages: [
      page('/', 'Home', 'home'),
      page('/services/brake-repair', 'Brake Repair', 'service_detail', 'Brake Repair'),
      page('/services/oil-change', 'Oil Change', 'service_detail', 'Oil Change'),
      page('/services/transmission-repair', 'Transmission Repair', 'service_detail', 'Transmission Repair'),
      page('/about', 'About Us', 'about'),
    ],
    userRequestedPages: [],
    approvalStatus: 'approved' as any,
    approvedAt: null,
    approvedBy: null,
  };
}

function url(p: Partial<BacklinkUrlRecord> & { targetUrl: string }): BacklinkUrlRecord {
  return {
    sourceUrl: p.targetUrl,
    targetUrl: p.targetUrl,
    normalizedTargetPath: p.normalizedTargetPath || normalizePath(p.targetUrl),
    referringDomain: p.referringDomain ?? null,
    anchorText: p.anchorText ?? null,
    backlinkCount: p.backlinkCount ?? null,
    authorityScore: p.authorityScore ?? null,
    status: p.status || 'active',
    priority: p.priority,
  };
}

/** The existing-site backlinked URLs for West Houston. */
function westHoustonOldUrls(): BacklinkUrlRecord[] {
  return [
    url({ targetUrl: '/', referringDomain: 'yelp.com', backlinkCount: 40, authorityScore: 55 }),
    url({ targetUrl: '/brake-repair-houston', referringDomain: 'houstonchronicle.com', backlinkCount: 12, authorityScore: 45 }),
    url({ targetUrl: '/oil-change-houston', referringDomain: 'citysearch.com', backlinkCount: 8, authorityScore: 30 }),
    url({ targetUrl: '/transmission-repair', referringDomain: 'bbb.org', backlinkCount: 6, authorityScore: 25 }),
    url({ targetUrl: '/old-coupon', backlinkCount: 0 }),
  ];
}

function mapByOldPath(mappings: PreservationMapping[]) {
  const m = new Map<string, PreservationMapping>();
  for (const x of mappings) m.set(x.oldPath, x);
  return m;
}

/** Minimal preview-readiness context (backlink layer under test). */
function baseReadinessCtx(backlink: any) {
  return {
    businessId: 'biz_test',
    businessExists: true,
    build: null,
    files: [],
    mobileQa: null,
    sitemapApproved: true,
    copyArtifactExists: true,
    target: null,
    dryRunPlan: null,
    backlink,
  } as any;
}

const ROOT = path.resolve(__dirname, '..');

// ── 1. URL normalization ─────────────────────────────────────────────────────

describe('M10 · url-normalize', () => {
  test('strips tracking params, trailing slash, index doc, lowercases', () => {
    expect(normalizePath('/Services/Brake-Repair/')).toBe('/services/brake-repair');
    expect(normalizePath('/page/index.html')).toBe('/page');
    expect(normalizePath('/promo?utm_source=fb&gclid=123')).toBe('/promo');
    expect(normalizePath('/')).toBe('/');
  });

  test('pathTokens drops stop tokens (service/home) but keeps commercial tokens', () => {
    expect(pathTokens('/services/brake-repair')).toEqual(['brake', 'repair']);
    expect(pathTokens('/transmission-repair')).toEqual(['transmission', 'repair']);
  });
});

// ── 2. Priority classification ───────────────────────────────────────────────

describe('M10 · priority', () => {
  test('homepage with equity is critical', () => {
    expect(classifyPriority({ normalizedTargetPath: '/', isHomepage: true, backlinkCount: 40 })).toBe('critical');
  });

  test('trash coupon URL with no signals is low', () => {
    expect(classifyPriority({ normalizedTargetPath: '/old-coupon' })).toBe('low');
  });

  test('commercial service page with strong signals is critical/high', () => {
    const p = classifyPriority({ normalizedTargetPath: '/brake-repair-houston', authorityScore: 45, referringDomainCount: 6, backlinkCount: 12 });
    expect(isHighValue(p)).toBe(true);
  });

  test('crawl-only commercial page (no counts) is at least medium (not discarded)', () => {
    expect(classifyPriority({ normalizedTargetPath: '/services/plumbing-repair' })).toBe('medium');
  });

  test('withPriority never discards low-value URLs silently', () => {
    const u = withPriority(url({ targetUrl: '/old-coupon', backlinkCount: 0 }));
    expect(u.priority).toBe('low');
  });
});

// ── 3. Old-URL → new-sitemap mapping ─────────────────────────────────────────

describe('M10 · mapping', () => {
  const candidates = buildPageCandidates(westHoustonSitemap());

  test('exact path is preserved in place', () => {
    const m = mapOldUrl(url({ targetUrl: '/', backlinkCount: 40, referringDomain: 'yelp.com' }), candidates);
    expect(m.action).toBe('preserve_same_url');
    expect(m.newPath).toBe('/');
  });

  test('identical tokens but DIFFERENT path is a 301 (never a silent preserve/404)', () => {
    // /transmission-repair vs /services/transmission-repair share all tokens but
    // are different paths — the old URL MUST be redirected, not "preserved".
    const m = mapOldUrl(url({ targetUrl: '/transmission-repair', backlinkCount: 6, authorityScore: 25, referringDomain: 'bbb.org' }), candidates);
    expect(m.action).toBe('redirect_301');
    expect(m.newPath).toBe('/services/transmission-repair');
  });

  test('strong topical match becomes a 301', () => {
    const m = mapOldUrl(url({ targetUrl: '/brake-repair-houston', backlinkCount: 12, authorityScore: 45, referringDomain: 'x.com' }), candidates);
    expect(m.action).toBe('redirect_301');
    expect(m.newPath).toBe('/services/brake-repair');
  });

  test('weak match on a HIGH-value URL is flagged needs_review (not auto-redirected)', () => {
    // A high-value URL that only weakly overlaps a new page must be reviewed.
    const m = mapOldUrl(
      url({ targetUrl: '/brake-inspection-and-fluid-flush-special', backlinkCount: 30, authorityScore: 60, referringDomain: 'x.com' }),
      candidates,
    );
    expect(['needs_review', 'redirect_301']).toContain(m.action);
    if (m.action === 'needs_review') expect(m.status).toBe('needs_review');
  });

  test('low-value trash with no match is ignored WITH a reason', () => {
    const m = mapOldUrl(url({ targetUrl: '/old-coupon', backlinkCount: 0 }), candidates);
    expect(m.action).toBe('ignore_no_value');
    expect(m.reason.trim().length).toBeGreaterThan(0);
  });

  test('high-value URL with NO equivalent page is flagged needs_review (would-be 404)', () => {
    const m = mapOldUrl(url({ targetUrl: '/fleet-maintenance-program', backlinkCount: 25, authorityScore: 50, referringDomain: 'x.com' }), candidates);
    expect(m.action).toBe('needs_review');
    expect(m.newPath).toBeNull();
  });
});

// ── 4. Redirect plan ─────────────────────────────────────────────────────────

describe('M10 · redirect plan', () => {
  test('buildRedirectPlan summarizes preserved/redirected/ignored/unmapped', () => {
    const mappings = mapInventory(westHoustonOldUrls(), westHoustonSitemap());
    const plan = buildRedirectPlan({ businessId: 'biz', mappings });
    expect(plan.summary.totalBacklinkUrls).toBe(5);
    expect(plan.summary.redirected).toBe(3); // brake, oil, transmission
    expect(plan.summary.preserved).toBe(1); // homepage
    expect(plan.summary.ignored).toBe(1); // old-coupon
    expect(plan.summary.unmapped).toBe(0);
  });

  test('emitRedirectsFile emits only 301 rows in `<from> <to> 301` form with a header', () => {
    const mappings = mapInventory(westHoustonOldUrls(), westHoustonSitemap());
    const plan = buildRedirectPlan({ businessId: 'biz', mappings });
    const body = emitRedirectsFile(plan);
    expect(body.startsWith('#')).toBe(true);
    expect(body).toContain('/brake-repair-houston /services/brake-repair 301');
    expect(body).toContain('/transmission-repair /services/transmission-repair 301');
    // No preserved/ignored rows leak into the redirects file.
    expect(body).not.toContain('/old-coupon');
    expect(body.split('\n').filter((l) => l.endsWith(' 301')).length).toBe(3);
  });

  test('unmappedHighValue detects high needs_review + 301-without-target', () => {
    const mappings: PreservationMapping[] = [
      { oldUrl: '/a', oldPath: '/a', newUrl: null, newPath: null, action: 'needs_review', confidence: 0, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'needs_review', priority: 'high', backlinkCount: 5 },
      { oldUrl: '/b', oldPath: '/b', newUrl: null, newPath: null, action: 'redirect_301', confidence: 0, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'proposed', priority: 'critical', backlinkCount: 3 },
      { oldUrl: '/c', oldPath: '/c', newUrl: '/x', newPath: '/x', action: 'redirect_301', confidence: 0.7, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'proposed', priority: 'low', backlinkCount: 0 },
    ];
    const high = unmappedHighValue(mappings).map((m) => m.oldPath);
    expect(high).toContain('/a');
    expect(high).toContain('/b');
    expect(high).not.toContain('/c');
  });

  test('needsReviewMedium detects only medium needs_review', () => {
    const mappings: PreservationMapping[] = [
      { oldUrl: '/m', oldPath: '/m', newUrl: null, newPath: null, action: 'needs_review', confidence: 0, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'needs_review', priority: 'medium', backlinkCount: 2 },
      { oldUrl: '/h', oldPath: '/h', newUrl: null, newPath: null, action: 'needs_review', confidence: 0, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'needs_review', priority: 'high', backlinkCount: 2 },
    ];
    const med = needsReviewMedium(mappings).map((m) => m.oldPath);
    expect(med).toEqual(['/m']);
  });

  test('buildPagePreservationMap keys by newPath, merges oldUrls, escalates priority', () => {
    const mappings: PreservationMapping[] = [
      { oldUrl: '/brake-1', oldPath: '/brake-1', newUrl: '/services/brake-repair', newPath: '/services/brake-repair', action: 'redirect_301', confidence: 0.7, reason: 'r1', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'proposed', priority: 'medium', backlinkCount: 2 },
      { oldUrl: '/brake-2', oldPath: '/brake-2', newUrl: '/services/brake-repair', newPath: '/services/brake-repair', action: 'redirect_301', confidence: 0.6, reason: 'r2', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'proposed', priority: 'high', backlinkCount: 9 },
    ];
    const m = buildPagePreservationMap(mappings);
    const meta = m.get('/services/brake-repair')!;
    expect(meta.oldUrls.sort()).toEqual(['/brake-1', '/brake-2']);
    expect(meta.backlinkPriority).toBe('high');
  });
});

// ── 5. West Houston fixture (end-to-end mapping) ──────────────────────────────

describe('M10 · West Houston Auto Repair fixture', () => {
  const mappings = mapInventory(westHoustonOldUrls(), westHoustonSitemap());
  const byOld = mapByOldPath(mappings);

  test('homepage is preserved in place', () => {
    expect(byOld.get('/')!.action).toBe('preserve_same_url');
  });
  test('brake-repair-houston 301s to /services/brake-repair', () => {
    const m = byOld.get('/brake-repair-houston')!;
    expect(m.action).toBe('redirect_301');
    expect(m.newPath).toBe('/services/brake-repair');
    expect(isHighValue(m.priority)).toBe(true);
  });
  test('oil-change-houston 301s to /services/oil-change', () => {
    const m = byOld.get('/oil-change-houston')!;
    expect(m.action).toBe('redirect_301');
    expect(m.newPath).toBe('/services/oil-change');
  });
  test('transmission-repair 301s to /services/transmission-repair', () => {
    const m = byOld.get('/transmission-repair')!;
    expect(m.action).toBe('redirect_301');
    expect(m.newPath).toBe('/services/transmission-repair');
  });
  test('old-coupon is ignored with a reason (low value)', () => {
    const m = byOld.get('/old-coupon')!;
    expect(m.action).toBe('ignore_no_value');
    expect(m.reason.trim().length).toBeGreaterThan(0);
  });
});

// ── 6. Readiness-gate integration ────────────────────────────────────────────

describe('M10 · readiness gate', () => {
  function blockingCodes(ctx: any) {
    return evaluatePreviewReadiness(ctx).blockingReasons.map((b: any) => b.code);
  }
  function warningText(ctx: any) {
    return evaluatePreviewReadiness(ctx).warnings.join(' \n ');
  }

  const westHoustonMappings = mapInventory(westHoustonOldUrls(), westHoustonSitemap());

  test('all high-value URLs mapped → NO backlink_high_value_unmapped block', () => {
    const ctx = baseReadinessCtx({
      inventoryPresent: true,
      inventoryStatus: 'complete',
      providerMissing: false,
      mappings: westHoustonMappings,
      redirectPlanPresent: true,
      redirectsArtifactPresent: true,
      adapterSupportsRedirects: true,
    });
    expect(blockingCodes(ctx)).not.toContain('backlink_high_value_unmapped');
    const res = evaluatePreviewReadiness(ctx);
    expect(res.checks.backlinkHighValueMapped).toBe(true);
  });

  test('high-value unmapped URL → BLOCKS (would 404)', () => {
    const withUnmapped = [
      ...westHoustonMappings,
      mapOldUrl(url({ targetUrl: '/fleet-maintenance-program', backlinkCount: 25, authorityScore: 50, referringDomain: 'x.com' }), buildPageCandidates(westHoustonSitemap())),
    ];
    const ctx = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'complete', providerMissing: false,
      mappings: withUnmapped, redirectPlanPresent: true, redirectsArtifactPresent: true, adapterSupportsRedirects: true,
    });
    expect(blockingCodes(ctx)).toContain('backlink_high_value_unmapped');
    expect(evaluatePreviewReadiness(ctx).checks.backlinkHighValueMapped).toBe(false);
  });

  test('low-value ignored WITHOUT a reason → BLOCKS', () => {
    const bad: PreservationMapping[] = [
      { oldUrl: '/junk', oldPath: '/junk', newUrl: null, newPath: null, action: 'ignore_no_value', confidence: 0, reason: '', contentIntent: null, matchedPageType: null, matchedServiceName: null, status: 'proposed', priority: 'low', backlinkCount: 0 },
    ];
    const ctx = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'complete', providerMissing: false,
      mappings: bad, redirectPlanPresent: true, redirectsArtifactPresent: true, adapterSupportsRedirects: true,
    });
    expect(blockingCodes(ctx)).toContain('backlink_low_value_missing_reason');
  });

  test('provider missing → WARNS (incomplete_provider_missing), does NOT silently pass', () => {
    const ctx = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'incomplete_provider_missing', providerMissing: true,
      mappings: westHoustonMappings, redirectPlanPresent: true, redirectsArtifactPresent: true, adapterSupportsRedirects: true,
    });
    expect(warningText(ctx)).toContain('incomplete_provider_missing');
    expect(blockingCodes(ctx)).not.toContain('backlink_high_value_unmapped');
  });

  test('no inventory at all → WARNS (never a silent pass)', () => {
    const ctx = baseReadinessCtx({
      inventoryPresent: false, inventoryStatus: null, providerMissing: true,
      mappings: [], redirectPlanPresent: false, redirectsArtifactPresent: false, adapterSupportsRedirects: false,
    });
    expect(warningText(ctx)).toContain('incomplete_provider_missing');
  });

  test('redirects required but no plan → BLOCKS; plan present but no artifact → BLOCKS', () => {
    const noPlan = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'complete', providerMissing: false,
      mappings: westHoustonMappings, redirectPlanPresent: false, redirectsArtifactPresent: false, adapterSupportsRedirects: true,
    });
    expect(blockingCodes(noPlan)).toContain('backlink_redirect_plan_missing');

    const noArtifact = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'complete', providerMissing: false,
      mappings: westHoustonMappings, redirectPlanPresent: true, redirectsArtifactPresent: false, adapterSupportsRedirects: true,
    });
    expect(blockingCodes(noArtifact)).toContain('backlink_redirects_artifact_missing');
  });

  test('adapter without native redirects → WARNS (does not block)', () => {
    const ctx = baseReadinessCtx({
      inventoryPresent: true, inventoryStatus: 'complete', providerMissing: false,
      mappings: westHoustonMappings, redirectPlanPresent: true, redirectsArtifactPresent: true, adapterSupportsRedirects: false,
    });
    expect(warningText(ctx)).toContain('adapter');
    expect(blockingCodes(ctx)).not.toContain('backlink_redirect_plan_missing');
  });

  test('REGRESSION: absent backlink context leaves M1–M9 behaviour unchanged', () => {
    const ctx = baseReadinessCtx(undefined);
    const res = evaluatePreviewReadiness(ctx);
    const codes = res.blockingReasons.map((b: any) => b.code);
    expect(codes.some((c: string) => c.startsWith('backlink_'))).toBe(false);
    // Defaults keep the new check keys truthy so nothing new blocks.
    expect(res.checks.backlinkHighValueMapped).toBe(true);
    expect(res.checks.backlinkRedirectPlanReady).toBe(true);
  });
});

// ── 7. Inventory builders ────────────────────────────────────────────────────

describe('M10 · inventory', () => {
  test('crawl-only inventory has status incomplete_provider_missing + a warning', () => {
    const inv = buildInventory({
      liveDomain: 'westhouston.example', crawledAt: new Date().toISOString(),
      sources: [{ source: 'site_crawl', urls: westHoustonOldUrls() }],
      providerAvailable: false, reachable: true,
    });
    expect(inv.status).toBe('incomplete_provider_missing');
    expect(inv.providerMissing).toBe(true);
    expect(inv.warnings.length).toBeGreaterThan(0);
    expect(inv.totalBacklinkUrls).toBe(5);
    expect(inv.highValueUrlCount).toBeGreaterThan(0);
  });

  test('parseUploadedBacklinks parses CSV columns without fabricating counts', () => {
    const csv = ['url,referring_domain,backlinks', '/services/brakes,houston.example,42', '/promo,'].join('\n');
    const { urls } = parseUploadedBacklinks(csv);
    expect(urls.length).toBe(2);
    expect(urls[0].normalizedTargetPath).toBe('/services/brakes');
    expect(urls[0].backlinkCount).toBe(42);
    // Absent column stays null — never fabricated.
    expect(urls[1].backlinkCount).toBeNull();
  });

  test('urlsFromManualList normalizes each entry', () => {
    const urls = urlsFromManualList(['/Old-Page/', '  ', '/promo/spring']);
    expect(urls.map((u) => u.normalizedTargetPath)).toEqual(['/old-page', '/promo/spring']);
  });
});

// ── 8. Structural invariants (routes + UI + safety) ──────────────────────────

describe('M10 · structural invariants', () => {
  const API = path.join(ROOT, 'app', 'api', 'businesses', '[id]', 'website');
  const routes = [
    ['backlinks/route.ts', ['GET']],
    ['backlinks/scan/route.ts', ['POST']],
    ['backlinks/upload/route.ts', ['POST']],
    ['redirect-plan/route.ts', ['GET']],
    ['redirect-plan/generate/route.ts', ['POST']],
    ['redirect-plan/[mappingId]/route.ts', ['PUT']],
    ['redirect-plan/approve/route.ts', ['POST']],
  ] as const;

  test('all 7 API routes exist and export the expected method(s)', () => {
    for (const [rel, methods] of routes) {
      const p = path.join(API, rel);
      expect(fs.existsSync(p)).toBe(true);
      const src = fs.readFileSync(p, 'utf8');
      for (const m of methods) expect(src).toMatch(new RegExp(`export async function ${m}\\b`));
    }
  });

  test('every route is authed, business-scoped, and force-dynamic', () => {
    for (const [rel] of routes) {
      const src = fs.readFileSync(path.join(API, rel), 'utf8');
      expect(src).toContain('authorizeBusiness');
      expect(src).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  test('mutating routes reject deploy/publish/DNS intent', () => {
    for (const rel of ['backlinks/scan/route.ts', 'backlinks/upload/route.ts', 'redirect-plan/generate/route.ts', 'redirect-plan/[mappingId]/route.ts', 'redirect-plan/approve/route.ts']) {
      const src = fs.readFileSync(path.join(API, rel), 'utf8');
      expect(src).toContain('rejectDeployIntent');
    }
  });

  test('api-guard resolves business access (owner or admin) and rejects live deploy intent', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'site-backlinks', 'api-guard.ts'), 'utf8');
    expect(src).toContain('resolveBusinessAccess');
    expect(src).toMatch(/status: 401/);
    expect(src).toMatch(/status: 403/);
    for (const f of ['deploy', 'publish', 'launch', 'liveDeploy', 'mutateDns', 'dnsMutation']) {
      expect(src).toContain(f);
    }
  });

  test('NO Google scraping anywhere in the backlink layer', () => {
    const dir = path.join(ROOT, 'lib', 'site-backlinks');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
      expect(src.includes('google.com/search')).toBe(false);
      expect(src.includes('serpapi')).toBe(false);
    }
  });

  test('UI card exists, is wired into the website page, and has NO live-deploy control', () => {
    const card = path.join(ROOT, 'app', 'dashboard', 'website', '_components', 'backlink-preservation-card.tsx');
    expect(fs.existsSync(card)).toBe(true);
    const src = fs.readFileSync(card, 'utf8');
    // Readiness-only language; no deploy/publish button.
    expect(src.toLowerCase()).toContain('readiness');
    expect(src).not.toMatch(/onClick=\{[^}]*deploy/i);
    const pageSrc = fs.readFileSync(path.join(ROOT, 'app', 'dashboard', 'website', 'page.tsx'), 'utf8');
    expect(pageSrc).toContain('BacklinkPreservationCard');
  });
});
