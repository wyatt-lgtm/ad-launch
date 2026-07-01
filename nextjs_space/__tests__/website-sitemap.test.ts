/**
 * Milestone 1 — sitemap-first website generation (pure logic).
 *
 * Covers required tests 1–13, 15, 16 plus the West Houston Auto Repair test
 * case and the "Tombstone vs Tabloo" user-added page test case.
 */
import fs from 'fs';
import path from 'path';
import {
  classifyServices,
  classifyService,
  confirmedServices,
  generateSitemap,
  addUserRequestedPage,
  approveSitemap,
  canGenerateCopy,
  assertCanGenerateCopy,
  CopyGateError,
  validateSitemapH1s,
  buildServiceDetailH1,
  buildParentServicesH1,
  buildHomeH1,
  serviceDetailSlug,
  ServiceCandidate,
  DiscoveredService,
  WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';

const HOUSTON = { city: 'Houston', state: 'Texas', region: 'West Houston' };

const AUTO_SERVICES = [
  'Brake Repair',
  'Oil Change',
  'Check Engine Light Diagnostics',
  'Transmission Repair',
  'AC Repair',
  'Tire Services',
  'Battery Replacement',
  'Engine Repair',
];

function confirmedAuto(): DiscoveredService[] {
  return AUTO_SERVICES.map((name) =>
    classifyService({ serviceName: name, source: 'user', userSelected: true }),
  );
}

function buildWestHouston(): WebsiteSitemapArtifact {
  return generateSitemap({
    businessName: 'West Houston Auto Repair',
    industry: 'Auto Repair',
    businessType: 'Auto Repair Shop',
    serviceCategoryLabel: 'Auto Repair',
    primaryServiceArea: HOUSTON,
    websiteGoal: 'lead generation',
    serviceAreaMode: 'local',
    services: confirmedAuto(),
    sourceSummary: { website: true, businessSettings: true, agentResearch: true },
  });
}

// ── 1. Service discovery classification ─────────────────────────────────
describe('service discovery classification', () => {
  it('classifies confirmed / likely / needs_user_confirmation / rejected correctly', () => {
    const candidates: ServiceCandidate[] = [
      { serviceName: 'Brake Repair', source: 'user', userSelected: true },
      { serviceName: 'Oil Change', source: 'website', listedOnWebsite: true },
      { serviceName: 'Fleet Maintenance', source: 'business_settings', storedInBusinessSettings: true },
      { serviceName: 'AC Repair', source: 'industry_knowledge', commonForIndustry: true },
      { serviceName: 'Diesel Repair', source: 'industry_knowledge', broadIndustryInference: true },
      { serviceName: 'Detailing', source: 'agent_research', fromCompetitorOnly: true },
      { serviceName: 'State Inspection', source: 'user', userRejected: true },
    ];
    const classified = classifyServices(candidates);
    const byName = Object.fromEntries(classified.map((s) => [s.serviceName, s.confirmationStatus]));
    expect(byName['Brake Repair']).toBe('confirmed');
    expect(byName['Oil Change']).toBe('confirmed');
    expect(byName['Fleet Maintenance']).toBe('confirmed');
    expect(byName['AC Repair']).toBe('likely');
    expect(byName['Diesel Repair']).toBe('needs_user_confirmation');
    expect(byName['Detailing']).toBe('needs_user_confirmation');
    expect(byName['State Inspection']).toBe('rejected');
  });

  it('2. only confirmed services become service detail pages', () => {
    const services = [
      classifyService({ serviceName: 'Brake Repair', source: 'user', userSelected: true }),
      classifyService({ serviceName: 'Diesel Repair', source: 'industry_knowledge', broadIndustryInference: true }),
    ];
    const sitemap = generateSitemap({
      businessName: 'X', industry: 'Auto Repair', primaryServiceArea: HOUSTON, services,
    });
    const detailSlugs = sitemap.pages.filter((p) => p.pageType === 'service_detail').map((p) => p.slug);
    expect(detailSlugs).toContain('/services/brake-repair');
    expect(detailSlugs).not.toContain('/services/diesel-repair');
  });

  it('3. likely / uncertain services are retained for confirmation but are not pages', () => {
    const services = [
      classifyService({ serviceName: 'AC Repair', source: 'industry_knowledge', commonForIndustry: true }),
      classifyService({ serviceName: 'Detailing', source: 'agent_research', fromCompetitorOnly: true }),
    ];
    const sitemap = generateSitemap({ businessName: 'X', industry: 'Auto Repair', primaryServiceArea: HOUSTON, services });
    // No service_detail pages (nothing confirmed) and no /services hub.
    expect(sitemap.pages.some((p) => p.pageType === 'service_detail')).toBe(false);
    expect(sitemap.pages.some((p) => p.slug === '/services')).toBe(false);
    // But the discovery list retains them for the confirmation UI.
    expect(sitemap.serviceDiscovery.map((s) => s.confirmationStatus).sort()).toEqual(
      ['likely', 'needs_user_confirmation'],
    );
  });

  it('4. rejected services never become pages', () => {
    const services = [
      classifyService({ serviceName: 'Brake Repair', source: 'user', userSelected: true }),
      classifyService({ serviceName: 'State Inspection', source: 'user', userRejected: true }),
    ];
    const sitemap = generateSitemap({ businessName: 'X', industry: 'Auto Repair', primaryServiceArea: HOUSTON, services });
    const slugs = sitemap.pages.map((p) => p.slug);
    expect(slugs).not.toContain('/services/state-inspection');
  });
});

// ── 5–7. hub-and-spoke + H1s ──────────────────────────────────────────
describe('hub-and-spoke structure and H1s', () => {
  it('5. service-heavy business gets a /services hub plus child service pages', () => {
    const sitemap = buildWestHouston();
    const hub = sitemap.pages.find((p) => p.slug === '/services');
    expect(hub).toBeTruthy();
    expect(hub!.pageType).toBe('service_hub');
    expect(hub!.childPages).toEqual([
      '/services/brake-repair',
      '/services/oil-change',
      '/services/check-engine-light-diagnostics',
      '/services/transmission-repair',
      '/services/ac-repair',
      '/services/tire-services',
      '/services/battery-replacement',
      '/services/engine-repair',
    ]);
  });

  it('6. service detail H1 follows {Service} in {City}, {State}', () => {
    expect(buildServiceDetailH1('Brake Repair', HOUSTON)).toBe('Brake Repair in Houston, Texas');
    const sitemap = buildWestHouston();
    const brake = sitemap.pages.find((p) => p.slug === '/services/brake-repair');
    expect(brake!.h1).toBe('Brake Repair in Houston, Texas');
  });

  it('7. parent Services H1 includes category + area', () => {
    expect(buildParentServicesH1('Auto Repair', HOUSTON)).toBe('Auto Repair Services in Houston, Texas');
    const sitemap = buildWestHouston();
    const hub = sitemap.pages.find((p) => p.slug === '/services');
    expect(hub!.h1).toBe('Auto Repair Services in Houston, Texas');
  });

  it('home H1 includes business type + area', () => {
    expect(buildHomeH1('Auto Repair Shop', HOUSTON)).toBe('Trusted Auto Repair Shop in Houston, Texas');
  });

  it('rejects generic/slogan service H1s during validation', () => {
    const sitemap = buildWestHouston();
    const brake = sitemap.pages.find((p) => p.slug === '/services/brake-repair')!;
    brake.h1 = 'Reliable Auto Care';
    const issues = validateSitemapH1s(sitemap);
    expect(issues.some((i) => i.slug === '/services/brake-repair')).toBe(true);
  });
});

// ── 8. no default example pages ────────────────────────────────────────
describe('no hardcoded example marketing pages', () => {
  it('8. does not add SEO / Paid Ads / GMB / Launch CRM / comparison pages by default', () => {
    const sitemap = buildWestHouston();
    const slugs = sitemap.pages.map((p) => p.slug);
    const forbidden = [
      '/services/seo', '/seo', '/services/paid-advertising', '/paid-advertising',
      '/services/social-media', '/services/google-business-profile', '/services/launch-crm',
      '/services/competitor-research', '/services/reporting',
      '/compare/tombstone-vs-tabloo',
    ];
    for (const f of forbidden) expect(slugs).not.toContain(f);
    // Exactly: home + hub + 8 service pages.
    expect(sitemap.pages.length).toBe(10);
    expect(sitemap.userRequestedPages.length).toBe(0);
  });
});

// ── 9–10, 13. user-requested pages ─────────────────────────────────────
describe('user-requested pages', () => {
  it('9. stores an added page as user_requested', () => {
    const { sitemap } = addUserRequestedPage(buildWestHouston(), { title: 'Financing Options', requestedByUserId: 'u1' });
    const page = sitemap.pages.find((p) => p.title === 'Financing Options')!;
    expect(page.source).toBe('user_requested');
    expect(page.status).toBe('added_by_user');
    expect(page.requestedByUserId).toBe('u1');
    expect(sitemap.userRequestedPages.some((p) => p.title === 'Financing Options' && p.source === 'user_requested')).toBe(true);
  });

  it('10 & 12. "Tombstone vs Tabloo" creates /compare/tombstone-vs-tabloo only when requested', () => {
    const base = buildWestHouston();
    expect(base.pages.some((p) => p.slug === '/compare/tombstone-vs-tabloo')).toBe(false);
    const { sitemap, revision } = addUserRequestedPage(base, { title: 'Tombstone vs Tabloo', requestedByUserId: 'u1' });
    const page = sitemap.pages.find((p) => p.slug === '/compare/tombstone-vs-tabloo');
    expect(page).toBeTruthy();
    expect(page!.pageType).toBe('comparison');
    expect(page!.source).toBe('user_requested');
    expect(revision.action).toBe('add_page');
    expect(revision.page.slug).toBe('/compare/tombstone-vs-tabloo');
  });

  it('does not add comparison pages to an unrelated future site by default', () => {
    const unrelated = generateSitemap({
      businessName: 'Katy Dental', industry: 'Dental', primaryServiceArea: { city: 'Katy', state: 'Texas' },
      services: [classifyService({ serviceName: 'Teeth Cleaning', source: 'user', userSelected: true })],
    });
    expect(unrelated.pages.some((p) => p.pageType === 'comparison')).toBe(false);
    expect(unrelated.pages.some((p) => p.slug.startsWith('/compare/'))).toBe(false);
  });

  it('13. adding a user page resets approval to pending_user_review (revised sitemap re-reviewed)', () => {
    const approved = approveSitemap(buildWestHouston(), 'u1');
    expect(approved.approvalStatus).toBe('approved');
    const { sitemap } = addUserRequestedPage(approved, { title: 'Tombstone vs Tabloo', requestedByUserId: 'u1' });
    expect(sitemap.approvalStatus).toBe('pending_user_review');
    expect(sitemap.approvedAt).toBeNull();
    expect(sitemap.approvedBy).toBeNull();
  });
});

// ── 11–13. copy gate ───────────────────────────────────────────────
describe('copy generation hard gate', () => {
  it('11. blocks copy when sitemap is missing', () => {
    const gate = canGenerateCopy(null);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_missing');
  });

  it('12. blocks copy when sitemap is not approved', () => {
    const gate = canGenerateCopy(buildWestHouston());
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_not_approved');
  });

  it('13. allows copy only after the sitemap is approved', () => {
    const approved = approveSitemap(buildWestHouston(), 'u1');
    const gate = canGenerateCopy(approved);
    expect(gate.allowed).toBe(true);
    expect(gate.code).toBe('ok');
  });

  it('assertCanGenerateCopy throws CopyGateError when blocked', () => {
    expect(() => assertCanGenerateCopy(buildWestHouston())).toThrow(CopyGateError);
    expect(() => assertCanGenerateCopy(approveSitemap(buildWestHouston(), 'u1'))).not.toThrow();
  });

  it('blocks copy when an approved sitemap has an invalid H1', () => {
    const approved = approveSitemap(buildWestHouston(), 'u1');
    approved.pages.find((p) => p.slug === '/services/brake-repair')!.h1 = 'Our Services';
    const gate = canGenerateCopy(approved);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('invalid_h1');
  });
});

// ── Required test case: West Houston Auto Repair ────────────────────────────
describe('WEST HOUSTON AUTO REPAIR test case', () => {
  it('produces exactly the expected sitemap and H1s', () => {
    const sitemap = buildWestHouston();
    const expected: Record<string, string> = {
      '/': 'Trusted Auto Repair Shop in Houston, Texas',
      '/services': 'Auto Repair Services in Houston, Texas',
      '/services/brake-repair': 'Brake Repair in Houston, Texas',
      '/services/oil-change': 'Oil Change in Houston, Texas',
      '/services/check-engine-light-diagnostics': 'Check Engine Light Diagnostics in Houston, Texas',
      '/services/transmission-repair': 'Transmission Repair in Houston, Texas',
      '/services/ac-repair': 'AC Repair in Houston, Texas',
      '/services/tire-services': 'Tire Services in Houston, Texas',
      '/services/battery-replacement': 'Battery Replacement in Houston, Texas',
      '/services/engine-repair': 'Engine Repair in Houston, Texas',
    };
    const actual = Object.fromEntries(sitemap.pages.map((p) => [p.slug, p.h1]));
    expect(actual).toEqual(expected);
    expect(validateSitemapH1s(sitemap)).toEqual([]);
  });

  it('then "Add Tombstone vs Tabloo" adds one user_requested comparison page and re-reviews', () => {
    const approved = approveSitemap(buildWestHouston(), 'u1');
    const { sitemap, revision } = addUserRequestedPage(approved, { title: 'Tombstone vs Tabloo', requestedByUserId: 'u1' });
    expect(sitemap.pages.length).toBe(11);
    const cmp = sitemap.pages.find((p) => p.slug === '/compare/tombstone-vs-tabloo')!;
    expect(cmp.pageType).toBe('comparison');
    expect(cmp.source).toBe('user_requested');
    expect(sitemap.approvalStatus).toBe('pending_user_review');
    expect(revision.page.slug).toBe('/compare/tombstone-vs-tabloo');
    // Copy is blocked again until the revised sitemap is re-approved.
    expect(canGenerateCopy(sitemap).allowed).toBe(false);
  });
});

// ── 15–16. safety invariants (no scraping, no publish/deploy) ─────────────────
describe('safety invariants', () => {
  const readLib = (name: string) => fs.readFileSync(path.join(process.cwd(), 'lib', name), 'utf8');

  it('15. no Google scraping / no network in the sitemap logic', () => {
    const src = readLib('website-sitemap.ts');
    expect(/google\.com\/search/i.test(src)).toBe(false);
    expect(/\bfetch\s*\(/.test(src)).toBe(false);
    expect(/puppeteer|playwright|browser\.newPage/i.test(src)).toBe(false);
  });

  it('16. no publishing / deployment in the sitemap logic or store', () => {
    for (const name of ['website-sitemap.ts', 'website-sitemap-store.ts']) {
      const src = readLib(name);
      expect(/\b(sftp|ssh2|ftps|publishSite|deploySite|uploadTo)\b/i.test(src)).toBe(false);
    }
  });
});
