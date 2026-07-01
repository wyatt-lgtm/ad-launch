/**
 * Milestone 5 — Image generation behind APPROVED image briefs.
 *
 * Business-scoped persistence over the additive WebsiteGeneratedImageAsset
 * model plus the gated orchestration that turns APPROVED image briefs into
 * durable website image assets.
 *
 * HARD GATE (`canGenerateImages`, checked here AND at the API layer): images
 * are NEVER generated unless an approved sitemap + copy artifact + APPROVED
 * image brief set all exist, reference each other, belong to the business, and
 * every brief is complete with no logo-as-hero, AND generation is explicitly
 * requested.
 *
 * DELEGATION: the Next.js app holds NO R2 write credentials. Don (contract
 * validation), Andy (generation/selection + logo rejection), the R2 upload to
 * `tombstoner2`, and hero QA all run in the Tombstone backend, reached through
 * the injectable render-provider seam. This module only builds the Don
 * contract, records durable results, runs the QA evaluation mapping, and
 * persists asset rows.
 *
 * HARD BOUNDARIES: NO static build, NO mobile QA render, NO publish, NO
 * deploy. Provider errors produce a diagnostic `failed` record (no partial
 * success). At most ONE safe retry, and never for moderation-blocked prompts.
 */
import { prisma } from '@/lib/db';
import { type WebsiteSitemapArtifact } from '@/lib/website-sitemap';
import { type CopyArtifactForBriefs } from '@/lib/website-image-briefs';
import { loadLatestSitemap } from '@/lib/website-sitemap-store';
import { loadWebsiteCopy } from '@/lib/website-copy-store';
import { getImageBriefSet, loadImageBriefState } from '@/lib/website-image-briefs-store';
import {
  type ImageGenGateResult,
  type BriefSetForGeneration,
  type GeneratedImageStatus,
  type DonContractContext,
  type AndyRenderMetadata,
  type GeneratedImageAssetRecord,
  GENERATED_IMAGE_BUCKET,
  canGenerateImages,
  buildDonRenderContract,
  buildWebsiteAssetR2Key,
  normalizeAndyRenderMetadata,
  evaluateHeroQa,
  evaluateNonHeroQa,
  deriveStatusFromQa,
  canApproveAsset,
  validateGeneratedAssets,
} from '@/lib/website-image-generation';
import {
  type WebsiteImageRenderProvider,
  isImageRenderProviderConfigured,
  renderWebsiteImageViaTombstone,
} from '@/lib/website-image-render-provider';

export { isImageRenderProviderConfigured };

// ── Business render context ─────────────────────────────────────────
async function loadBusinessRenderContext(businessId: string): Promise<DonContractContext> {
  const business = await prisma.business
    .findUnique({
      where: { id: businessId },
      select: {
        businessName: true,
        businessCity: true,
        businessState: true,
        contentProfile: { select: { industry: true, audienceSegments: true } },
      },
    })
    .catch(() => null);
  if (!business) return {};
  const location = [business.businessCity, business.businessState].filter(Boolean).join(', ');
  const industry = business.contentProfile?.industry || '';
  const serviceContext = [industry, location].filter(Boolean).join(' in ') || undefined;
  let targetAudience: string | undefined;
  const segs = business.contentProfile?.audienceSegments;
  if (Array.isArray(segs) && segs.length) {
    targetAudience = segs
      .map((s) => (typeof s === 'string' ? s : (s as any)?.name))
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
  }
  return {
    businessName: business.businessName || undefined,
    serviceContext,
    targetAudience,
  };
}

// ── Row typing + mapping ────────────────────────────────────────────
type AssetRow = {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string;
  copyArtifactId: string;
  imageBriefSetId: string;
  imageBriefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: string;
  assetRole: string;
  status: string;
  provider: string | null;
  model: string | null;
  r2Bucket: string | null;
  r2Key: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  promptSummary: string | null;
  visualRationale: string | null;
  qualityScore: number | null;
  brandFitScore: number | null;
  mobileSafeScore: number | null;
  textReadabilityScore: number | null;
  focalPointScore: number | null;
  qaStatus: string | null;
  requiredFixesJson: unknown;
  generatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface GeneratedImageAsset {
  id: string;
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string;
  copyArtifactId: string;
  imageBriefSetId: string;
  imageBriefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: string;
  assetRole: string;
  status: string;
  provider: string | null;
  model: string | null;
  r2Bucket: string | null;
  r2Key: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  promptSummary: string | null;
  visualRationale: string | null;
  qualityScore: number | null;
  brandFitScore: number | null;
  mobileSafeScore: number | null;
  textReadabilityScore: number | null;
  focalPointScore: number | null;
  qaStatus: string | null;
  requiredFixes: string[];
  generatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToAsset(row: AssetRow): GeneratedImageAsset {
  const fixes = Array.isArray(row.requiredFixesJson)
    ? (row.requiredFixesJson as unknown[]).map((f) => String(f))
    : [];
  return {
    id: row.id,
    businessId: row.businessId,
    websiteProjectId: row.websiteProjectId,
    sitemapId: row.sitemapId,
    copyArtifactId: row.copyArtifactId,
    imageBriefSetId: row.imageBriefSetId,
    imageBriefId: row.imageBriefId,
    pageSlug: row.pageSlug,
    sectionName: row.sectionName,
    sectionType: row.sectionType,
    assetRole: row.assetRole,
    status: row.status,
    provider: row.provider,
    model: row.model,
    r2Bucket: row.r2Bucket,
    r2Key: row.r2Key,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    altText: row.altText,
    promptSummary: row.promptSummary,
    visualRationale: row.visualRationale,
    qualityScore: row.qualityScore,
    brandFitScore: row.brandFitScore,
    mobileSafeScore: row.mobileSafeScore,
    textReadabilityScore: row.textReadabilityScore,
    focalPointScore: row.focalPointScore,
    qaStatus: row.qaStatus,
    requiredFixes: fixes,
    generatedByUserId: row.generatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Copy loader (mirror of brief store) ─────────────────────────────
async function loadCopyForGeneration(
  businessId: string,
  sitemapId?: string | null,
): Promise<{ copy: CopyArtifactForBriefs | null; copyArtifactId: string | null }> {
  const copy = await loadWebsiteCopy(businessId, sitemapId ?? undefined);
  if (!copy || !copy.pages.length) return { copy: null, copyArtifactId: null };
  return { copy: { sitemapId: copy.sitemapId, pages: copy.pages }, copyArtifactId: copy.sitemapId };
}

// ── Read ────────────────────────────────────────────────────────────
export interface GeneratedImageState {
  gate: ImageGenGateResult;
  providerConfigured: boolean;
  sitemapId: string | null;
  copyArtifactId: string | null;
  briefSetId: string | null;
  briefSetStatus: string | null;
  assets: GeneratedImageAsset[];
}

/** Gate state + generated assets for a business (business-scoped). */
export async function loadGeneratedImageState(
  businessId: string,
  websiteProjectId?: string | null,
): Promise<GeneratedImageState> {
  const sitemapRow = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const { copy, copyArtifactId } = await loadCopyForGeneration(businessId, sitemapRow?.id ?? null);

  // Latest approved brief set drives the gate.
  const briefState = await loadImageBriefState(businessId, websiteProjectId);
  const latestBrief = briefState.latest;
  const briefSetForGate: BriefSetForGeneration | null = latestBrief
    ? {
        id: latestBrief.id,
        businessId: latestBrief.businessId,
        sitemapId: latestBrief.sitemapId,
        copyArtifactId: latestBrief.copyArtifactId,
        status: latestBrief.status,
        artifact: latestBrief.artifact,
      }
    : null;

  const gate = canGenerateImages(sitemap, copy, briefSetForGate, {
    sitemapId: sitemapRow?.id ?? null,
    businessId,
    // Read-only state check: do not require the explicit request flag here.
    requested: true,
  });

  const rows = (await prisma.websiteGeneratedImageAsset.findMany({
    where: { businessId, ...(websiteProjectId ? { websiteProjectId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })) as unknown as AssetRow[];

  return {
    gate,
    providerConfigured: isImageRenderProviderConfigured(),
    sitemapId: sitemapRow?.id ?? null,
    copyArtifactId,
    briefSetId: latestBrief?.id ?? null,
    briefSetStatus: latestBrief?.status ?? null,
    assets: rows.map(rowToAsset),
  };
}

/** Fetch a single generated asset, business-scoped. Null if not found/owned. */
export async function getGeneratedImageAsset(
  businessId: string,
  assetId: string,
): Promise<GeneratedImageAsset | null> {
  const row = (await prisma.websiteGeneratedImageAsset.findFirst({
    where: { id: assetId, businessId },
  })) as unknown as AssetRow | null;
  return row ? rowToAsset(row) : null;
}

// ── Gated generation ────────────────────────────────────────────────
/**
 * A single validated dry-run item. Dry-run NEVER persists an asset row, uploads
 * an R2 object, or generates an image — it only confirms the contract is valid
 * and reports the durable R2 key the live render WOULD write to.
 */
export interface DryRunValidatedItem {
  briefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: 'hero' | 'section';
  assetRole: string;
  status: 'validated';
  expectedR2Key: string;
  r2Bucket: string;
  promptSummary?: string | null;
  /** Populated when the backend could not validate this contract. */
  error?: string;
}

export interface GenerateImagesResult {
  ok: boolean;
  /** Set when the gate blocks generation (no assets written). */
  gate?: ImageGenGateResult;
  assets?: GeneratedImageAsset[];
  /** Brief ids that produced a diagnostic `failed` asset. */
  failedBriefIds?: string[];
  error?: string;
  /** True when this was a dry-run (validation only, no assets persisted). */
  dryRun?: boolean;
  /** Validated dry-run previews (present only when dryRun is true). */
  validated?: DryRunValidatedItem[];
  /** Explicit boundary flags — Milestone 5 never crosses these. */
  staticBuildRun: false;
  mobileQaRun: false;
  publishRun: false;
  deployRun: false;
}

function buildRecord(base: {
  businessId: string;
  websiteProjectId: string | null;
  sitemapId: string;
  copyArtifactId: string;
  imageBriefSetId: string;
  imageBriefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: 'hero' | 'section';
  assetRole: GeneratedImageAssetRecord['assetRole'];
}): GeneratedImageAssetRecord {
  return {
    ...base,
    status: 'queued',
    provider: null,
    model: null,
    r2Bucket: null,
    r2Key: null,
    mimeType: null,
    width: null,
    height: null,
    altText: null,
    promptSummary: null,
    visualRationale: null,
    qualityScore: null,
    brandFitScore: null,
    mobileSafeScore: null,
    textReadabilityScore: null,
    focalPointScore: null,
    qaStatus: null,
    requiredFixes: [],
  };
}

async function persistRecord(
  record: GeneratedImageAssetRecord,
  generatedByUserId: string | null,
): Promise<AssetRow> {
  return (await prisma.websiteGeneratedImageAsset.create({
    data: {
      businessId: record.businessId,
      websiteProjectId: record.websiteProjectId ?? null,
      sitemapId: record.sitemapId,
      copyArtifactId: record.copyArtifactId,
      imageBriefSetId: record.imageBriefSetId,
      imageBriefId: record.imageBriefId,
      pageSlug: record.pageSlug,
      sectionName: record.sectionName,
      sectionType: record.sectionType,
      assetRole: record.assetRole,
      status: record.status,
      provider: record.provider,
      model: record.model,
      r2Bucket: record.r2Bucket,
      r2Key: record.r2Key,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      altText: record.altText,
      promptSummary: record.promptSummary,
      visualRationale: record.visualRationale,
      qualityScore: record.qualityScore,
      brandFitScore: record.brandFitScore,
      mobileSafeScore: record.mobileSafeScore,
      textReadabilityScore: record.textReadabilityScore,
      focalPointScore: record.focalPointScore,
      qaStatus: record.qaStatus,
      requiredFixesJson: record.requiredFixes as any,
      generatedByUserId,
    },
  })) as unknown as AssetRow;
}

/**
 * Generate website images for a business, strictly gated behind an APPROVED
 * image brief set. Delegates the actual render + R2 upload + hero QA to the
 * Tombstone backend through the injectable provider. Returns `{ ok:false, gate }`
 * when the gate blocks (no assets written).
 *
 * Provider errors yield a diagnostic `failed` asset (no partial success); at
 * most ONE safe retry, never for moderation-blocked prompts.
 */
export async function generateWebsiteImages(params: {
  businessId: string;
  websiteProjectId?: string | null;
  briefSetId?: string | null;
  requestedBriefIds?: string[] | null;
  generatedByUserId?: string | null;
  /** Injectable for tests; defaults to the Tombstone backend. */
  provider?: WebsiteImageRenderProvider;
  /** Safety cap for how many assets to render in one call. */
  limit?: number;
  /**
   * When true, validate the contract(s) and return the durable expected R2
   * key(s) WITHOUT generating an image, uploading to R2, or persisting any
   * asset row. Used by the cost-free dry-run gate check.
   */
  dryRun?: boolean;
}): Promise<GenerateImagesResult> {
  const boundaries = {
    staticBuildRun: false as const,
    mobileQaRun: false as const,
    publishRun: false as const,
    deployRun: false as const,
  };
  const {
    businessId,
    websiteProjectId = null,
    briefSetId = null,
    requestedBriefIds = null,
    generatedByUserId = null,
    provider = renderWebsiteImageViaTombstone,
    limit,
    dryRun = false,
  } = params;

  // Load inputs.
  const sitemapRow = await loadLatestSitemap(businessId, websiteProjectId);
  const sitemap = (sitemapRow?.sitemapJson as unknown as WebsiteSitemapArtifact) || null;
  const { copy, copyArtifactId } = await loadCopyForGeneration(businessId, sitemapRow?.id ?? null);

  const briefSetRecord = briefSetId
    ? await getImageBriefSet(businessId, briefSetId)
    : (await loadImageBriefState(businessId, websiteProjectId)).latest;

  const briefSetForGate: BriefSetForGeneration | null = briefSetRecord
    ? {
        id: briefSetRecord.id,
        businessId: briefSetRecord.businessId,
        sitemapId: briefSetRecord.sitemapId,
        copyArtifactId: briefSetRecord.copyArtifactId,
        status: briefSetRecord.status,
        artifact: briefSetRecord.artifact,
      }
    : null;

  // HARD GATE — always the first substantive check.
  const gate = canGenerateImages(sitemap, copy, briefSetForGate, {
    sitemapId: sitemapRow?.id ?? null,
    businessId,
    requested: true,
  });
  if (!gate.allowed || !briefSetRecord) {
    return { ok: false, gate, ...boundaries };
  }

  const ctx = await loadBusinessRenderContext(businessId);
  const requestedSet =
    requestedBriefIds && requestedBriefIds.length ? new Set(requestedBriefIds) : null;

  // Flatten briefs (optionally filtered), respecting an optional safety cap.
  const jobs: { page: (typeof briefSetRecord.artifact.pages)[number]; brief: any }[] = [];
  for (const page of briefSetRecord.artifact.pages || []) {
    for (const brief of page.briefs || []) {
      if (requestedSet && !requestedSet.has(brief.briefId)) continue;
      jobs.push({ page, brief });
    }
  }
  const capped = typeof limit === 'number' && limit > 0 ? jobs.slice(0, limit) : jobs;

  // ── DRY RUN ──────────────────────────────────────────────────────
  // Validate contracts and report the durable expected R2 key. NEVER
  // persist an asset row, upload to R2, generate an image, or retry.
  if (dryRun) {
    const validated: DryRunValidatedItem[] = [];
    for (const { page, brief } of capped) {
      const contract = buildDonRenderContract(brief, page, sitemap, ctx);
      const expectedR2Key = buildWebsiteAssetR2Key({
        businessId,
        imageBriefId: brief.briefId,
        sectionName: brief.sectionName,
        assetRole: contract.assetRole,
      });
      const resp = await provider(contract, { businessId, dryRun: true });
      const backendKey = resp.ok ? String(resp.result?.r2Key || resp.result?.key || '') : '';
      validated.push({
        briefId: brief.briefId,
        pageSlug: page.slug,
        sectionName: brief.sectionName,
        sectionType: brief.sectionType,
        assetRole: contract.assetRole,
        status: 'validated',
        expectedR2Key: backendKey || expectedR2Key,
        r2Bucket: (resp.ok && String(resp.result?.r2Bucket || resp.result?.bucket || '')) || GENERATED_IMAGE_BUCKET,
        promptSummary: contract.visualConcept ?? null,
        error: resp.ok ? undefined : resp.error,
      });
    }
    return { ok: true, dryRun: true, validated, ...boundaries };
  }

  const persisted: AssetRow[] = [];
  const failedBriefIds: string[] = [];

  for (const { page, brief } of capped) {
    const contract = buildDonRenderContract(brief, page, sitemap, ctx);
    const record = buildRecord({
      businessId,
      websiteProjectId,
      sitemapId: sitemapRow!.id,
      copyArtifactId: copyArtifactId || briefSetRecord.copyArtifactId,
      imageBriefSetId: briefSetRecord.id,
      imageBriefId: brief.briefId,
      pageSlug: page.slug,
      sectionName: brief.sectionName,
      sectionType: brief.sectionType,
      assetRole: contract.assetRole,
    });

    // Call the render provider (delegated to Tombstone). One safe retry only.
    // The contract has no businessId field, so pass it via context — the
    // backend needs it to build the durable, business-scoped R2 key.
    let resp = await provider(contract, { businessId });
    if (!resp.ok && resp.retryable && !resp.moderationBlocked) {
      resp = await provider(contract, { businessId });
    }

    if (!resp.ok || !resp.result) {
      record.status = 'failed';
      record.qaStatus = 'failed';
      record.requiredFixes = [resp.error || 'Render provider failed.'];
      persisted.push(await persistRecord(record, generatedByUserId));
      failedBriefIds.push(brief.briefId);
      continue;
    }

    // Normalize + validate Andy metadata (durable R2, correct bucket, no logo).
    const normalized = normalizeAndyRenderMetadata(resp.result);
    if (!normalized.ok || !normalized.metadata) {
      record.status = 'failed';
      record.qaStatus = 'failed';
      record.requiredFixes = [normalized.reason || 'Render metadata invalid.'];
      persisted.push(await persistRecord(record, generatedByUserId));
      failedBriefIds.push(brief.briefId);
      continue;
    }

    const meta: AndyRenderMetadata = normalized.metadata;
    record.provider = meta.provider;
    record.model = meta.model;
    record.r2Bucket = meta.r2Bucket;
    record.r2Key = meta.r2Key;
    record.mimeType = meta.mimeType;
    record.width = meta.width ?? null;
    record.height = meta.height ?? null;
    record.altText = meta.altText ?? null;
    record.promptSummary = meta.promptSummary ?? null;
    record.visualRationale = meta.visualRationale ?? null;

    // QA: hero uses the full hero QA pass; section uses lighter validation.
    if (brief.sectionType === 'hero') {
      const qa = evaluateHeroQa({ metadata: meta, contract });
      record.qualityScore = qa.heroVisualScore;
      record.mobileSafeScore = qa.mobileHeroScore;
      record.brandFitScore = qa.brandFitScore;
      record.textReadabilityScore = qa.textReadabilityScore;
      record.focalPointScore = qa.focalPointScore;
      record.qaStatus = qa.qaStatus;
      record.requiredFixes = qa.requiredFixes;
      record.status = deriveStatusFromQa('hero', qa.qaStatus);
    } else {
      const qa = evaluateNonHeroQa({ metadata: meta, contract, brief });
      record.brandFitScore = qa.brandFitScore;
      record.qaStatus = qa.qaStatus;
      record.requiredFixes = qa.requiredFixes;
      record.status = deriveStatusFromQa('section', qa.qaStatus);
    }

    persisted.push(await persistRecord(record, generatedByUserId));
  }

  return {
    ok: true,
    assets: persisted.map(rowToAsset),
    failedBriefIds: failedBriefIds.length ? failedBriefIds : undefined,
    ...boundaries,
  };
}

// ── Review actions ──────────────────────────────────────────────────
const EDITABLE_ASSET_STATUSES = new Set<GeneratedImageStatus>([
  'generated',
  'ready_for_review',
  'qa_failed',
  'rejected',
]);

/** Update editable fields (alt text, prompt summary, rationale) on an asset. */
export async function updateGeneratedImageAsset(params: {
  businessId: string;
  assetId: string;
  altText?: string;
  promptSummary?: string;
  visualRationale?: string;
}): Promise<{ ok: boolean; asset?: GeneratedImageAsset; error?: string }> {
  const existing = await getGeneratedImageAsset(params.businessId, params.assetId);
  if (!existing) return { ok: false, error: 'not_found' };
  const data: Record<string, unknown> = {};
  if (typeof params.altText === 'string') data.altText = params.altText;
  if (typeof params.promptSummary === 'string') data.promptSummary = params.promptSummary;
  if (typeof params.visualRationale === 'string') data.visualRationale = params.visualRationale;
  if (Object.keys(data).length === 0) return { ok: true, asset: existing };
  const row = (await prisma.websiteGeneratedImageAsset.update({
    where: { id: params.assetId },
    data,
  })) as unknown as AssetRow;
  return { ok: true, asset: rowToAsset(row) };
}

/**
 * Approve an asset. A hero asset that FAILED QA can NEVER be approved. Failed
 * diagnostic assets can never be approved.
 */
export async function approveGeneratedImageAsset(params: {
  businessId: string;
  assetId: string;
}): Promise<{ ok: boolean; asset?: GeneratedImageAsset; error?: string }> {
  const existing = await getGeneratedImageAsset(params.businessId, params.assetId);
  if (!existing) return { ok: false, error: 'not_found' };
  const guard = canApproveAsset({
    assetRole: existing.assetRole as any,
    qaStatus: existing.qaStatus,
    status: existing.status,
  });
  if (!guard.allowed) return { ok: false, error: guard.reason };
  const row = (await prisma.websiteGeneratedImageAsset.update({
    where: { id: params.assetId },
    data: { status: 'approved' },
  })) as unknown as AssetRow;
  return { ok: true, asset: rowToAsset(row) };
}

/** Reject an asset (records optional revision notes into requiredFixes). */
export async function rejectGeneratedImageAsset(params: {
  businessId: string;
  assetId: string;
  reason?: string;
}): Promise<{ ok: boolean; asset?: GeneratedImageAsset; error?: string }> {
  const existing = await getGeneratedImageAsset(params.businessId, params.assetId);
  if (!existing) return { ok: false, error: 'not_found' };
  const fixes = params.reason ? [params.reason, ...existing.requiredFixes] : existing.requiredFixes;
  const row = (await prisma.websiteGeneratedImageAsset.update({
    where: { id: params.assetId },
    data: { status: 'rejected', requiredFixesJson: fixes as any },
  })) as unknown as AssetRow;
  return { ok: true, asset: rowToAsset(row) };
}

/** Re-export validation for tests / diagnostics. */
export { validateGeneratedAssets, GENERATED_IMAGE_BUCKET };
