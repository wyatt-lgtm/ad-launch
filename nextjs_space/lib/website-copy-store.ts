/**
 * Milestone 3 — Copy generation persistence + orchestration.
 *
 * Business-scoped persistence over the additive WebsitePageCopy model plus the
 * gated, page-by-page copy generation orchestration.
 *
 * HARD GATE: copy is NEVER generated unless the latest sitemap for the business
 * exists, is approved, and has valid H1s (`canGenerateCopy`). The gate is
 * checked here AND at the API layer.
 *
 * BOUNDARIES: NO image generation, NO image briefs materialization, NO static
 * build, NO publish, NO deploy. Reads of Business / Industry / SeoPageBrief are
 * READ-ONLY, used only to ground the copy. The only network call is the
 * OpenAI-compatible LLM used to write page copy.
 */
import { prisma } from '@/lib/db';
import {
  type WebsiteSitemapArtifact,
  type SitemapPage,
  canGenerateCopy,
  type CopyGateResult,
} from '@/lib/website-sitemap';
import {
  type PageCopy,
  type WebsiteCopyArtifact,
  type PageCopyContext,
  type CopyUniquenessIssue,
  type PageCopyIssue,
  buildCopyPlan,
  buildPageCopyPrompt,
  parsePageCopyResponse,
  validatePageCopy,
  validateCopyUniqueness,
  buildCopyArtifact,
} from '@/lib/website-copy';
import { loadLatestSitemap } from '@/lib/website-sitemap-store';

// ── LLM helper (OpenAI-compatible Abacus RouteLLM) ─────────────────────────
const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';
const MODEL = 'claude-sonnet-4-6';

export function isCopyLlmConfigured(): boolean {
  return Boolean(process.env.ABACUSAI_API_KEY);
}

async function callCopyLlm(system: string, user: string, maxTokens = 2600): Promise<any | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API not configured');
  let res: Response;
  try {
    res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    console.error('[website-copy] LLM fetch failed:', err);
    return null;
  }
  if (!res.ok) {
    console.error('[website-copy] LLM error:', await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

// ── Read-only grounding context ───────────────────────────────────────
async function loadBusinessSummary(businessId: string): Promise<string | undefined> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      businessName: true,
      businessCity: true,
      businessState: true,
      contentProfile: { select: { industry: true, brandVoiceSummary: true } },
    },
  }).catch(() => null);
  if (!business) return undefined;
  const parts = [
    business.businessName,
    business.contentProfile?.industry,
    [business.businessCity, business.businessState].filter(Boolean).join(', '),
    business.contentProfile?.brandVoiceSummary,
  ].filter(Boolean);
  return parts.join(' — ') || undefined;
}

/**
 * Load an approved SEO page brief for a slug, READ-ONLY, if one exists. Used to
 * align generated copy with WF3/Search Intelligence work without bypassing it.
 */
async function loadSeoBriefContext(
  businessId: string,
  slug: string,
): Promise<PageCopyContext['seoBrief']> {
  const brief = await prisma.seoPageBrief
    .findFirst({
      where: { businessId, recommendedSlug: slug, status: { in: ['approved', 'used_in_page'] } },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => null);
  if (!brief) return null;
  const faqs = Array.isArray(brief.recommendedFaqsJson as any)
    ? ((brief.recommendedFaqsJson as any[]).map((f) => (typeof f === 'string' ? f : f?.question)).filter(Boolean) as string[])
    : undefined;
  return {
    id: brief.id,
    metaTitle: brief.recommendedMetaTitle || undefined,
    metaDescription: brief.recommendedMetaDescription || undefined,
    differentiationAngle: brief.differentiationAngle || undefined,
    faqQuestions: faqs,
  };
}

// ── Persistence ────────────────────────────────────────────────────
async function savePageCopy(params: {
  businessId: string;
  websiteProjectId?: string | null;
  sitemapId: string;
  copy: PageCopy;
  generatedByUserId?: string | null;
}) {
  const { businessId, websiteProjectId, sitemapId, copy, generatedByUserId } = params;
  return prisma.websitePageCopy.create({
    data: {
      businessId,
      websiteProjectId: websiteProjectId ?? null,
      sitemapId,
      slug: copy.slug,
      pageType: copy.pageType,
      h1: copy.h1,
      stage: copy.stage,
      status: 'draft',
      copyJson: copy as any,
      generatedByUserId: generatedByUserId ?? null,
    },
  });
}

/**
 * Load the latest generated copy for a business as an artifact. Returns the most
 * recent row per slug (business-scoped). When `sitemapId` is provided, only copy
 * generated from that sitemap is returned.
 */
export async function loadWebsiteCopy(
  businessId: string,
  sitemapId?: string | null,
): Promise<{ sitemapId: string | null; pages: PageCopy[]; generatedAt: string | null }> {
  const rows = await prisma.websitePageCopy.findMany({
    where: { businessId, ...(sitemapId ? { sitemapId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  const bySlug = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
  }
  const latest = [...bySlug.values()];
  const pages = latest
    .map((r) => r.copyJson as unknown as PageCopy)
    .filter(Boolean);
  const generatedAt = latest.length
    ? latest.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), latest[0].createdAt).toISOString()
    : null;
  const resolvedSitemapId = latest[0]?.sitemapId ?? sitemapId ?? null;
  return { sitemapId: resolvedSitemapId, pages, generatedAt };
}

// ── Gated generation ───────────────────────────────────────────────
export interface GenerateCopyResult {
  ok: boolean;
  /** Set when the copy gate blocks generation. */
  gate?: CopyGateResult;
  artifact?: WebsiteCopyArtifact;
  sitemapId?: string;
  pageIssues?: PageCopyIssue[];
  uniquenessIssues?: CopyUniquenessIssue[];
  /** Slugs that could not be generated (LLM returned nothing). */
  failedSlugs?: string[];
}

/**
 * Generate copy page-by-page for a business, strictly gated behind an approved
 * sitemap. Optionally restrict to `slugs` for per-page regeneration.
 *
 * Returns `{ ok: false, gate }` when the gate blocks generation — no copy is
 * written in that case.
 */
export async function generateWebsiteCopy(params: {
  businessId: string;
  websiteProjectId?: string | null;
  generatedByUserId?: string | null;
  slugs?: string[];
}): Promise<GenerateCopyResult> {
  const { businessId, websiteProjectId, generatedByUserId, slugs } = params;

  const row = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (row?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;

  // HARD GATE.
  const gate = canGenerateCopy(sitemap);
  if (!gate.allowed || !row || !sitemap) {
    return { ok: false, gate };
  }

  const businessSummary = await loadBusinessSummary(businessId);
  const plan: SitemapPage[] = buildCopyPlan(sitemap, { slugs });

  const generated: PageCopy[] = [];
  const failedSlugs: string[] = [];

  for (const page of plan) {
    const seoBrief = await loadSeoBriefContext(businessId, page.slug);
    const { system, user } = buildPageCopyPrompt(sitemap, page, { seoBrief, businessSummary });
    const raw = await callCopyLlm(system, user);
    if (!raw) {
      failedSlugs.push(page.slug);
      continue;
    }
    const copy = parsePageCopyResponse(raw, page, sitemap, { seoBrief, businessSummary });
    generated.push(copy);
    await savePageCopy({ businessId, websiteProjectId, sitemapId: row.id, copy, generatedByUserId });
  }

  // Validate the full set (uniqueness needs all pages, so pull the latest set).
  const full = await loadWebsiteCopy(businessId, row.id);
  const pageIssues = full.pages.flatMap((p) => validatePageCopy(p));
  const uniquenessIssues = validateCopyUniqueness(full.pages);
  const artifact = buildCopyArtifact(sitemap, full.pages, full.generatedAt || undefined);

  return {
    ok: generated.length > 0,
    artifact,
    sitemapId: row.id,
    pageIssues,
    uniquenessIssues,
    failedSlugs: failedSlugs.length ? failedSlugs : undefined,
  };
}
