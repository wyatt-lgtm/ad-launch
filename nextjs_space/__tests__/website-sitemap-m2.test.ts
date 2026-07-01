/**
 * Milestone 2 — Service confirmation + Sitemap review/approval (pure logic + safety).
 *
 * Covers the pure editing/validation layer (lib/website-sitemap-edit.ts) and the
 * sitemap-first pure logic (lib/website-sitemap.ts) that the Milestone 2 API
 * routes delegate to, plus safety source-scans proving the milestone performs
 * NO copy generation, NO image generation, and NO publish/deploy, and does not
 * modify unrelated systems (WF3 SEO, Search Intelligence, social generation).
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  generateSitemap,
  approveSitemap,
  classifyService,
  classifyServices,
  addUserRequestedPage,
  canGenerateCopy,
  WebsiteSitemapArtifact,
  ServiceCandidate,
} from '@/lib/website-sitemap';
import {
  addComparisonPage,
  addLocationPage,
  removePage,
  renamePage,
  setServiceConfirmation,
  validateSitemapStructure,
  validateSitemapForApproval,
  canApproveSitemap,
  mapCopyGateStatus,
} from '@/lib/website-sitemap-edit';

const HOUSTON = { city: 'Houston', state: 'Texas' };

function westHouston(services: ServiceCandidate[]): WebsiteSitemapArtifact {
  return generateSitemap({
    businessName: 'West Houston Auto Repair',
    industry: 'Auto Repair',
    businessType: 'Auto Repair Shop',
    serviceCategoryLabel: 'Auto Repair',
    primaryServiceArea: HOUSTON,
    serviceAreaMode: 'local',
    services: classifyServices(services),
  });
}

function confirmedFixture(): WebsiteSitemapArtifact {
  return westHouston([
    { serviceName: 'Brake Repair', source: 'user', userSelected: true },
    { serviceName: 'Oil Change', source: 'user', userSelected: true },
  ]);
}

// ── Service discovery / classification ─────────────────────────────────────
describe('service confirmation classification (tests 8, 9)', () => {
  it('test 9 — rejected services never become pages', () => {
    const sitemap = westHouston([
      { serviceName: 'Brake Repair', source: 'user', userSelected: true },
      { serviceName: 'Transmission Rebuild', source: 'user', userRejected: true },
    ]);
    const slugs = sitemap.pages.map((p) => p.slug);
    expect(slugs).toContain('/services/brake-repair');
    expect(sitemap.pages.some((p) => /transmission/i.test(p.slug))).toBe(false);
  });

  it('test 8 — unconfirmed (likely) services cannot be approved as pages', () => {
    // A likely service is retained in discovery but produces no page.
    const sitemap = westHouston([
      { serviceName: 'Brake Repair', source: 'user', userSelected: true },
      { serviceName: 'AC Repair', source: 'industry_knowledge', commonForIndustry: true },
    ]);
    expect(sitemap.pages.some((p) => /ac-repair/i.test(p.slug))).toBe(false);

    // Force an unconfirmed detail page into the tree and confirm it blocks approval.
    const tampered: WebsiteSitemapArtifact = {
      ...sitemap,
      pages: [
        ...sitemap.pages,
        {
          title: 'AC Repair', slug: '/services/ac-repair', pageType: 'service_detail',
          parentSlug: '/services', serviceName: 'AC Repair', confirmationStatus: 'likely',
          h1: 'AC Repair in Houston, Texas', sections: ['Hero'],
          approvalStatus: 'pending_user_review', sortOrder: 99,
        },
      ],
    };
    const issues = validateSitemapStructure(tampered);
    expect(issues.some((i) => i.kind === 'unconfirmed_service_page')).toBe(true);
    expect(canApproveSitemap(tampered)).toBe(false);
  });

  it('setServiceConfirmation promotes a likely service to a confirmed page', () => {
    const sitemap = westHouston([
      { serviceName: 'Brake Repair', source: 'user', userSelected: true },
      { serviceName: 'AC Repair', source: 'industry_knowledge', commonForIndustry: true },
    ]);
    const next = setServiceConfirmation(sitemap, 'AC Repair', 'confirmed');
    expect(next.pages.some((p) => p.slug === '/services/ac-repair' && p.pageType === 'service_detail')).toBe(true);
    // Structural edit resets approval.
    expect(next.approvalStatus).toBe('pending_user_review');
  });
});

// ── User-requested pages (tests 5, 6, 7) ───────────────────────────────────
describe('user-requested pages', () => {
  it('test 7 — "Tombstone vs Tabloo" is NEVER in a freshly generated sitemap', () => {
    const sitemap = confirmedFixture();
    expect(sitemap.pages.some((p) => /tabloo/i.test(p.title) || /tabloo/i.test(p.slug))).toBe(false);
    expect(sitemap.userRequestedPages.length).toBe(0);
  });

  it('test 6 + 7 — requesting "Tombstone vs Tabloo" stores it correctly as a user_requested comparison page', () => {
    const { sitemap, revision } = addUserRequestedPage(confirmedFixture(), {
      title: 'Tombstone vs Tabloo', requestedByUserId: 'user-1',
    });
    const page = sitemap.pages.find((p) => p.title === 'Tombstone vs Tabloo');
    expect(page).toBeDefined();
    expect(page!.slug).toBe('/compare/tombstone-vs-tabloo');
    expect(page!.pageType).toBe('comparison');
    expect(page!.source).toBe('user_requested');
    expect(page!.status).toBe('added_by_user');
    expect(page!.requestedByUserId).toBe('user-1');
    // Recorded in userRequestedPages + produces a revision record.
    expect(sitemap.userRequestedPages.some((p) => p.slug === '/compare/tombstone-vs-tabloo')).toBe(true);
    expect(revision.action).toBe('add_page');
    expect(revision.page.slug).toBe('/compare/tombstone-vs-tabloo');
  });

  it('test 5 — adding a page resets approval so the revised sitemap must be re-reviewed', () => {
    const approved = approveSitemap(confirmedFixture(), 'user-1');
    expect(approved.approvalStatus).toBe('approved');
    const { sitemap } = addUserRequestedPage(approved, { title: 'Fleet Services', requestedByUserId: 'user-1' });
    expect(sitemap.approvalStatus).toBe('pending_user_review');
    expect(sitemap.approvedAt).toBeNull();
    expect(sitemap.approvedBy).toBeNull();
  });

  it('a user-requested page is not injected into an unrelated future site', () => {
    // A different business generated afresh has no comparison/user pages.
    const other = generateSitemap({
      businessName: 'Bayou City Plumbing', industry: 'Plumbing', primaryServiceArea: HOUSTON,
      services: classifyServices([{ serviceName: 'Drain Cleaning', source: 'user', userSelected: true }]),
    });
    expect(other.pages.some((p) => /tabloo/i.test(p.slug))).toBe(false);
    expect(other.userRequestedPages.length).toBe(0);
  });
});

// ── Structural editing ─────────────────────────────────────────────────────
describe('sitemap editing (pure, network-free)', () => {
  it('addComparisonPage / addLocationPage produce user_requested pages and reset approval', () => {
    const approved = approveSitemap(confirmedFixture(), 'user-1');
    const withCompare = addComparisonPage(approved, 'Us vs Them', { requestedByUserId: 'u1' });
    expect(withCompare.pages.some((p) => p.pageType === 'comparison')).toBe(true);
    expect(withCompare.approvalStatus).toBe('pending_user_review');

    const withLocation = addLocationPage(confirmedFixture(), { city: 'Katy', state: 'Texas', businessCategory: 'Auto Repair' });
    expect(withLocation.pages.some((p) => p.pageType === 'location')).toBe(true);
  });

  it('removePage and renamePage mutate only the target page', () => {
    const sitemap = confirmedFixture();
    const removed = removePage(sitemap, '/services/oil-change');
    expect(removed.pages.some((p) => p.slug === '/services/oil-change')).toBe(false);
    const renamed = renamePage(sitemap, '/services/brake-repair', 'Brake Service', { newH1: 'Brake Service in Houston, Texas' });
    expect(renamed.pages.find((p) => p.slug === '/services/brake-repair')!.title).toBe('Brake Service');
  });
});

// ── Validation + approval (tests 10, 11, 12) ───────────────────────────────
describe('validation and approval', () => {
  it('test 11 — a valid sitemap has no issues and can be approved', () => {
    const sitemap = confirmedFixture();
    expect(validateSitemapForApproval(sitemap)).toEqual([]);
    expect(canApproveSitemap(sitemap)).toBe(true);
  });

  it('test 10 — an invalid H1 blocks approval', () => {
    const sitemap = confirmedFixture();
    const tampered: WebsiteSitemapArtifact = {
      ...sitemap,
      pages: sitemap.pages.map((p) => p.pageType === 'service_detail' ? { ...p, h1: '' } : p),
    };
    const issues = validateSitemapForApproval(tampered);
    expect(issues.length).toBeGreaterThan(0);
    expect(canApproveSitemap(tampered)).toBe(false);
  });

  it('test 10 — duplicate slugs block approval', () => {
    const sitemap = confirmedFixture();
    const dup = sitemap.pages[sitemap.pages.length - 1];
    const tampered: WebsiteSitemapArtifact = { ...sitemap, pages: [...sitemap.pages, { ...dup }] };
    expect(validateSitemapForApproval(tampered).some((i) => i.kind === 'duplicate_slug')).toBe(true);
  });

  it('test 12 — approval records approvedAt + approvedBy and marks all pages approved', () => {
    const approved = approveSitemap(confirmedFixture(), 'user-42', '2026-06-30T12:00:00.000Z');
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvedBy).toBe('user-42');
    expect(approved.approvedAt).toBe('2026-06-30T12:00:00.000Z');
    expect(approved.pages.every((p) => p.approvalStatus === 'approved')).toBe(true);
  });
});

// ── Copy gate (tests 13, 14, 15) ───────────────────────────────────────────
describe('copy gate (display-only mapping)', () => {
  it('test 13 — blocks when there is no sitemap', () => {
    const gate = canGenerateCopy(null);
    expect(gate.allowed).toBe(false);
    expect(mapCopyGateStatus(gate.code)).toBe('blocked_missing_sitemap');
  });

  it('test 14 — blocks when the sitemap is not approved', () => {
    const gate = canGenerateCopy(confirmedFixture());
    expect(gate.allowed).toBe(false);
    expect(mapCopyGateStatus(gate.code)).toBe('blocked_sitemap_not_approved');
  });

  it('test 15 — allows when the sitemap is approved and valid', () => {
    const gate = canGenerateCopy(approveSitemap(confirmedFixture(), 'user-1'));
    expect(gate.allowed).toBe(true);
    expect(mapCopyGateStatus(gate.code)).toBe('allowed_after_sitemap_approval');
  });

  it('an approved-but-invalid sitemap maps to blocked_invalid_sitemap', () => {
    const approved = approveSitemap(confirmedFixture(), 'user-1');
    const tampered: WebsiteSitemapArtifact = {
      ...approved,
      pages: approved.pages.map((p) => p.pageType === 'service_detail' ? { ...p, h1: '' } : p),
    };
    const gate = canGenerateCopy(tampered);
    expect(gate.allowed).toBe(false);
    expect(mapCopyGateStatus(gate.code)).toBe('blocked_invalid_sitemap');
  });
});

// ── Safety source-scans (tests 18, 19, 20, 22, 23, 24) ─────────────────────
function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}
function importSources(src: string): string[] {
  const out: string[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const M2_FILES = [
  'lib/website-sitemap-edit.ts',
  'app/api/businesses/[id]/website/service-discovery/route.ts',
  'app/api/businesses/[id]/website/copy-gate/route.ts',
  'app/api/businesses/[id]/website/sitemap/route.ts',
  'app/api/businesses/[id]/website/sitemap/[sitemapId]/route.ts',
  'app/api/businesses/[id]/website/sitemap/[sitemapId]/approve/route.ts',
  'app/api/businesses/[id]/website/sitemap/[sitemapId]/revisions/route.ts',
];

const ALLOWED_IMPORTS = new Set([
  'next/server', 'next-auth',
  '@/lib/auth-options', '@/lib/website-workflow',
  '@/lib/website-sitemap', '@/lib/website-sitemap-edit', '@/lib/website-sitemap-store',
  '@/lib/industry-services',
]);

describe('safety invariants (tests 18, 19, 20, 22, 23, 24)', () => {
  it('the pure edit lib imports ONLY from the sitemap pure-logic module (no network/copy/image/publish)', () => {
    const srcs = importSources(read('lib/website-sitemap-edit.ts'));
    expect(srcs).toEqual(['@/lib/website-sitemap']);
  });

  it('tests 18/19/20 — M2 route/lib files never import copy, image, publish, or deploy modules', () => {
    const forbidden = /(publish|deploy|s3|image|screenshot|puppeteer|playwright|ffmpeg|route-?llm|openai|sendNotification|dataforseo|scrape)/i;
    for (const f of M2_FILES) {
      for (const src of importSources(read(f))) {
        expect(src).not.toMatch(forbidden);
      }
    }
  });

  it('tests 22/23/24 — M2 files do not import SEO, Search Intelligence, or social generation systems', () => {
    const forbidden = /(seo|search-intel|searchintel|social|scout|clark|generate-image|copy-generat)/i;
    for (const f of M2_FILES) {
      for (const src of importSources(read(f))) {
        expect(src).not.toMatch(forbidden);
      }
    }
  });

  it('route imports are confined to an explicit allow-list', () => {
    for (const f of M2_FILES.filter((f) => f.includes('/api/'))) {
      for (const src of importSources(read(f))) {
        expect(ALLOWED_IMPORTS.has(src)).toBe(true);
      }
    }
  });

  it('test 21 — the existing website concept flow (WebsiteSection) is still mounted', () => {
    const page = read('app/dashboard/website/page.tsx');
    expect(page).toMatch(/WebsiteSection/);
    expect(page).toMatch(/SitemapPlannerCard/);
    expect(fs.existsSync(path.join(process.cwd(), 'app/dashboard/website/_components/website-section.tsx'))).toBe(true);
  });
});
