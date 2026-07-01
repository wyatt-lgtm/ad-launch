/**
 * Milestone 3 — Copy generation (pure logic + safety scans).
 *
 * Exercises the network-free copy layer (lib/website-copy.ts) built on top of an
 * APPROVED sitemap, plus source scans proving the milestone performs NO image
 * generation, NO static build, and NO publish/deploy, and that the pure module
 * only imports from '@/lib/website-sitemap'.
 *
 * Covers spec tests: 4,5,6,7,8,9,10,11,12,13,14,15,19,20,21,27 (pure portions).
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  generateSitemap,
  approveSitemap,
  classifyServices,
  addUserRequestedPage,
  canGenerateCopy,
  WebsiteSitemapArtifact,
  ServiceCandidate,
} from '@/lib/website-sitemap';
import {
  buildCopyPlan,
  isPageEligibleForCopy,
  buildPageCopyPrompt,
  parsePageCopyResponse,
  validatePageCopy,
  validateCopyUniqueness,
  buildCopyArtifact,
  internalLinkTargetsFor,
  imageNeedsFor,
  type PageCopy,
} from '@/lib/website-copy';

const HOUSTON = { city: 'Houston', state: 'Texas' };

const WEST_HOUSTON_SERVICES: ServiceCandidate[] = [
  { serviceName: 'Brake Repair', source: 'user', userSelected: true },
  { serviceName: 'Oil Change', source: 'user', userSelected: true },
  { serviceName: 'Check Engine Light Diagnostics', source: 'user', userSelected: true },
  { serviceName: 'Transmission Repair', source: 'user', userSelected: true },
  { serviceName: 'AC Repair', source: 'user', userSelected: true },
  { serviceName: 'Tire Services', source: 'user', userSelected: true },
  { serviceName: 'Battery Replacement', source: 'user', userSelected: true },
  { serviceName: 'Engine Repair', source: 'user', userSelected: true },
];

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

function approvedFixture(): WebsiteSitemapArtifact {
  return approveSitemap(westHouston(WEST_HOUSTON_SERVICES), 'user-1');
}

/** Deterministic fake LLM output for a page, echoing unique, service-specific copy. */
function fakeLlmFor(page: { title: string; sections: string[] }): any {
  return {
    metaTitle: `${page.title} | West Houston Auto Repair`,
    metaDescription: `Specific ${page.title.toLowerCase()} details for drivers in Houston, Texas.`,
    heroHeadline: `${page.title} you can trust`,
    heroSubheadline: `Unique subheadline for ${page.title}.`,
    primaryCta: 'Schedule Service',
    secondaryCta: 'Call Now',
    sections: (page.sections.length ? page.sections : ['Hero', 'CTA']).map((name) => ({
      name,
      heading: `${name} — ${page.title}`,
      body: `Distinct body for ${page.title} / ${name}. ${page.title} specifics go here.`,
    })),
    faqs: [
      { question: `How do I know I need ${page.title.toLowerCase()}?`, answer: `Answer specific to ${page.title}.` },
      { question: `What does ${page.title.toLowerCase()} involve?`, answer: `Process specific to ${page.title}.` },
      { question: `Do you serve my area?`, answer: `Yes — Houston, Texas and surrounding areas.` },
    ],
  };
}

function generateAllCopy(sitemap: WebsiteSitemapArtifact): PageCopy[] {
  return buildCopyPlan(sitemap).map((page) => parsePageCopyResponse(fakeLlmFor(page), page, sitemap));
}

// ── Copy plan / gate integration ────────────────────────────────────
describe('copy gate (tests 1–4)', () => {
  it('test 1 — gate blocks when sitemap missing', () => {
    const gate = canGenerateCopy(null);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_missing');
  });

  it('test 2 — gate blocks when sitemap not approved', () => {
    const gate = canGenerateCopy(westHouston(WEST_HOUSTON_SERVICES));
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_not_approved');
  });

  it('test 3 — gate blocks when a sitemap H1 is invalid', () => {
    const sitemap = approvedFixture();
    const tampered: WebsiteSitemapArtifact = {
      ...sitemap,
      pages: sitemap.pages.map((p) =>
        p.pageType === 'service_detail' ? { ...p, h1: 'Our Services' } : p,
      ),
    };
    const gate = canGenerateCopy(tampered);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('invalid_h1');
  });

  it('test 4 — gate allows an approved, valid sitemap', () => {
    const gate = canGenerateCopy(approvedFixture());
    expect(gate.allowed).toBe(true);
    expect(gate.code).toBe('ok');
  });
});

describe('copy plan (tests 5, 6)', () => {
  it('test 5 — plan includes every approved sitemap page (home + hub + 8 services)', () => {
    const sitemap = approvedFixture();
    const plan = buildCopyPlan(sitemap);
    const slugs = plan.map((p) => p.slug);
    // Home + Services hub + 8 confirmed service pages.
    expect(plan.filter((p) => p.pageType === 'home').length).toBe(1);
    expect(plan.filter((p) => p.pageType === 'service_hub').length).toBe(1);
    expect(plan.filter((p) => p.pageType === 'service_detail').length).toBe(8);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicate slugs
  });

  it('test 6 — rejected/unconfirmed services do not get copy pages', () => {
    const mixed = westHouston([
      { serviceName: 'Brake Repair', source: 'user', userSelected: true },
      { serviceName: 'Boat Detailing', source: 'user', userSelected: false, userRejected: true } as any,
    ]);
    const approved = approveSitemap(mixed, 'user-1');
    const plan = buildCopyPlan(approved);
    const serviceSlugs = plan.filter((p) => p.pageType === 'service_detail').map((p) => p.slug);
    expect(serviceSlugs.some((s) => s.includes('boat'))).toBe(false);
    // eligibility helper agrees
    approved.pages
      .filter((p) => p.pageType === 'service_detail' && p.confirmationStatus !== 'confirmed')
      .forEach((p) => expect(isPageEligibleForCopy(p)).toBe(false));
  });
});

describe('per-page copy generation (tests 7, 8, 9, 13, 14)', () => {
  it('test 7 — confirmed service pages get UNIQUE body copy', () => {
    const pages = generateAllCopy(approvedFixture());
    const services = pages.filter((p) => p.pageType === 'service_detail');
    expect(services.length).toBe(8);
    expect(validateCopyUniqueness(pages)).toHaveLength(0);
  });

  it('test 8 — service page H1 stays "{Service} in {City}, {State}"', () => {
    const pages = generateAllCopy(approvedFixture());
    const brake = pages.find((p) => p.slug.includes('brake-repair'));
    expect(brake?.h1).toBe('Brake Repair in Houston, Texas');
    const oil = pages.find((p) => p.slug.includes('oil-change'));
    expect(oil?.h1).toBe('Oil Change in Houston, Texas');
  });

  it('test 13 — every page has meta title + meta description', () => {
    const pages = generateAllCopy(approvedFixture());
    pages.forEach((p) => {
      expect(p.metaTitle.length).toBeGreaterThan(0);
      expect(p.metaDescription.length).toBeGreaterThan(0);
    });
  });

  it('test 14 — service pages include FAQs', () => {
    const pages = generateAllCopy(approvedFixture());
    pages
      .filter((p) => p.pageType === 'service_detail')
      .forEach((p) => expect(p.faqs.length).toBeGreaterThan(0));
  });

  it('validatePageCopy flags missing required fields', () => {
    const pages = generateAllCopy(approvedFixture());
    const good = pages[0];
    expect(validatePageCopy(good)).toHaveLength(0);
    const bad: PageCopy = { ...good, metaDescription: '', faqs: [] };
    const issues = validatePageCopy(bad).map((i) => i.kind);
    expect(issues).toContain('missing_meta_description');
    expect(issues).toContain('no_faqs');
  });

  it('uniqueness validator catches templated (name-swapped) copy', () => {
    const pages = generateAllCopy(approvedFixture());
    // Force two service pages to share identical body copy.
    const svc = pages.filter((p) => p.pageType === 'service_detail');
    const cloned = svc.map((p, i) =>
      i < 2 ? { ...p, sections: [{ name: 'X', body: 'IDENTICAL GENERIC BODY' }] } : p,
    );
    expect(validateCopyUniqueness(cloned).length).toBeGreaterThan(0);
  });
});

describe('services hub + home internal links (tests 9, 10)', () => {
  it('test 9 — services hub links to each confirmed service page', () => {
    const sitemap = approvedFixture();
    const hub = sitemap.pages.find((p) => p.pageType === 'service_hub')!;
    const links = internalLinkTargetsFor(hub, sitemap).map((l) => l.slug);
    const serviceSlugs = sitemap.pages
      .filter((p) => p.pageType === 'service_detail' && p.confirmationStatus === 'confirmed')
      .map((p) => p.slug);
    serviceSlugs.forEach((s) => expect(links).toContain(s));
  });

  it('test 10 — home page links to the services hub', () => {
    const sitemap = approvedFixture();
    const home = sitemap.pages.find((p) => p.pageType === 'home')!;
    const hub = sitemap.pages.find((p) => p.pageType === 'service_hub')!;
    const links = internalLinkTargetsFor(home, sitemap).map((l) => l.slug);
    expect(links).toContain(hub.slug);
  });
});

describe('user-requested pages (tests 11, 12)', () => {
  it('test 12 — Tombstone vs Tabloo is NOT added by default', () => {
    const sitemap = approvedFixture();
    const slugs = sitemap.pages.map((p) => p.slug).join(' ');
    expect(slugs.toLowerCase()).not.toContain('tabloo');
    expect(buildCopyPlan(sitemap).some((p) => p.pageType === 'comparison')).toBe(false);
  });

  it('test 11 — user-requested comparison page receives copy only when present in sitemap', () => {
    const base = westHouston(WEST_HOUSTON_SERVICES);
    const { sitemap: withPage } = addUserRequestedPage(base, {
      title: 'Tombstone vs Tabloo',
      requestedByUserId: 'user-1',
      pageType: 'comparison',
    });
    const approved = approveSitemap(withPage, 'user-1');
    const plan = buildCopyPlan(approved);
    const comparison = plan.find((p) => /tabloo/i.test(p.slug) || /tabloo/i.test(p.title));
    expect(comparison).toBeTruthy();
    expect(comparison?.source).toBe('user_requested');
    const copy = parsePageCopyResponse(
      fakeLlmFor(comparison as any),
      comparison as any,
      approved,
    );
    expect(copy.slug).toBe(comparison!.slug);
  });
});

describe('image needs are text-only (tests 15, 19)', () => {
  it('test 15 — copy lists image needs but generates no images', () => {
    const sitemap = approvedFixture();
    const page = buildCopyPlan(sitemap).find((p) => p.pageType === 'service_detail')!;
    const needs = imageNeedsFor(page);
    expect(Array.isArray(needs)).toBe(true);
    needs.forEach((n) => {
      expect(typeof n.section).toBe('string');
      expect(typeof n.note).toBe('string');
      // note is purely descriptive text — no url / data uri / binary reference
      expect(n.note).not.toMatch(/https?:\/\/|data:image|\.png|\.jpg/i);
    });
  });
});

describe('artifact assembly', () => {
  it('buildCopyArtifact wraps pages with draft stage + business identity', () => {
    const sitemap = approvedFixture();
    const pages = generateAllCopy(sitemap);
    const artifact = buildCopyArtifact(sitemap, pages);
    expect(artifact.stage).toBe('draft');
    expect(artifact.businessName).toBe('West Houston Auto Repair');
    expect(artifact.pages.length).toBe(pages.length);
  });
});

// ── Safety source scans (tests 19, 20, 21, 26, 27) ──────────────────────────
const LIB = path.join(process.cwd(), 'lib');
const read = (p: string) => fs.readFileSync(path.join(LIB, p), 'utf8');

describe('safety: pure module import allowlist', () => {
  it('lib/website-copy.ts imports ONLY from @/lib/website-sitemap', () => {
    const src = read('website-copy.ts');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    const external = imports.filter((i) => i.startsWith('@/') || i.startsWith('.'));
    external.forEach((i) => expect(i).toBe('@/lib/website-sitemap'));
  });
});

describe('safety: no image gen / build / publish / deploy (tests 19, 20, 21, 26, 27)', () => {
  const files = ['website-copy.ts', 'website-copy-store.ts'];
  it('no image generation calls', () => {
    files.forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/modalities|image_config|generateImage|flux|dall-?e/i);
    });
  });
  it('no static build / publish / deploy calls', () => {
    files.forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/buildStaticSite|publishSite|deploy\(|hostgator|cloudflare|vercel|wordpress/i);
    });
  });
  it('no Google scraping / browser automation', () => {
    files.forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/puppeteer|playwright|google\.com\/search|scrape/i);
    });
  });
  it('no hardcoded local filesystem paths', () => {
    files.forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/\/home\/ubuntu|\/Users\//);
    });
  });
});
