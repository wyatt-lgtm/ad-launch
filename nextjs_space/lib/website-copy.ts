/**
 * Milestone 3 — Copy generation (PURE logic).
 *
 * This module contains ONLY pure, network-free logic for generating website
 * page copy AFTER a sitemap has been approved. It:
 *   - builds the ordered per-page copy plan (confirmed service pages only),
 *   - builds the per-page LLM prompt,
 *   - parses & normalizes the LLM response into a strict PageCopy shape,
 *   - validates required fields,
 *   - detects duplicated copy across pages (uniqueness gate),
 *   - derives text-only image NEED notes from sitemap sections.
 *
 * HARD BOUNDARIES (asserted by the M3 safety tests):
 *   - imports ONLY from '@/lib/website-sitemap'.
 *   - NEVER performs image generation, image briefs materialization, static
 *     build, publish, or deploy. `imageNeeds` are plain descriptive notes for a
 *     later milestone; nothing here produces or requests an image.
 *   - Generated copy is DRAFT for user review; it is not auto-approved and does
 *     not mark any production site complete.
 *
 * The copy gate itself (`canGenerateCopy`) lives in '@/lib/website-sitemap' and
 * is reused here — copy must never be produced for an unapproved sitemap.
 */

import {
  type WebsiteSitemapArtifact,
  type SitemapPage,
  type PageType,
  type PrimaryServiceArea,
  formatServiceArea,
} from '@/lib/website-sitemap';

// ── Types ────────────────────────────────────────────────────────────────

/** A single content section of a page (unique body copy per section). */
export interface PageCopySection {
  /** Section name, mirrored from the sitemap page section list where possible. */
  name: string;
  /** Optional short heading rendered above the section body. */
  heading?: string;
  /** The unique body copy for this section. */
  body: string;
}

export interface PageCopyFaq {
  question: string;
  answer: string;
}

/** An internal link recommendation between pages of the same site. */
export interface PageCopyInternalLink {
  slug: string;
  label: string;
}

/**
 * A text-only image NEED note for a section. This is NOT an image brief and it
 * NEVER triggers image generation — it is a descriptive placeholder consumed by
 * a later milestone.
 */
export interface PageCopyImageNeed {
  section: string;
  note: string;
}

export type CopyStage = 'draft';

/** Full, validated copy for one page. */
export interface PageCopy {
  slug: string;
  pageType: PageType;
  /** Authoritative H1 — copied from the approved sitemap, never re-invented. */
  h1: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubheadline: string;
  primaryCta: string;
  secondaryCta?: string;
  /** Unique per-section body copy. */
  sections: PageCopySection[];
  faqs: PageCopyFaq[];
  internalLinks: PageCopyInternalLink[];
  /** Local service-area language line (empty for national businesses). */
  serviceAreaLine: string;
  /** Text-only image needs by section (no image generation). */
  imageNeeds: PageCopyImageNeed[];
  /** Read-only linkage to an approved SEO page brief (WF3), if one existed. */
  seoBriefId?: string;
  /** 'approved' when an approved brief informed this page; otherwise 'missing'. */
  seoBriefStatus: 'approved' | 'missing';
  /** Always 'draft' in this milestone — copy is for review, not published. */
  stage: CopyStage;
}

export interface WebsiteCopyArtifact {
  businessName: string;
  industry: string;
  pages: PageCopy[];
  generatedAt: string;
  stage: CopyStage;
}

// ── Copy plan ────────────────────────────────────────────────────────────

/** Page types that receive generated copy, in canonical rendering order. */
const PAGE_TYPE_ORDER: PageType[] = [
  'home',
  'service_hub',
  'service_detail',
  'location',
  'comparison',
  'custom',
  'other',
];

/**
 * A service_detail page is eligible for copy only when it is a CONFIRMED
 * service. Non-service pages are always eligible. This mirrors the master
 * spec rule: "Do not generate service pages for unconfirmed services."
 */
export function isPageEligibleForCopy(page: SitemapPage): boolean {
  if (page.pageType === 'service_detail') {
    return page.confirmationStatus === 'confirmed';
  }
  return true;
}

/**
 * Build the ordered list of pages that should receive copy. Confirmed service
 * detail pages only; ordered by canonical page-type order then sitemap
 * sortOrder. Optionally restrict to a set of slugs (per-page regeneration).
 */
export function buildCopyPlan(
  sitemap: WebsiteSitemapArtifact,
  opts?: { slugs?: string[] },
): SitemapPage[] {
  const restrict = opts?.slugs && opts.slugs.length > 0 ? new Set(opts.slugs) : null;
  return [...(sitemap.pages || [])]
    .filter((p) => isPageEligibleForCopy(p))
    .filter((p) => (restrict ? restrict.has(p.slug) : true))
    .sort((a, b) => {
      const ai = PAGE_TYPE_ORDER.indexOf(a.pageType);
      const bi = PAGE_TYPE_ORDER.indexOf(b.pageType);
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
}

// ── Internal links & image needs (pure derivations) ───────────────────────

/**
 * Compute internal-link targets for a page. Service detail pages link to their
 * parent hub + sibling confirmed services; the hub links to its children; the
 * home page links to the hub. Contact/CTA links are left to the renderer.
 */
export function internalLinkTargetsFor(
  page: SitemapPage,
  sitemap: WebsiteSitemapArtifact,
): PageCopyInternalLink[] {
  const links: PageCopyInternalLink[] = [];
  const bySlug = new Map(sitemap.pages.map((p) => [p.slug, p]));
  const push = (slug?: string) => {
    if (!slug || slug === page.slug) return;
    const target = bySlug.get(slug);
    if (target && !links.some((l) => l.slug === slug)) {
      links.push({ slug, label: target.title });
    }
  };

  if (page.pageType === 'service_detail') {
    push(page.parentSlug);
    // sibling confirmed service pages under the same parent
    sitemap.pages
      .filter(
        (p) =>
          p.pageType === 'service_detail' &&
          p.parentSlug === page.parentSlug &&
          p.confirmationStatus === 'confirmed',
      )
      .slice(0, 4)
      .forEach((p) => push(p.slug));
  } else if (page.pageType === 'service_hub') {
    (page.childPages || []).forEach((slug) => push(slug));
  } else if (page.pageType === 'home') {
    sitemap.pages.filter((p) => p.pageType === 'service_hub').forEach((p) => push(p.slug));
  }
  return links;
}

/** Derive text-only image NEED notes from a page's sitemap sections. */
export function imageNeedsFor(page: SitemapPage): PageCopyImageNeed[] {
  return (page.sections || []).map((section) => ({
    section,
    note: `Image supporting the "${section}" section of "${page.title}". Descriptive note only — no image is generated in this milestone.`,
  }));
}

// ── Prompt building ────────────────────────────────────────────────────────

export interface PageCopyContext {
  /** Optional approved SEO page-brief context (read-only), if one exists. */
  seoBrief?: {
    id?: string;
    targetKeyword?: string;
    metaTitle?: string;
    metaDescription?: string;
    differentiationAngle?: string;
    faqQuestions?: string[];
  } | null;
  /** Optional business description / positioning to ground the copy. */
  businessSummary?: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

function serviceAreaLineFor(
  area: PrimaryServiceArea,
  mode: WebsiteSitemapArtifact['serviceAreaMode'],
): string {
  const label = formatServiceArea(area, mode);
  return label ? `Proudly serving ${label} and the surrounding area.` : '';
}

/**
 * Build the per-page LLM prompt. The H1, slug, service area and section list are
 * fixed inputs from the approved sitemap; the model fills unique copy. The
 * prompt forbids reusing generic templated body copy across services.
 */
export function buildPageCopyPrompt(
  sitemap: WebsiteSitemapArtifact,
  page: SitemapPage,
  context?: PageCopyContext,
): BuiltPrompt {
  const areaLabel = formatServiceArea(sitemap.primaryServiceArea, sitemap.serviceAreaMode);
  const links = internalLinkTargetsFor(page, sitemap);
  const brief = context?.seoBrief;

  const system = [
    'You are an expert local-business website copywriter.',
    'Write specific, conversion-focused copy grounded in the real business, industry, and service area provided.',
    'Every page must be UNIQUE — never reuse the same body copy across services with only the service name swapped.',
    'Explain the specific service, the customer problem, the business process, local relevance, FAQs, related services, and CTAs.',
    'Do not invent services, awards, certifications, prices, or guarantees that are not implied by the inputs.',
    'Return STRICT JSON only, matching the requested schema. No markdown, no commentary.',
  ].join(' ');

  const requiredShape = {
    metaTitle: 'string (<= 60 chars, page-specific)',
    metaDescription: 'string (<= 160 chars, page-specific)',
    heroHeadline: 'string',
    heroSubheadline: 'string',
    primaryCta: 'string (short button label)',
    secondaryCta: 'string (short button label, optional)',
    sections: '[{ name, heading, body }] — one entry per provided section, each body UNIQUE and specific',
    faqs: '[{ question, answer }] — 3 to 5 service/industry-specific Q&A',
  };

  const userLines: string[] = [
    `Business: ${sitemap.businessName}`,
    `Industry: ${sitemap.industry}`,
    `Website goal: ${sitemap.websiteGoal || 'lead generation'}`,
    areaLabel ? `Service area: ${areaLabel} (mode: ${sitemap.serviceAreaMode})` : `Service area mode: ${sitemap.serviceAreaMode}`,
    context?.businessSummary ? `Business summary: ${context.businessSummary}` : '',
    '',
    `Page title: ${page.title}`,
    `Page type: ${page.pageType}`,
    page.serviceName ? `Service: ${page.serviceName}` : '',
    `Slug: ${page.slug}`,
    `H1 (FIXED — reflect this exactly, do not restate it as a heading in sections): ${page.h1 || page.title}`,
    `Sections to write (one body each, in this order): ${(page.sections || []).join(', ') || 'Hero, CTA'}`,
    links.length ? `Related internal links to weave in naturally: ${links.map((l) => `${l.label} (${l.slug})`).join('; ')}` : '',
    '',
    brief ? 'Approved SEO page brief context (align with this, do not contradict):' : '',
    brief?.targetKeyword ? `- Target keyword: ${brief.targetKeyword}` : '',
    brief?.metaTitle ? `- Suggested meta title: ${brief.metaTitle}` : '',
    brief?.metaDescription ? `- Suggested meta description: ${brief.metaDescription}` : '',
    brief?.differentiationAngle ? `- Differentiation angle: ${brief.differentiationAngle}` : '',
    brief?.faqQuestions?.length ? `- Suggested FAQ questions: ${brief.faqQuestions.join(' | ')}` : '',
    '',
    `Return JSON with exactly these keys: ${JSON.stringify(requiredShape)}`,
  ];

  return { system, user: userLines.filter((l) => l !== '').join('\n') };
}

// ── Response parsing / normalization ───────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parse a raw LLM JSON object into a strict PageCopy. The H1, slug, pageType,
 * service-area line, internal links, and image needs are taken from the sitemap
 * (authoritative) — never from the model. Missing optional fields default
 * safely. Returns a PageCopy even if some model fields are empty; use
 * `validatePageCopy` to gate persistence.
 */
export function parsePageCopyResponse(
  raw: any,
  page: SitemapPage,
  sitemap: WebsiteSitemapArtifact,
  context?: PageCopyContext,
): PageCopy {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const rawSections: any[] = Array.isArray(obj.sections) ? obj.sections : [];
  const sectionNames = page.sections && page.sections.length ? page.sections : ['Hero', 'CTA'];

  // Map model sections onto the fixed sitemap section list, preserving order.
  const sections: PageCopySection[] = sectionNames.map((name, i) => {
    const match =
      rawSections.find((s) => str(s?.name).toLowerCase() === name.toLowerCase()) ||
      rawSections[i] ||
      {};
    return {
      name,
      heading: str(match?.heading) || undefined,
      body: str(match?.body),
    };
  });

  const faqs: PageCopyFaq[] = (Array.isArray(obj.faqs) ? obj.faqs : [])
    .map((f: any) => ({ question: str(f?.question), answer: str(f?.answer) }))
    .filter((f: PageCopyFaq) => f.question && f.answer);

  return {
    slug: page.slug,
    pageType: page.pageType,
    h1: page.h1 || page.title,
    metaTitle: str(obj.metaTitle) || page.title,
    metaDescription: str(obj.metaDescription),
    heroHeadline: str(obj.heroHeadline) || (page.h1 || page.title),
    heroSubheadline: str(obj.heroSubheadline),
    primaryCta: str(obj.primaryCta) || 'Get a Free Quote',
    secondaryCta: str(obj.secondaryCta) || undefined,
    sections,
    faqs,
    internalLinks: internalLinkTargetsFor(page, sitemap),
    serviceAreaLine: serviceAreaLineFor(sitemap.primaryServiceArea, sitemap.serviceAreaMode),
    imageNeeds: imageNeedsFor(page),
    seoBriefId: context?.seoBrief?.id,
    seoBriefStatus: context?.seoBrief ? 'approved' : 'missing',
    stage: 'draft',
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

export type PageCopyIssueKind =
  | 'missing_meta_title'
  | 'missing_meta_description'
  | 'missing_hero_headline'
  | 'missing_primary_cta'
  | 'empty_section_body'
  | 'no_faqs';

export interface PageCopyIssue {
  slug: string;
  kind: PageCopyIssueKind;
  reason: string;
}

/** Validate that a page's copy has all required fields populated. */
export function validatePageCopy(copy: PageCopy): PageCopyIssue[] {
  const issues: PageCopyIssue[] = [];
  const add = (kind: PageCopyIssueKind, reason: string) => issues.push({ slug: copy.slug, kind, reason });
  if (!copy.metaTitle) add('missing_meta_title', 'Meta title is required.');
  if (!copy.metaDescription) add('missing_meta_description', 'Meta description is required.');
  if (!copy.heroHeadline) add('missing_hero_headline', 'Hero headline is required.');
  if (!copy.primaryCta) add('missing_primary_cta', 'Primary CTA is required.');
  if (copy.sections.some((s) => !s.body)) add('empty_section_body', 'One or more sections have empty body copy.');
  if (copy.faqs.length === 0) add('no_faqs', 'At least one FAQ is required.');
  return issues;
}

export interface CopyUniquenessIssue {
  slugA: string;
  slugB: string;
  reason: string;
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Detect duplicated copy across pages. Flags pages whose combined section body
 * text is identical (after normalization) — the classic "same generic body with
 * only the service name swapped" failure mode.
 */
export function validateCopyUniqueness(pages: PageCopy[]): CopyUniquenessIssue[] {
  const issues: CopyUniquenessIssue[] = [];
  const bodies = pages.map((p) => ({
    slug: p.slug,
    text: normalizeForCompare(p.sections.map((s) => s.body).join(' ')),
  }));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i].text && bodies[i].text === bodies[j].text) {
        issues.push({
          slugA: bodies[i].slug,
          slugB: bodies[j].slug,
          reason: 'Two pages have identical body copy; each page must be unique.',
        });
      }
    }
  }
  return issues;
}

/** Assemble a WebsiteCopyArtifact from generated pages. */
export function buildCopyArtifact(
  sitemap: WebsiteSitemapArtifact,
  pages: PageCopy[],
  generatedAt?: string,
): WebsiteCopyArtifact {
  return {
    businessName: sitemap.businessName,
    industry: sitemap.industry,
    pages,
    generatedAt: generatedAt || new Date().toISOString(),
    stage: 'draft',
  };
}
