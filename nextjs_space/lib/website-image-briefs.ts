/**
 * Milestone 4 — Image-brief generation (PURE logic).
 *
 * Network-free logic that turns an APPROVED sitemap + a draft/approved website
 * COPY artifact into durable, reviewable IMAGE BRIEFS. It:
 *   - enforces the image-brief gate (approved sitemap AND copy artifact),
 *   - builds the per-page brief plan (always a hero brief; section briefs only
 *     where copy/imageNeeds indicate visual support is warranted),
 *   - builds the per-page LLM enrichment prompt,
 *   - parses/normalizes the LLM response onto a deterministic, safe scaffold,
 *   - validates hero requirements, slug/section references, forbidden visuals,
 *     and Don/Andy readiness,
 *   - assembles the website_image_briefs.json artifact.
 *
 * HARD BOUNDARIES (asserted by the M4 safety tests):
 *   - imports ONLY from '@/lib/website-sitemap' and '@/lib/website-copy'
 *     (both pure, network-free modules).
 *   - NEVER generates images, calls an image provider, uploads to R2, builds a
 *     static site, or publishes/deploys. Briefs are DRAFT specs for review.
 *   - `andyRenderReady` defaults to false — nothing here triggers rendering.
 */

import {
  type WebsiteSitemapArtifact,
  type PageType,
  canGenerateCopy,
  formatServiceArea,
} from '@/lib/website-sitemap';
import { type PageCopy } from '@/lib/website-copy';

// ── Types ────────────────────────────────────────────────────────────────

export type ImageBriefStatus =
  | 'draft'
  | 'ready_for_review'
  | 'approved'
  | 'revision_requested'
  | 'failed'
  | 'archived';

export type ImageBriefAssetSource =
  | 'generated_asset'
  | 'customer_asset'
  | 'existing_r2_asset'
  | 'approved_stock';

export type ImageBriefSectionType = 'hero' | 'section';

/** A single image brief for one section of one page. */
export interface ImageBrief {
  briefId: string;
  /** Section name — mirrors the copy/sitemap section, required for traceability. */
  sectionName: string;
  sectionType: ImageBriefSectionType;
  /** The copy message this visual must support. */
  messageSupported: string;
  /** What the image should show (the creative objective). */
  visualObjective: string;
  /** Business-specific creative direction (tone, positioning). */
  businessSpecificDirection: string;
  /** Concrete industry-specific visual details to include. */
  industryDetails: string[];
  /** Local / service-area relevance cues. */
  localDetails: string[];
  /** Forbidden generic visuals (always includes logo-as-hero + baked-in text). */
  forbiddenVisuals: string[];
  /** Preferred source of the eventual asset. */
  assetSourcePreference: ImageBriefAssetSource;
  aspectRatio: string;
  /** Mobile crop guidance (required for hero briefs). */
  mobileCropNotes: string;
  /** Region kept clear for text overlay (required for hero briefs). */
  textSafeZone: string;
  brandFitNotes: string;
  /** True when the brief has enough detail for Don to build a structured contract. */
  donContractReady: boolean;
  /** Always false in M4 — Andy rendering is a later, approval-gated milestone. */
  andyRenderReady: boolean;
  /** Fields still missing before the brief is Don-contract ready. */
  missingFields?: string[];
  /** Explicit, default-false flag — text is NOT baked into the image. */
  allowTextInImage: boolean;
}

export interface PageImageBriefs {
  slug: string;
  pageType: PageType;
  h1: string;
  briefs: ImageBrief[];
}

export interface ImageBriefArtifactSummary {
  pageCount: number;
  briefCount: number;
  heroBriefCount: number;
  generatedAt: string;
}

export interface WebsiteImageBriefArtifact {
  businessId?: string;
  websiteProjectId?: string | null;
  sitemapId: string | null;
  copyArtifactId: string | null;
  source: 'website_copy';
  status: ImageBriefStatus;
  pages: PageImageBriefs[];
  summary: ImageBriefArtifactSummary;
}

// ── Gate ─────────────────────────────────────────────────────────────────

export type ImageBriefGateCode =
  | 'sitemap_missing'
  | 'sitemap_not_approved'
  | 'invalid_h1'
  | 'copy_missing'
  | 'copy_sitemap_mismatch'
  | 'copy_invalid_status'
  | 'no_pages'
  | 'ok';

export interface ImageBriefGateResult {
  allowed: boolean;
  code: ImageBriefGateCode;
  reason: string;
}

/** Copy-artifact reference passed to the gate + generator (from the store). */
export interface CopyArtifactForBriefs {
  sitemapId: string | null;
  status?: string;
  pages: PageCopy[];
}

const COPY_STATUSES_OK = new Set(['draft', 'ready_for_review', 'approved']);

/**
 * The image-brief gate. Briefs are NEVER produced unless:
 *  - the latest sitemap exists, is approved, and has valid H1s, AND
 *  - a website copy artifact exists for that sitemap, belongs to it, has an
 *    acceptable status, and every page carries a slug + pageType.
 */
export function canGenerateImageBriefs(
  sitemap: WebsiteSitemapArtifact | null,
  copy: CopyArtifactForBriefs | null,
  opts?: { sitemapId?: string | null },
): ImageBriefGateResult {
  const copyGate = canGenerateCopy(sitemap);
  if (!copyGate.allowed) {
    const code = (copyGate.code as ImageBriefGateCode) || 'sitemap_not_approved';
    return { allowed: false, code, reason: copyGate.reason };
  }
  if (!copy || !Array.isArray(copy.pages) || copy.pages.length === 0) {
    return {
      allowed: false,
      code: 'copy_missing',
      reason: 'Website copy must be generated before image briefs.',
    };
  }
  if (copy.status && !COPY_STATUSES_OK.has(copy.status)) {
    return {
      allowed: false,
      code: 'copy_invalid_status',
      reason: `Copy status "${copy.status}" is not eligible for image briefs.`,
    };
  }
  const expectedSitemapId = opts?.sitemapId ?? null;
  if (expectedSitemapId && copy.sitemapId && copy.sitemapId !== expectedSitemapId) {
    return {
      allowed: false,
      code: 'copy_sitemap_mismatch',
      reason: 'Copy artifact does not belong to the approved sitemap.',
    };
  }
  const everyPageValid = copy.pages.every((p) => p && p.slug && p.pageType);
  if (!everyPageValid) {
    return {
      allowed: false,
      code: 'no_pages',
      reason: 'Every copy page must have a slug and pageType.',
    };
  }
  return { allowed: true, code: 'ok', reason: 'Approved sitemap + copy artifact present.' };
}

// ── Forbidden visuals + section heuristics ─────────────────────────────────

/** Generic forbidden visuals applied to every brief. */
export const BASE_FORBIDDEN_VISUALS: string[] = [
  'giant faded logo watermark',
  'generic stock photo with no service context',
  'text baked into the image',
  'random luxury showroom unrelated to the service',
  'plain solid-color background with no subject',
  'unsafe or unrealistic work behavior',
];

/** Additional forbidden visuals specific to hero images. */
export const HERO_FORBIDDEN_VISUALS: string[] = [
  'business logo used as the hero background (logo-as-hero)',
  'giant faded logo watermark covering the hero',
];

/** Section names that genuinely warrant a supporting (non-hero) image. */
const VISUAL_SECTION_KEYWORDS = [
  'service',
  'services',
  'process',
  'how it works',
  'gallery',
  'results',
  'work',
  'team',
  'about',
  'why',
  'feature',
  'before',
  'after',
  'shop',
  'facility',
  'bay',
  'showcase',
];

function isHeroSectionName(name: string): boolean {
  return /hero|banner|masthead/i.test(name || '');
}

function sectionWarrantsImage(name: string): boolean {
  const lc = (name || '').toLowerCase();
  return VISUAL_SECTION_KEYWORDS.some((k) => lc.includes(k));
}

function lc(s: string): string {
  return (s || '').toLowerCase().trim();
}

function subjectFor(page: PageCopy, sitemap: WebsiteSitemapArtifact): string {
  if (page.pageType === 'service_detail') {
    // Prefer the sitemap page serviceName; fall back to a cleaned H1.
    const match = sitemap.pages.find((p) => p.slug === page.slug);
    return match?.serviceName || page.h1 || sitemap.industry;
  }
  if (page.pageType === 'service_hub') return `${sitemap.industry} services`;
  if (page.pageType === 'home') return `${sitemap.businessName} (${sitemap.industry})`;
  return page.h1 || sitemap.industry;
}

// ── Deterministic brief scaffold ───────────────────────────────────────────

function localDetailsFor(sitemap: WebsiteSitemapArtifact): string[] {
  const label = formatServiceArea(sitemap.primaryServiceArea, sitemap.serviceAreaMode);
  const details: string[] = [];
  if (label) {
    details.push(label);
    details.push(`${label} service area`);
  }
  return details;
}

function industryDetailsFor(subject: string, sitemap: WebsiteSitemapArtifact): string[] {
  const s = lc(subject);
  const ind = lc(sitemap.industry) || 'service';
  return [
    `${s} being performed by a professional`,
    `real tools and equipment used for ${s}`,
    `authentic ${ind} work environment`,
  ];
}

function makeBriefId(slug: string, sectionName: string, type: ImageBriefSectionType): string {
  const base = `${slug}::${sectionName}::${type}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `brief-${base}`;
}

/**
 * Build a deterministic, complete, SAFE brief scaffold for a section. LLM output
 * (when present) overlays only the descriptive text fields — the safety fields
 * (forbidden visuals, text-safe zone, mobile crop notes) are always enforced.
 */
function scaffoldBrief(
  page: PageCopy,
  sitemap: WebsiteSitemapArtifact,
  sectionName: string,
  type: ImageBriefSectionType,
): ImageBrief {
  const subject = subjectFor(page, sitemap);
  const isHero = type === 'hero';
  const areaLabel = formatServiceArea(sitemap.primaryServiceArea, sitemap.serviceAreaMode);
  const forbidden = isHero
    ? [...HERO_FORBIDDEN_VISUALS, ...BASE_FORBIDDEN_VISUALS]
    : [...BASE_FORBIDDEN_VISUALS];

  return {
    briefId: makeBriefId(page.slug, sectionName, type),
    sectionName,
    sectionType: type,
    messageSupported: isHero
      ? page.heroSubheadline || page.heroHeadline || page.h1
      : page.sections.find((s) => lc(s.name) === lc(sectionName))?.heading ||
        page.sections.find((s) => lc(s.name) === lc(sectionName))?.body?.slice(0, 140) ||
        page.h1,
    visualObjective: `Show a technician/professional actively performing ${lc(subject)} in a real, professional ${lc(
      sitemap.industry,
    )} setting${areaLabel ? ` relevant to ${areaLabel}` : ''} — not a posed or generic stock photo.`,
    businessSpecificDirection: `Reflect ${sitemap.businessName}'s local, independent ${lc(
      sitemap.industry,
    )} character; trustworthy and approachable, not a corporate/dealership look.`,
    industryDetails: industryDetailsFor(subject, sitemap),
    localDetails: localDetailsFor(sitemap),
    forbiddenVisuals: forbidden,
    assetSourcePreference: 'generated_asset',
    aspectRatio: isHero ? '16:9' : '4:3',
    mobileCropNotes: `Keep the main subject (${lc(
      subject,
    )}) centered and unobstructed; avoid cropping key details on narrow mobile viewports.`,
    textSafeZone: isHero
      ? 'Left third kept clear for the headline and CTA overlay.'
      : 'No text overlay expected; keep the subject centered.',
    brandFitNotes: `Professional, trustworthy, local ${lc(
      sitemap.industry,
    )} tone consistent with ${sitemap.businessName}.`,
    donContractReady: false, // recomputed by finalizeBrief
    andyRenderReady: false,
    allowTextInImage: false,
  };
}

/** Fields required for a brief to be considered Don-contract ready. */
function computeReadiness(brief: ImageBrief): { donContractReady: boolean; missingFields: string[] } {
  const missing: string[] = [];
  if (!brief.visualObjective) missing.push('visualObjective');
  if (!brief.messageSupported) missing.push('messageSupported');
  if (!brief.industryDetails.length) missing.push('industryDetails');
  if (!brief.forbiddenVisuals.length) missing.push('forbiddenVisuals');
  if (!brief.aspectRatio) missing.push('aspectRatio');
  if (!brief.brandFitNotes) missing.push('brandFitNotes');
  if (brief.sectionType === 'hero') {
    if (!brief.mobileCropNotes) missing.push('mobileCropNotes');
    if (!brief.textSafeZone) missing.push('textSafeZone');
  }
  return { donContractReady: missing.length === 0, missingFields: missing };
}

function finalizeBrief(brief: ImageBrief): ImageBrief {
  const { donContractReady, missingFields } = computeReadiness(brief);
  return {
    ...brief,
    donContractReady,
    // M4 never approves rendering — Andy readiness stays false regardless.
    andyRenderReady: false,
    missingFields: missingFields.length ? missingFields : undefined,
  };
}

// ── Per-page brief plan ────────────────────────────────────────────────────

/** Section names (excluding hero) that should receive a supporting brief. */
export function sectionBriefTargetsFor(page: PageCopy): string[] {
  const names = (page.sections || []).map((s) => s.name).filter((n) => !isHeroSectionName(n));
  const warranted = names.filter((n) => sectionWarrantsImage(n));
  // Avoid over-generating: at most one supporting section brief per page.
  return warranted.slice(0, 1);
}

/**
 * Build the complete, validated set of briefs for one page: always exactly one
 * hero brief, plus at most one warranted supporting section brief.
 */
export function buildPageImageBriefs(
  page: PageCopy,
  sitemap: WebsiteSitemapArtifact,
): PageImageBriefs {
  const heroSection =
    (page.sections || []).find((s) => isHeroSectionName(s.name))?.name || 'Hero';
  const briefs: ImageBrief[] = [finalizeBrief(scaffoldBrief(page, sitemap, heroSection, 'hero'))];
  for (const name of sectionBriefTargetsFor(page)) {
    briefs.push(finalizeBrief(scaffoldBrief(page, sitemap, name, 'section')));
  }
  return { slug: page.slug, pageType: page.pageType, h1: page.h1, briefs };
}

// ── LLM enrichment prompt ──────────────────────────────────────────────────

export interface ImageBriefContext {
  businessSummary?: string;
}

export interface BuiltImageBriefPrompt {
  system: string;
  user: string;
}

/**
 * Build a per-page prompt asking the model to ENRICH the descriptive fields of
 * each brief. Safety fields are enforced deterministically and are NOT delegated
 * to the model. The model never produces images or asset URLs.
 */
export function buildImageBriefPrompt(
  page: PageCopy,
  sitemap: WebsiteSitemapArtifact,
  context?: ImageBriefContext,
): BuiltImageBriefPrompt {
  const heroSection =
    (page.sections || []).find((s) => isHeroSectionName(s.name))?.name || 'Hero';
  const sectionTargets = [heroSection, ...sectionBriefTargetsFor(page)];
  const areaLabel = formatServiceArea(sitemap.primaryServiceArea, sitemap.serviceAreaMode);

  const system = [
    'You are an expert art director writing IMAGE BRIEFS for a local-business website.',
    'You describe what a photograph/illustration should show — you do NOT generate images.',
    'Every brief must be specific to the real business, service, and local area.',
    'Never suggest logo-as-hero, giant watermarks, baked-in text, or generic stock imagery.',
    'Return STRICT JSON only, matching the requested schema. No markdown, no commentary.',
  ].join(' ');

  const shape = {
    briefs:
      '[{ sectionName, messageSupported, visualObjective, businessSpecificDirection, industryDetails: string[], localDetails: string[] }]',
  };

  const userLines = [
    `Business: ${sitemap.businessName}`,
    `Industry: ${sitemap.industry}`,
    areaLabel ? `Service area: ${areaLabel} (mode: ${sitemap.serviceAreaMode})` : `Service area mode: ${sitemap.serviceAreaMode}`,
    context?.businessSummary ? `Business summary: ${context.businessSummary}` : '',
    '',
    `Page: ${page.h1} (type: ${page.pageType}, slug: ${page.slug})`,
    `Hero headline: ${page.heroHeadline}`,
    `Hero subheadline: ${page.heroSubheadline}`,
    `Write one brief per section (in order): ${sectionTargets.join(', ')}`,
    'For each brief describe the visual objective, the message it supports, business-specific direction, concrete industry details, and local relevance.',
    'Do NOT include forbidden visuals, aspect ratio, text-safe zone, or mobile crop notes — those are set by the system.',
    '',
    `Return JSON: ${JSON.stringify(shape)}`,
  ];

  return { system, user: userLines.filter((l) => l !== '').join('\n') };
}

// ── Response parsing / normalization ───────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}

/**
 * Parse an LLM enrichment response onto the deterministic scaffold. The safety
 * fields (forbiddenVisuals, aspectRatio, textSafeZone, mobileCropNotes,
 * assetSourcePreference, readiness) always come from the scaffold; only the
 * descriptive text fields are overlaid from the model when present.
 */
export function parseImageBriefResponse(
  raw: any,
  page: PageCopy,
  sitemap: WebsiteSitemapArtifact,
): PageImageBriefs {
  const scaffold = buildPageImageBriefs(page, sitemap);
  const rawBriefs: any[] = raw && Array.isArray(raw.briefs) ? raw.briefs : [];
  const briefs = scaffold.briefs.map((base, i) => {
    const match =
      rawBriefs.find((b) => lc(str(b?.sectionName)) === lc(base.sectionName)) || rawBriefs[i] || {};
    const overlaid: ImageBrief = {
      ...base,
      messageSupported: str(match?.messageSupported) || base.messageSupported,
      visualObjective: str(match?.visualObjective) || base.visualObjective,
      businessSpecificDirection:
        str(match?.businessSpecificDirection) || base.businessSpecificDirection,
      industryDetails: strArr(match?.industryDetails).length
        ? strArr(match?.industryDetails)
        : base.industryDetails,
      localDetails: strArr(match?.localDetails).length ? strArr(match?.localDetails) : base.localDetails,
      // Safety fields are NEVER taken from the model.
      forbiddenVisuals: base.forbiddenVisuals,
      textSafeZone: base.textSafeZone,
      mobileCropNotes: base.mobileCropNotes,
      assetSourcePreference: base.assetSourcePreference,
      allowTextInImage: false,
    };
    return finalizeBrief(overlaid);
  });
  return { slug: page.slug, pageType: page.pageType, h1: page.h1, briefs };
}

// ── Validation ─────────────────────────────────────────────────────────────

export type ImageBriefIssueKind =
  | 'missing_hero_brief'
  | 'brief_missing_slug'
  | 'brief_missing_section_name'
  | 'hero_missing_mobile_crop'
  | 'hero_missing_text_safe_zone'
  | 'missing_forbidden_visuals'
  | 'logo_as_hero_not_forbidden'
  | 'text_in_image_not_approved'
  | 'andy_ready_without_fields';

export interface ImageBriefIssue {
  slug: string;
  briefId?: string;
  kind: ImageBriefIssueKind;
  reason: string;
}

/** Validate all page briefs against the M4 requirements. */
export function validateImageBriefs(pages: PageImageBriefs[]): ImageBriefIssue[] {
  const issues: ImageBriefIssue[] = [];
  for (const page of pages) {
    const heroes = page.briefs.filter((b) => b.sectionType === 'hero');
    if (heroes.length === 0) {
      issues.push({
        slug: page.slug,
        kind: 'missing_hero_brief',
        reason: 'Every page must have at least one hero image brief.',
      });
    }
    for (const b of page.briefs) {
      if (!page.slug) {
        issues.push({ slug: page.slug, briefId: b.briefId, kind: 'brief_missing_slug', reason: 'Brief must reference a page slug.' });
      }
      if (!b.sectionName) {
        issues.push({ slug: page.slug, briefId: b.briefId, kind: 'brief_missing_section_name', reason: 'Brief must reference a section name.' });
      }
      if (!b.forbiddenVisuals || b.forbiddenVisuals.length === 0) {
        issues.push({ slug: page.slug, briefId: b.briefId, kind: 'missing_forbidden_visuals', reason: 'Brief must list forbidden generic visuals.' });
      }
      if (b.allowTextInImage) {
        issues.push({ slug: page.slug, briefId: b.briefId, kind: 'text_in_image_not_approved', reason: 'Text baked into image is not approved.' });
      }
      if (b.andyRenderReady) {
        const { donContractReady } = computeReadiness(b);
        if (!donContractReady) {
          issues.push({ slug: page.slug, briefId: b.briefId, kind: 'andy_ready_without_fields', reason: 'Andy-render-ready requires all contract fields.' });
        }
      }
      if (b.sectionType === 'hero') {
        if (!b.mobileCropNotes) {
          issues.push({ slug: page.slug, briefId: b.briefId, kind: 'hero_missing_mobile_crop', reason: 'Hero brief must include mobile crop notes.' });
        }
        if (!b.textSafeZone) {
          issues.push({ slug: page.slug, briefId: b.briefId, kind: 'hero_missing_text_safe_zone', reason: 'Hero brief must include a text-safe zone.' });
        }
        const forbidsLogoHero = (b.forbiddenVisuals || []).some((f) => /logo/i.test(f));
        if (!forbidsLogoHero) {
          issues.push({ slug: page.slug, briefId: b.briefId, kind: 'logo_as_hero_not_forbidden', reason: 'Hero brief must forbid logo-as-hero.' });
        }
      }
    }
  }
  return issues;
}

// ── Artifact assembly ──────────────────────────────────────────────────────

export function buildImageBriefArtifact(params: {
  pages: PageImageBriefs[];
  sitemapId: string | null;
  copyArtifactId: string | null;
  businessId?: string;
  websiteProjectId?: string | null;
  status?: ImageBriefStatus;
  generatedAt?: string;
}): WebsiteImageBriefArtifact {
  const { pages, sitemapId, copyArtifactId, businessId, websiteProjectId } = params;
  const briefCount = pages.reduce((n, p) => n + p.briefs.length, 0);
  const heroBriefCount = pages.reduce(
    (n, p) => n + p.briefs.filter((b) => b.sectionType === 'hero').length,
    0,
  );
  const issues = validateImageBriefs(pages);
  const status: ImageBriefStatus =
    params.status || (issues.length ? 'ready_for_review' : 'ready_for_review');
  return {
    businessId,
    websiteProjectId: websiteProjectId ?? null,
    sitemapId,
    copyArtifactId,
    source: 'website_copy',
    status,
    pages,
    summary: {
      pageCount: pages.length,
      briefCount,
      heroBriefCount,
      generatedAt: params.generatedAt || new Date().toISOString(),
    },
  };
}
