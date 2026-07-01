/**
 * Milestone 4 — Image briefs (pure logic + safety scans).
 *
 * Exercises the network-free image-brief layer (lib/website-image-briefs.ts)
 * built on top of an APPROVED sitemap + website copy, plus source scans proving
 * the milestone performs NO image generation, NO R2 upload, NO static build,
 * NO publish/deploy, NO scraping, and only imports from '@/lib/website-sitemap'
 * and '@/lib/website-copy'.
 *
 * Required test case: West Houston Auto Repair (Auto Repair, Houston TX) with 8
 * services. Expected: Home hero + Services hub hero + 8 service-page heroes;
 * subject-specific briefs; every hero forbids logo-as-hero + giant watermark;
 * every hero has mobile crop notes; NO images generated.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  generateSitemap,
  approveSitemap,
  classifyServices,
  type WebsiteSitemapArtifact,
  type ServiceCandidate,
} from '@/lib/website-sitemap';
import {
  buildCopyPlan,
  parsePageCopyResponse,
  type PageCopy,
} from '@/lib/website-copy';
import {
  canGenerateImageBriefs,
  buildPageImageBriefs,
  buildImageBriefPrompt,
  parseImageBriefResponse,
  validateImageBriefs,
  buildImageBriefArtifact,
  sectionBriefTargetsFor,
  HERO_FORBIDDEN_VISUALS,
  type CopyArtifactForBriefs,
  type PageImageBriefs,
} from '@/lib/website-image-briefs';

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

/** Deterministic fake copy-LLM output for a page. */
function fakeCopyFor(page: { title: string; sections: string[] }): any {
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
      body: `Distinct body for ${page.title} / ${name}.`,
    })),
    faqs: [
      { question: `What does ${page.title.toLowerCase()} involve?`, answer: `Process specific to ${page.title}.` },
    ],
  };
}

function generateAllCopy(sitemap: WebsiteSitemapArtifact): PageCopy[] {
  return buildCopyPlan(sitemap).map((page) => parsePageCopyResponse(fakeCopyFor(page), page, sitemap));
}

function buildAllBriefs(sitemap: WebsiteSitemapArtifact): PageImageBriefs[] {
  return generateAllCopy(sitemap).map((copyPage) => buildPageImageBriefs(copyPage, sitemap));
}

function copyArtifact(sitemap: WebsiteSitemapArtifact, status?: string, sitemapId = 'sm-1'): CopyArtifactForBriefs {
  return { sitemapId, status, pages: generateAllCopy(sitemap) };
}

// ── Gate ───────────────────────────────────────────────────────
describe('image brief gate (tests 1–4)', () => {
  it('test 1 — blocks when sitemap is missing', () => {
    const gate = canGenerateImageBriefs(null, null);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_missing');
  });

  it('test 2 — blocks when sitemap is not approved', () => {
    const gate = canGenerateImageBriefs(westHouston(WEST_HOUSTON_SERVICES), null);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('sitemap_not_approved');
  });

  it('test 3 — blocks when copy artifact is missing (even with approved sitemap)', () => {
    const gate = canGenerateImageBriefs(approvedFixture(), null);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('copy_missing');
  });

  it('test 3b — blocks when copy has an ineligible status', () => {
    const sm = approvedFixture();
    const gate = canGenerateImageBriefs(sm, copyArtifact(sm, 'archived'));
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('copy_invalid_status');
  });

  it('test 3c — blocks when copy belongs to a different sitemap', () => {
    const sm = approvedFixture();
    const gate = canGenerateImageBriefs(sm, copyArtifact(sm, 'draft', 'other-sm'), { sitemapId: 'sm-1' });
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('copy_sitemap_mismatch');
  });

  it('test 4 — allows an approved sitemap + eligible copy', () => {
    const sm = approvedFixture();
    const gate = canGenerateImageBriefs(sm, copyArtifact(sm, 'draft', 'sm-1'), { sitemapId: 'sm-1' });
    expect(gate.allowed).toBe(true);
    expect(gate.code).toBe('ok');
  });

  it('test 4b — accepts draft, ready_for_review and approved copy statuses', () => {
    const sm = approvedFixture();
    for (const status of ['draft', 'ready_for_review', 'approved']) {
      expect(canGenerateImageBriefs(sm, copyArtifact(sm, status, 'sm-1'), { sitemapId: 'sm-1' }).allowed).toBe(true);
    }
  });
});

// ── West Houston full case ─────────────────────────────────────────
describe('West Houston Auto Repair briefs (tests 5–14)', () => {
  const sitemap = approvedFixture();
  const briefs = buildAllBriefs(sitemap);
  const bySlug = (needle: string) =>
    briefs.find((p) => p.slug.includes(needle));
  const hero = (p?: PageImageBriefs) => p?.briefs.find((b) => b.sectionType === 'hero');

  it('test 5 — produces a home hero brief', () => {
    const home = briefs.find((p) => p.pageType === 'home');
    expect(home).toBeTruthy();
    expect(hero(home)).toBeTruthy();
  });

  it('test 6 — produces a services hub hero brief', () => {
    const hub = briefs.find((p) => p.pageType === 'service_hub');
    expect(hub).toBeTruthy();
    expect(hero(hub)).toBeTruthy();
  });

  it('test 7 — produces a hero brief for each of the 8 service pages', () => {
    const servicePages = briefs.filter((p) => p.pageType === 'service_detail');
    expect(servicePages.length).toBe(8);
    servicePages.forEach((p) => expect(hero(p)).toBeTruthy());
  });

  it('test 8 — every page has at least one hero brief', () => {
    briefs.forEach((p) => expect(p.briefs.some((b) => b.sectionType === 'hero')).toBe(true));
  });

  it('test 9 — Brake page brief references brake work', () => {
    const b = hero(bySlug('brake'));
    expect(b?.visualObjective.toLowerCase()).toMatch(/brake/);
  });

  it('test 10 — Oil Change page brief references oil', () => {
    const b = hero(bySlug('oil'));
    expect(b?.visualObjective.toLowerCase()).toMatch(/oil/);
  });

  it('test 11 — Transmission page brief references transmission', () => {
    const b = hero(bySlug('transmission'));
    expect(b?.visualObjective.toLowerCase()).toMatch(/transmission/);
  });

  it('test 12 — AC page brief references AC', () => {
    const b = hero(bySlug('ac'));
    expect(b?.visualObjective.toLowerCase()).toMatch(/ac|air condition/);
  });

  it('test 13 — Tire page brief references tires', () => {
    const b = hero(bySlug('tire'));
    expect(b?.visualObjective.toLowerCase()).toMatch(/tire|wheel/);
  });

  it('test 14 — every hero forbids logo-as-hero and a giant watermark', () => {
    briefs.forEach((p) => {
      const h = hero(p)!;
      const joined = h.forbiddenVisuals.join(' | ').toLowerCase();
      expect(joined).toMatch(/logo/);
      expect(joined).toMatch(/watermark/);
      HERO_FORBIDDEN_VISUALS.forEach((f) => expect(h.forbiddenVisuals).toContain(f));
    });
  });
});

// ── Safety fields ──────────────────────────────────────────────
describe('brief safety fields (tests 15–19)', () => {
  const sitemap = approvedFixture();
  const briefs = buildAllBriefs(sitemap);

  it('test 15 — every hero brief has mobile crop notes', () => {
    briefs.forEach((p) => {
      p.briefs.filter((b) => b.sectionType === 'hero').forEach((b) => {
        expect(b.mobileCropNotes.length).toBeGreaterThan(0);
      });
    });
  });

  it('test 16 — every hero brief has a text-safe zone', () => {
    briefs.forEach((p) => {
      p.briefs.filter((b) => b.sectionType === 'hero').forEach((b) => {
        expect(b.textSafeZone.length).toBeGreaterThan(0);
      });
    });
  });

  it('test 17 — no brief bakes text into the image', () => {
    briefs.forEach((p) => p.briefs.forEach((b) => expect(b.allowTextInImage).toBe(false)));
  });

  it('test 18 — andyRenderReady is always false in this milestone (no rendering)', () => {
    briefs.forEach((p) => p.briefs.forEach((b) => expect(b.andyRenderReady).toBe(false)));
  });

  it('test 19 — briefs contain NO image URLs or data URIs (specs only)', () => {
    const json = JSON.stringify(briefs);
    expect(json).not.toMatch(/https?:\/\/|data:image|\.png|\.jpg|\.jpeg|\.webp/i);
  });

  it('test 19b — asset source preference is a spec keyword, not a URL', () => {
    briefs.forEach((p) => p.briefs.forEach((b) => {
      expect(['generated_asset', 'stock_licensed', 'owner_supplied']).toContain(b.assetSourcePreference);
    }));
  });
});

// ── Validation + artifact ───────────────────────────────────────
describe('validation + artifact assembly (tests 20–22)', () => {
  const sitemap = approvedFixture();
  const pages = buildAllBriefs(sitemap);

  it('test 20 — a well-formed brief set has no validation issues', () => {
    expect(validateImageBriefs(pages)).toEqual([]);
  });

  it('test 20b — validation flags a page missing its hero brief', () => {
    const broken = pages.map((p, i) =>
      i === 0 ? { ...p, briefs: p.briefs.filter((b) => b.sectionType !== 'hero') } : p,
    );
    const issues = validateImageBriefs(broken);
    expect(issues.some((x) => x.kind === 'missing_hero_brief')).toBe(true);
  });

  it('test 21 — artifact summary counts pages, briefs and heroes', () => {
    const artifact = buildImageBriefArtifact({ pages, sitemapId: 'sm-1', copyArtifactId: 'sm-1' });
    expect(artifact.summary.pageCount).toBe(pages.length);
    expect(artifact.summary.heroBriefCount).toBe(pages.length); // one hero per page
    expect(artifact.summary.briefCount).toBe(pages.reduce((n, p) => n + p.briefs.length, 0));
    expect(artifact.source).toBe('website_copy');
    expect(artifact.sitemapId).toBe('sm-1');
    expect(artifact.copyArtifactId).toBe('sm-1');
  });

  it('test 22 — LLM enrichment overlays text but never overrides safety fields', () => {
    const copyPages = generateAllCopy(sitemap);
    const page = copyPages[0];
    const scaffold = buildPageImageBriefs(page, sitemap);
    const evilResponse = {
      briefs: scaffold.briefs.map((b) => ({
        sectionName: b.sectionName,
        visualObjective: 'ENRICHED objective',
        messageSupported: 'ENRICHED message',
        // Attempt to inject unsafe overrides — must be ignored:
        forbiddenVisuals: [],
        allowTextInImage: true,
        mobileCropNotes: '',
        andyRenderReady: true,
      })),
    };
    const parsed = parseImageBriefResponse(evilResponse, page, sitemap);
    const hero = parsed.briefs.find((b) => b.sectionType === 'hero')!;
    expect(hero.visualObjective).toBe('ENRICHED objective');
    expect(hero.allowTextInImage).toBe(false);
    expect(hero.forbiddenVisuals.length).toBeGreaterThan(0);
    expect(hero.mobileCropNotes.length).toBeGreaterThan(0);
    expect(hero.andyRenderReady).toBe(false);
  });

  it('test 22b — prompt builder asks for JSON and never requests image generation', () => {
    const page = generateAllCopy(sitemap)[0];
    const { system, user } = buildImageBriefPrompt(page, sitemap);
    expect(user).toMatch(/JSON/i);
    expect(`${system} ${user}`).not.toMatch(/generate an image|render an image|dall-?e|midjourney/i);
  });

  it('test 22c — at most one supporting (non-hero) section brief per page', () => {
    generateAllCopy(sitemap).forEach((p) => expect(sectionBriefTargetsFor(p).length).toBeLessThanOrEqual(1));
  });
});

// ── Safety source scans (test 23) ──────────────────────────────────
const LIB = path.join(process.cwd(), 'lib');
const read = (p: string) => fs.readFileSync(path.join(LIB, p), 'utf8');
// Strip line + block comments so guardrail comments (which intentionally name
// forbidden providers like "Flux") do not trigger false positives.
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('safety: pure module import allowlist (test 23)', () => {
  it('lib/website-image-briefs.ts imports ONLY from website-sitemap and website-copy', () => {
    const src = read('website-image-briefs.ts');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    const internal = imports.filter((i) => i.startsWith('@/') || i.startsWith('.'));
    const allowed = new Set(['@/lib/website-sitemap', '@/lib/website-copy']);
    internal.forEach((i) => expect(allowed.has(i)).toBe(true));
  });
});

describe('safety: no image gen / R2 / build / publish / deploy (test 23)', () => {
  const files = ['website-image-briefs.ts', 'website-image-briefs-store.ts'];
  it('no image generation calls', () => {
    files.forEach((f) => {
      expect(readCode(f)).not.toMatch(/modalities|image_config|\bgenerateImage\b|\bflux\b|dall-?e|midjourney/i);
    });
  });
  it('no R2 / cloud upload calls', () => {
    files.forEach((f) => {
      expect(readCode(f)).not.toMatch(/PutObjectCommand|S3Client|r2\.|uploadToR2|cloudflare/i);
    });
  });
  it('no static build / publish / deploy calls', () => {
    files.forEach((f) => {
      expect(readCode(f)).not.toMatch(/buildStaticSite|publishSite|deploy\(|hostgator|vercel|wordpress/i);
    });
  });
  it('no Google scraping / browser automation', () => {
    files.forEach((f) => {
      expect(readCode(f)).not.toMatch(/puppeteer|playwright|google\.com\/search|scrape/i);
    });
  });
  it('no hardcoded local filesystem paths', () => {
    files.forEach((f) => {
      expect(read(f)).not.toMatch(/\/home\/ubuntu|\/Users\//);
    });
  });
});
