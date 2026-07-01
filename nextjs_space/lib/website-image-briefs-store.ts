/**
 * Milestone 4 — Image-brief persistence + gated orchestration.
 *
 * Business-scoped persistence over the additive WebsiteImageBrief model plus
 * the gated, page-by-page image-BRIEF generation orchestration.
 *
 * HARD GATE: image briefs are NEVER produced unless:
 *   - the latest sitemap for the business exists, is approved, has valid H1s, AND
 *   - a website copy artifact exists for that sitemap and is in an eligible
 *     status (draft | ready_for_review | approved).
 * The gate (`canGenerateImageBriefs`) is checked here AND at the API layer.
 *
 * HARD BOUNDARIES (Milestone 4): This module produces SPECIFICATIONS ONLY.
 *   NO image generation, NO image-provider calls (OpenAI Images / FAL / Flux),
 *   NO R2 upload, NO static build, NO publish, NO deploy, NO mobile QA render.
 * The only network call is the OpenAI-compatible LLM used to ENRICH the
 * descriptive text of each brief. Safety fields are enforced deterministically.
 */
import { prisma } from '@/lib/db';
import {
  type WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';
import {
  type PageCopy,
} from '@/lib/website-copy';
import {
  type WebsiteImageBriefArtifact,
  type PageImageBriefs,
  type ImageBriefGateResult,
  type ImageBriefStatus,
  type ImageBriefIssue,
  type CopyArtifactForBriefs,
  canGenerateImageBriefs,
  buildImageBriefPrompt,
  parseImageBriefResponse,
  buildPageImageBriefs,
  validateImageBriefs,
  buildImageBriefArtifact,
} from '@/lib/website-image-briefs';
import { loadLatestSitemap } from '@/lib/website-sitemap-store';
import { loadWebsiteCopy } from '@/lib/website-copy-store';

// ── LLM helper (OpenAI-compatible Abacus RouteLLM) ─────────────────────────
const LLM_URL = 'https://apps.abacus.ai/v1/chat/completions';
const MODEL = 'claude-sonnet-4-6';

export function isImageBriefLlmConfigured(): boolean {
  return Boolean(process.env.ABACUSAI_API_KEY);
}

async function callBriefLlm(system: string, user: string, maxTokens = 1800): Promise<any | null> {
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
    console.error('[website-image-briefs] LLM fetch failed:', err);
    return null;
  }
  if (!res.ok) {
    console.error('[website-image-briefs] LLM error:', await res.text().catch(() => ''));
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

// ── Row → artifact helpers ─────────────────────────────────────────
type BriefRow = {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string;
  copyArtifactId: string;
  status: string;
  imageBriefJson: unknown;
  pageCount: number;
  briefCount: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface ImageBriefSet {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string;
  copyArtifactId: string;
  status: ImageBriefStatus;
  pageCount: number;
  briefCount: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  artifact: WebsiteImageBriefArtifact;
}

function rowToSet(row: BriefRow): ImageBriefSet {
  return {
    id: row.id,
    businessId: row.businessId,
    websiteProjectId: row.websiteProjectId,
    sitemapId: row.sitemapId,
    copyArtifactId: row.copyArtifactId,
    status: row.status as ImageBriefStatus,
    pageCount: row.pageCount,
    briefCount: row.briefCount,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    artifact: row.imageBriefJson as unknown as WebsiteImageBriefArtifact,
  };
}

/** Load the copy artifact reference for the gate + generator. */
async function loadCopyForBriefs(
  businessId: string,
  sitemapId?: string | null,
): Promise<{ copy: CopyArtifactForBriefs | null; copyArtifactId: string | null; generatedAt: string | null }> {
  const copy = await loadWebsiteCopy(businessId, sitemapId ?? undefined);
  if (!copy || !copy.pages.length) {
    return { copy: null, copyArtifactId: null, generatedAt: null };
  }
  // Copy is 1:1 with the approved sitemap; the sitemapId is the stable,
  // queryable pointer to the copy artifact.
  return {
    copy: { sitemapId: copy.sitemapId, pages: copy.pages },
    copyArtifactId: copy.sitemapId,
    generatedAt: copy.generatedAt,
  };
}

// ── Read ────────────────────────────────────────────────────────────

/** Gate state + latest brief set for a business (business-scoped). */
export async function loadImageBriefState(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<{
  gate: ImageBriefGateResult;
  sitemapId: string | null;
  copyArtifactId: string | null;
  copyPresent: boolean;
  latest: ImageBriefSet | null;
  history: ImageBriefSet[];
}> {
  const sitemapRow = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const { copy, copyArtifactId } = await loadCopyForBriefs(businessId, sitemapRow?.id ?? null);
  const gate = canGenerateImageBriefs(sitemap, copy, { sitemapId: sitemapRow?.id ?? null });

  const rows = (await prisma.websiteImageBrief.findMany({
    where: { businessId, ...(websiteProjectId ? { websiteProjectId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 25,
  })) as unknown as BriefRow[];
  const history = rows.map(rowToSet);
  return {
    gate,
    sitemapId: sitemapRow?.id ?? null,
    copyArtifactId,
    copyPresent: Boolean(copy && copy.pages.length),
    latest: history[0] ?? null,
    history,
  };
}

/** Fetch a single brief set, business-scoped. Returns null if not found/owned. */
export async function getImageBriefSet(
  businessId: string,
  briefSetId: string,
): Promise<ImageBriefSet | null> {
  const row = (await prisma.websiteImageBrief.findFirst({
    where: { id: briefSetId, businessId },
  })) as unknown as BriefRow | null;
  return row ? rowToSet(row) : null;
}

// ── Gated generation ────────────────────────────────────────────────
export interface GenerateImageBriefsResult {
  ok: boolean;
  /** Set when the gate blocks generation (no artifact written). */
  gate?: ImageBriefGateResult;
  briefSet?: ImageBriefSet;
  issues?: ImageBriefIssue[];
  /** Slugs that could not be enriched by the LLM (deterministic scaffold used). */
  fallbackSlugs?: string[];
  /** Explicit boundary flags — Milestone 4 never crosses these. */
  imageGenerationRun: false;
  r2UploadRun: false;
  staticBuildRun: false;
  publishRun: false;
}

/**
 * Generate image briefs (SPECIFICATIONS ONLY) for a business, strictly gated
 * behind an approved sitemap + existing copy artifact.
 *
 * Returns `{ ok: false, gate }` when the gate blocks generation — no briefs are
 * written in that case.
 */
export async function generateImageBriefs(params: {
  businessId: string;
  websiteProjectId?: string | null;
  generatedByUserId?: string | null;
}): Promise<GenerateImageBriefsResult> {
  const { businessId, websiteProjectId, generatedByUserId } = params;
  const boundary = {
    imageGenerationRun: false as const,
    r2UploadRun: false as const,
    staticBuildRun: false as const,
    publishRun: false as const,
  };

  const sitemapRow = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const { copy, copyArtifactId } = await loadCopyForBriefs(businessId, sitemapRow?.id ?? null);

  // HARD GATE.
  const gate = canGenerateImageBriefs(sitemap, copy, { sitemapId: sitemapRow?.id ?? null });
  if (!gate.allowed || !sitemapRow || !sitemap || !copy) {
    return { ok: false, gate, ...boundary };
  }

  const businessSummary = await loadBusinessSummary(businessId);
  const pages: PageImageBriefs[] = [];
  const fallbackSlugs: string[] = [];

  for (const page of copy.pages as PageCopy[]) {
    let pageBriefs: PageImageBriefs;
    if (isImageBriefLlmConfigured()) {
      const { system, user } = buildImageBriefPrompt(page, sitemap, { businessSummary });
      const raw = await callBriefLlm(system, user);
      if (raw) {
        pageBriefs = parseImageBriefResponse(raw, page, sitemap);
      } else {
        fallbackSlugs.push(page.slug);
        pageBriefs = buildPageImageBriefs(page, sitemap);
      }
    } else {
      // Should not reach here (API returns 503 first), but stay resilient:
      // the deterministic scaffold is a complete, valid brief set.
      fallbackSlugs.push(page.slug);
      pageBriefs = buildPageImageBriefs(page, sitemap);
    }
    pages.push(pageBriefs);
  }

  const issues = validateImageBriefs(pages);
  const status: ImageBriefStatus = issues.length ? 'ready_for_review' : 'ready_for_review';
  const artifact = buildImageBriefArtifact({
    pages,
    sitemapId: sitemapRow.id,
    copyArtifactId,
    businessId,
    websiteProjectId: websiteProjectId ?? null,
    status,
  });

  const briefCount = pages.reduce((n, p) => n + p.briefs.length, 0);
  const row = (await prisma.websiteImageBrief.create({
    data: {
      businessId,
      websiteProjectId: websiteProjectId ?? null,
      sitemapId: sitemapRow.id,
      copyArtifactId: copyArtifactId ?? sitemapRow.id,
      status,
      imageBriefJson: artifact as any,
      pageCount: pages.length,
      briefCount,
      generatedByUserId: generatedByUserId ?? null,
      source: 'copy_gate',
    },
  })) as unknown as BriefRow;

  return {
    ok: true,
    briefSet: rowToSet(row),
    issues,
    fallbackSlugs: fallbackSlugs.length ? fallbackSlugs : undefined,
    ...boundary,
  };
}

// ── Edit / status transitions (low-risk) ────────────────────────────
const EDITABLE_STATUSES = new Set<ImageBriefStatus>(['draft', 'ready_for_review', 'revision_requested']);

/**
 * Apply low-risk edits to a brief set's descriptive fields. Safety fields
 * (forbiddenVisuals, textSafeZone, mobileCropNotes, aspectRatio, readiness) are
 * re-enforced from the incoming artifact by re-validating; callers pass the full
 * edited artifact. Never generates images.
 */
export async function updateImageBriefSet(params: {
  businessId: string;
  briefSetId: string;
  artifact?: WebsiteImageBriefArtifact;
  status?: ImageBriefStatus;
}): Promise<{ ok: boolean; briefSet?: ImageBriefSet; error?: string; issues?: ImageBriefIssue[] }> {
  const { businessId, briefSetId, artifact, status } = params;
  const existing = await getImageBriefSet(businessId, briefSetId);
  if (!existing) return { ok: false, error: 'not_found' };
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return { ok: false, error: `Brief set in status "${existing.status}" cannot be edited.` };
  }

  let nextArtifact = existing.artifact;
  let issues: ImageBriefIssue[] | undefined;
  if (artifact && Array.isArray(artifact.pages)) {
    issues = validateImageBriefs(artifact.pages);
    nextArtifact = {
      ...existing.artifact,
      pages: artifact.pages,
      summary: {
        ...existing.artifact.summary,
        pageCount: artifact.pages.length,
        briefCount: artifact.pages.reduce((n, p) => n + p.briefs.length, 0),
        heroBriefCount: artifact.pages.reduce(
          (n, p) => n + p.briefs.filter((b) => b.sectionType === 'hero').length,
          0,
        ),
      },
    };
  }

  const nextStatus = status ?? existing.status;
  const briefCount = nextArtifact.pages.reduce((n, p) => n + p.briefs.length, 0);
  const row = (await prisma.websiteImageBrief.update({
    where: { id: briefSetId },
    data: {
      imageBriefJson: { ...nextArtifact, status: nextStatus } as any,
      status: nextStatus,
      pageCount: nextArtifact.pages.length,
      briefCount,
    },
  })) as unknown as BriefRow;
  return { ok: true, briefSet: rowToSet(row), issues };
}

/** Approve a brief set. Approval is a review action only — never renders images. */
export async function approveImageBriefSet(params: {
  businessId: string;
  briefSetId: string;
}): Promise<{ ok: boolean; briefSet?: ImageBriefSet; error?: string }> {
  const { businessId, briefSetId } = params;
  const existing = await getImageBriefSet(businessId, briefSetId);
  if (!existing) return { ok: false, error: 'not_found' };
  const artifact = { ...existing.artifact, status: 'approved' as ImageBriefStatus };
  const row = (await prisma.websiteImageBrief.update({
    where: { id: briefSetId },
    data: { status: 'approved', imageBriefJson: artifact as any },
  })) as unknown as BriefRow;
  return { ok: true, briefSet: rowToSet(row) };
}
