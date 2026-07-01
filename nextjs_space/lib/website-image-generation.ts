/**
 * Milestone 5 — Image generation behind APPROVED image briefs (PURE logic).
 *
 * This module is DETERMINISTIC and side-effect free. It provides:
 *   - the image-generation gate (canGenerateImages)
 *   - the Don -> Andy render contract builder (buildDonRenderContract)
 *   - Andy render-metadata normalization (normalizeAndyRenderMetadata)
 *   - durable R2 key pattern (buildWebsiteAssetR2Key)
 *   - hero + non-hero QA evaluation (evaluateHeroQa / evaluateNonHeroQa)
 *   - generated-asset validation (validateGeneratedAssets)
 *
 * HARD BOUNDARIES (Milestone 5): this module NEVER performs image generation,
 * R2 upload, static build, publish, or deploy. It only shapes the contracts,
 * scores QA from inputs, and validates records. The actual pixel generation +
 * durable R2 upload is delegated to the Tombstone Don/Andy pipeline via the
 * render-provider seam (see website-image-render-provider.ts).
 *
 * Import allowlist (enforced by test): ONLY @/lib/website-sitemap,
 * @/lib/website-copy, @/lib/website-image-briefs.
 */
import {
  type WebsiteSitemapArtifact,
} from '@/lib/website-sitemap';
import {
  type PageCopy,
} from '@/lib/website-copy';
import {
  type ImageBrief,
  type PageImageBriefs,
  type WebsiteImageBriefArtifact,
  type CopyArtifactForBriefs,
  canGenerateImageBriefs,
} from '@/lib/website-image-briefs';

// ── Constants ──────────────────────────────────────────────────────────────

/** Minimum hero_visual_score for ready_for_review / Top Recommendation. */
export const HERO_VISUAL_PASS_THRESHOLD = 85;

/** Durable bucket for generated website assets (existing Tombstone R2 bucket). */
export const GENERATED_IMAGE_BUCKET = 'tombstoner2';

/** Customer-uploaded asset bucket — generated images must NEVER be written here. */
export const CUSTOMER_ASSETS_BUCKET = 'tombstoner2customerassets';

/** Phrases that indicate a brief is (incorrectly) requesting a logo-as-hero. */
export const LOGO_AS_HERO_MARKERS = [
  'logo-as-hero',
  'logo as hero',
  'logo as the hero',
  'business logo used as the hero',
  'giant faded logo',
  'logo watermark background',
];

// ── Types ──────────────────────────────────────────────────────────────────

export type GeneratedImageStatus =
  | 'queued'
  | 'generating'
  | 'generated'
  | 'qa_failed'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'archived';

export type ImageAssetRole = 'hero_image' | 'section_image' | 'supporting_image';

export type ImageGenGateCode =
  | 'sitemap_missing'
  | 'sitemap_not_approved'
  | 'invalid_h1'
  | 'copy_missing'
  | 'copy_invalid_status'
  | 'copy_sitemap_mismatch'
  | 'no_pages'
  | 'brief_set_missing'
  | 'brief_set_business_mismatch'
  | 'brief_set_reference_mismatch'
  | 'brief_set_not_approved'
  | 'brief_missing_fields'
  | 'logo_as_hero_forbidden'
  | 'not_requested'
  | 'ok';

export interface ImageGenGateResult {
  allowed: boolean;
  code: ImageGenGateCode;
  reason: string;
  /** Brief ids that individually failed validation (missing fields / logo-as-hero). */
  blockingBriefIds?: string[];
}

/** Minimal shape of a persisted brief set used by the gate. */
export interface BriefSetForGeneration {
  id: string;
  businessId: string;
  sitemapId: string;
  copyArtifactId: string;
  status: string;
  artifact: WebsiteImageBriefArtifact;
}

/** Structured Don render contract (hero: full 25-field; section: lighter). */
export interface DonRenderContract {
  briefId: string;
  pageType: string;
  pageSlug: string;
  sectionName: string;
  sectionType: 'hero' | 'section';
  assetRole: ImageAssetRole;
  businessName: string;
  serviceContext: string;
  targetAudience: string;
  visualConcept: string;
  visualObjective: string;
  businessSpecificDirection: string;
  subject: string;
  environment: string;
  composition: string;
  lighting: string;
  cameraAngle: string;
  foregroundElements: string[];
  backgroundElements: string[];
  industryDetails: string[];
  localDetails: string[];
  brandColorUsage: string;
  textSafeZone: string;
  mobileCropSafeZone: string;
  desktopAspectRatio: string;
  mobileAspectRatio: string;
  forbiddenVisuals: string[];
  forbiddenTextInImage: boolean;
  assetSourcePreference: string;
  outputRequirements: {
    format: string;
    minWidth: number;
    minHeight: number;
    colorSpace: string;
  };
}

/** Structured metadata Andy returns after generation/selection. */
export interface AndyRenderMetadata {
  provider: string;
  model: string;
  r2Bucket: string;
  r2Key: string;
  mimeType: string;
  width?: number;
  height?: number;
  altText?: string;
  promptSummary?: string;
  visualRationale?: string;
  /** Andy's self-reported rejection of logo/filler (true = rejected bad asset). */
  rejectedLogoAsHero?: boolean;
  /** Optional hero QA scores supplied by the Tombstone hero QA pass. */
  heroQa?: Partial<HeroQaResult> | null;
}

export interface HeroQaResult {
  heroVisualScore: number;
  mobileHeroScore: number;
  brandFitScore: number;
  textReadabilityScore: number;
  focalPointScore: number;
  qaStatus: 'passed' | 'failed';
  requiredFixes: string[];
}

export interface NonHeroQaResult {
  qaStatus: 'passed' | 'failed';
  brandFitScore: number;
  requiredFixes: string[];
}

/** A generated (or diagnostic/failed) image asset record (pre-persistence). */
export interface GeneratedImageAssetRecord {
  businessId: string;
  websiteProjectId?: string | null;
  sitemapId: string;
  copyArtifactId: string;
  imageBriefSetId: string;
  imageBriefId: string;
  pageSlug: string;
  sectionName: string;
  sectionType: 'hero' | 'section';
  assetRole: ImageAssetRole;
  status: GeneratedImageStatus;
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
}

export interface GeneratedAssetValidationIssue {
  imageBriefId?: string;
  kind:
    | 'missing_brief_link'
    | 'missing_slug_or_section'
    | 'non_durable_r2'
    | 'signed_url_stored'
    | 'hero_missing_qa'
    | 'failed_hero_approved'
    | 'wrong_bucket';
  reason: string;
}

// ── Small helpers ──────────────────────────────────────────────────────────

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function nonEmpty(s: unknown): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/** True when a string looks like a signed URL (must NOT be stored as durable ref). */
export function isSignedUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  const v = String(s);
  if (v.startsWith('http://') || v.startsWith('https://')) return true;
  if (v.includes('?')) return true; // query string => presigned
  if (/x-amz-|signature=|expires=/i.test(v)) return true;
  return false;
}

/** True only for a durable R2 bucket+key (no signed URL, correct bucket). */
export function isDurableR2Reference(
  bucket: string | null | undefined,
  key: string | null | undefined,
): boolean {
  if (!nonEmpty(bucket) || !nonEmpty(key)) return false;
  if (isSignedUrl(key)) return false;
  if (String(key).startsWith('r2://')) return false; // store bare key, not scheme
  return true;
}

/** Detect a brief that (incorrectly) requests a logo-as-hero visual. */
export function briefRequestsLogoAsHero(brief: ImageBrief): boolean {
  const haystacks = [
    brief.visualObjective,
    brief.businessSpecificDirection,
    brief.assetSourcePreference,
  ]
    .filter(nonEmpty)
    .map((s) => String(s).toLowerCase());
  return haystacks.some((h) => LOGO_AS_HERO_MARKERS.some((m) => h.includes(m)));
}

/** True when a hero brief correctly forbids the logo-as-hero visual. */
export function heroBriefForbidsLogo(brief: ImageBrief): boolean {
  const forbidden = (brief.forbiddenVisuals || []).map((s) => String(s).toLowerCase());
  return forbidden.some((f) => f.includes('logo') && f.includes('hero'));
}

export function assetRoleForBrief(brief: ImageBrief): ImageAssetRole {
  return brief.sectionType === 'hero' ? 'hero_image' : 'section_image';
}

// ── Gate ───────────────────────────────────────────────────────────────────

/**
 * Validate that image GENERATION may proceed. Requires:
 *  - approved sitemap + eligible copy (reuses the M4 brief gate), AND
 *  - a brief set that exists, belongs to the business, references the selected
 *    sitemap + copy artifact, and is in status `approved`, AND
 *  - every brief has slug + sectionName + visualObjective + forbiddenVisuals
 *    + mobileCropNotes (hero: + textSafeZone), AND no brief permits logo-as-hero, AND
 *  - generation was explicitly requested by the user/admin.
 */
export function canGenerateImages(
  sitemap: WebsiteSitemapArtifact | null,
  copy: CopyArtifactForBriefs | null,
  briefSet: BriefSetForGeneration | null,
  opts?: { sitemapId?: string | null; businessId?: string | null; requested?: boolean },
): ImageGenGateResult {
  // 1) Sitemap + copy gate (same guarantees as image briefs).
  const base = canGenerateImageBriefs(sitemap, copy, { sitemapId: opts?.sitemapId ?? null });
  if (!base.allowed) {
    return { allowed: false, code: base.code as ImageGenGateCode, reason: base.reason };
  }

  // 2) Brief set must exist.
  if (!briefSet || !briefSet.artifact) {
    return {
      allowed: false,
      code: 'brief_set_missing',
      reason: 'An approved image brief set is required before image generation.',
    };
  }

  // 3) Brief set must belong to the selected business.
  if (opts?.businessId && briefSet.businessId && briefSet.businessId !== opts.businessId) {
    return {
      allowed: false,
      code: 'brief_set_business_mismatch',
      reason: 'Image brief set does not belong to the selected business.',
    };
  }

  // 4) Brief set must reference the selected sitemap + copy artifact.
  const expectedSitemapId = opts?.sitemapId ?? null;
  if (expectedSitemapId && briefSet.sitemapId && briefSet.sitemapId !== expectedSitemapId) {
    return {
      allowed: false,
      code: 'brief_set_reference_mismatch',
      reason: 'Image brief set does not reference the approved sitemap.',
    };
  }
  if (copy?.sitemapId && briefSet.copyArtifactId && briefSet.copyArtifactId !== copy.sitemapId) {
    return {
      allowed: false,
      code: 'brief_set_reference_mismatch',
      reason: 'Image brief set does not reference the current copy artifact.',
    };
  }

  // 5) Brief set must be APPROVED.
  if (briefSet.status !== 'approved') {
    return {
      allowed: false,
      code: 'brief_set_not_approved',
      reason: `Image brief set status "${briefSet.status}" is not approved. Approve the briefs first.`,
    };
  }

  // 6) Every brief must have required fields; no brief may permit logo-as-hero.
  const missing: string[] = [];
  const logoBriefs: string[] = [];
  for (const page of briefSet.artifact.pages || []) {
    const slugOk = nonEmpty(page.slug);
    for (const brief of page.briefs || []) {
      if (
        !slugOk ||
        !nonEmpty(brief.sectionName) ||
        !nonEmpty(brief.visualObjective) ||
        !(brief.forbiddenVisuals && brief.forbiddenVisuals.length > 0) ||
        !nonEmpty(brief.mobileCropNotes) ||
        (brief.sectionType === 'hero' && !nonEmpty(brief.textSafeZone))
      ) {
        missing.push(brief.briefId || `${page.slug}:${brief.sectionName}`);
      }
      if (briefRequestsLogoAsHero(brief)) logoBriefs.push(brief.briefId);
      if (brief.sectionType === 'hero' && !heroBriefForbidsLogo(brief)) {
        logoBriefs.push(brief.briefId);
      }
    }
  }
  if (missing.length) {
    return {
      allowed: false,
      code: 'brief_missing_fields',
      reason: 'Every brief must have a page slug, section name, visual objective, forbidden visuals, mobile crop notes, and (for heroes) a text-safe zone.',
      blockingBriefIds: Array.from(new Set(missing)),
    };
  }
  if (logoBriefs.length) {
    return {
      allowed: false,
      code: 'logo_as_hero_forbidden',
      reason: 'One or more briefs permit a logo-as-hero visual, which is forbidden.',
      blockingBriefIds: Array.from(new Set(logoBriefs)),
    };
  }

  // 7) Generation must be explicitly requested.
  if (opts && opts.requested === false) {
    return {
      allowed: false,
      code: 'not_requested',
      reason: 'Image generation must be explicitly requested by the user or admin.',
    };
  }

  return { allowed: true, code: 'ok', reason: 'Approved briefs present; generation may proceed.' };
}

// ── Don render contract ─────────────────────────────────────────────────────

export interface DonContractContext {
  businessName?: string;
  serviceContext?: string;
  targetAudience?: string;
  brandColors?: string;
}

/**
 * Build a structured Don render contract from an APPROVED brief. Hero briefs
 * receive the full contract; section briefs a lighter variant. Deterministic.
 */
export function buildDonRenderContract(
  brief: ImageBrief,
  page: PageImageBriefs,
  sitemap: WebsiteSitemapArtifact | null,
  ctx?: DonContractContext,
): DonRenderContract {
  const isHero = brief.sectionType === 'hero';
  const sitemapPage = (sitemap?.pages || []).find((p) => p.slug === page.slug);
  const serviceName =
    (sitemapPage && (sitemapPage as any).serviceName) ||
    (sitemapPage && (sitemapPage as any).title) ||
    page.slug;
  const businessName = ctx?.businessName || 'the business';
  const serviceContext = ctx?.serviceContext || String(serviceName);

  return {
    briefId: brief.briefId,
    pageType: page.pageType,
    pageSlug: page.slug,
    sectionName: brief.sectionName,
    sectionType: brief.sectionType,
    assetRole: assetRoleForBrief(brief),
    businessName,
    serviceContext,
    targetAudience: ctx?.targetAudience || 'local customers searching for this service',
    visualConcept: brief.visualObjective,
    visualObjective: brief.visualObjective,
    businessSpecificDirection: brief.businessSpecificDirection,
    subject: String(serviceName),
    environment: brief.localDetails?.join('; ') || 'authentic on-site service environment',
    composition: isHero
      ? 'wide hero composition with a clear focal subject and breathing room for an overlay'
      : 'balanced supporting composition focused on the service detail',
    lighting: 'natural, realistic lighting appropriate to the setting',
    cameraAngle: isHero ? 'eye-level, slightly wide to establish context' : 'close, detail-oriented angle',
    foregroundElements: brief.industryDetails?.slice(0, 4) || [],
    backgroundElements: brief.localDetails?.slice(0, 4) || [],
    industryDetails: brief.industryDetails || [],
    localDetails: brief.localDetails || [],
    brandColorUsage: ctx?.brandColors
      ? `Use brand colors (${ctx.brandColors}) as tasteful accents only, never as a flat fill.`
      : 'Use brand colors as tasteful accents only, never as a flat fill.',
    textSafeZone: brief.textSafeZone,
    mobileCropSafeZone: brief.mobileCropNotes,
    desktopAspectRatio: brief.aspectRatio || (isHero ? '16:9' : '4:3'),
    mobileAspectRatio: isHero ? '4:5' : '1:1',
    forbiddenVisuals: brief.forbiddenVisuals || [],
    forbiddenTextInImage: brief.allowTextInImage !== true,
    assetSourcePreference: brief.assetSourcePreference,
    outputRequirements: {
      format: 'png',
      minWidth: isHero ? 1600 : 1024,
      minHeight: isHero ? 900 : 768,
      colorSpace: 'sRGB',
    },
  };
}

// ── R2 key pattern ──────────────────────────────────────────────────────────

function slugifyForKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function yyyymm(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Browsable, durable R2 key:
 *   website-assets/{businessId}/{yyyy-mm}/brief_{imageBriefId}/{section}-{role}.png
 */
export function buildWebsiteAssetR2Key(params: {
  businessId: string;
  imageBriefId: string;
  sectionName: string;
  assetRole: ImageAssetRole;
  ext?: string;
  now?: Date;
}): string {
  const ext = (params.ext || 'png').replace(/^\.+/, '');
  const month = yyyymm(params.now || new Date());
  const file = `${slugifyForKey(params.sectionName)}-${slugifyForKey(params.assetRole)}.${ext}`;
  return `website-assets/${params.businessId}/${month}/brief_${params.imageBriefId}/${file}`;
}

// ── Andy metadata normalization ─────────────────────────────────────────────

export interface NormalizedAndyResult {
  ok: boolean;
  reason?: string;
  metadata?: AndyRenderMetadata;
}

/**
 * Normalize + validate the metadata Andy returns. Rejects logo-as-hero results,
 * non-durable references, and signed URLs stored as the durable source.
 */
export function normalizeAndyRenderMetadata(raw: any): NormalizedAndyResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'No render metadata returned.' };
  }
  if (raw.rejectedLogoAsHero === true) {
    return { ok: false, reason: 'Andy rejected a logo-as-hero / generic filler asset.' };
  }
  const bucket = String(raw.r2Bucket || raw.bucket || '').trim();
  const key = String(raw.r2Key || raw.key || '').trim();
  if (!isDurableR2Reference(bucket, key)) {
    return { ok: false, reason: 'Render did not return a durable R2 bucket/key.' };
  }
  if (bucket !== GENERATED_IMAGE_BUCKET) {
    return { ok: false, reason: `Generated images must be stored in ${GENERATED_IMAGE_BUCKET}.` };
  }
  const metadata: AndyRenderMetadata = {
    provider: String(raw.provider || 'tombstone_andy'),
    model: String(raw.model || 'unknown'),
    r2Bucket: bucket,
    r2Key: key,
    mimeType: String(raw.mimeType || 'image/png'),
    width: Number.isFinite(raw.width) ? Number(raw.width) : undefined,
    height: Number.isFinite(raw.height) ? Number(raw.height) : undefined,
    altText: nonEmpty(raw.altText) ? String(raw.altText) : undefined,
    promptSummary: nonEmpty(raw.promptSummary) ? String(raw.promptSummary) : undefined,
    visualRationale: nonEmpty(raw.visualRationale) ? String(raw.visualRationale) : undefined,
    rejectedLogoAsHero: false,
    heroQa: raw.heroQa && typeof raw.heroQa === 'object' ? raw.heroQa : null,
  };
  return { ok: true, metadata };
}

// ── QA evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate hero QA. Prefers scores supplied by the Tombstone hero QA pass;
 * falls back to a deterministic score derived from the render + contract.
 */
export function evaluateHeroQa(input: {
  metadata: AndyRenderMetadata;
  contract: DonRenderContract;
  providerScores?: Partial<HeroQaResult> | null;
}): HeroQaResult {
  const supplied = input.providerScores || input.metadata.heroQa || null;
  if (supplied && Number.isFinite(supplied.heroVisualScore as number)) {
    const heroVisualScore = clampScore(supplied.heroVisualScore as number);
    const result: HeroQaResult = {
      heroVisualScore,
      mobileHeroScore: clampScore((supplied.mobileHeroScore as number) ?? heroVisualScore),
      brandFitScore: clampScore((supplied.brandFitScore as number) ?? heroVisualScore),
      textReadabilityScore: clampScore((supplied.textReadabilityScore as number) ?? heroVisualScore),
      focalPointScore: clampScore((supplied.focalPointScore as number) ?? heroVisualScore),
      qaStatus: 'failed',
      requiredFixes: Array.isArray(supplied.requiredFixes) ? supplied.requiredFixes : [],
    };
    result.qaStatus = result.heroVisualScore >= HERO_VISUAL_PASS_THRESHOLD ? 'passed' : 'failed';
    if (result.qaStatus === 'failed' && result.requiredFixes.length === 0) {
      result.requiredFixes = ['Hero visual score below threshold; regenerate with a stronger focal subject.'];
    }
    return result;
  }

  // Deterministic fallback.
  const fixes: string[] = [];
  let score = 92;
  if (!isDurableR2Reference(input.metadata.r2Bucket, input.metadata.r2Key)) {
    score -= 40;
    fixes.push('Render did not produce a durable asset.');
  }
  if (input.metadata.r2Bucket !== GENERATED_IMAGE_BUCKET) {
    score -= 40;
    fixes.push(`Asset stored in wrong bucket (expected ${GENERATED_IMAGE_BUCKET}).`);
  }
  if (!nonEmpty(input.contract.textSafeZone)) {
    score -= 10;
    fixes.push('Missing text-safe zone.');
  }
  if (!nonEmpty(input.contract.mobileCropSafeZone)) {
    score -= 10;
    fixes.push('Missing mobile crop-safe zone.');
  }
  const heroVisualScore = clampScore(score);
  const qaStatus = heroVisualScore >= HERO_VISUAL_PASS_THRESHOLD ? 'passed' : 'failed';
  if (qaStatus === 'failed' && fixes.length === 0) {
    fixes.push('Hero visual score below threshold.');
  }
  return {
    heroVisualScore,
    mobileHeroScore: clampScore(heroVisualScore - 2),
    brandFitScore: clampScore(heroVisualScore - 1),
    textReadabilityScore: clampScore(heroVisualScore - 1),
    focalPointScore: clampScore(heroVisualScore - 1),
    qaStatus,
    requiredFixes: fixes,
  };
}

/** Lighter validation for non-hero (section) images. */
export function evaluateNonHeroQa(input: {
  metadata: AndyRenderMetadata;
  contract: DonRenderContract;
  brief: ImageBrief;
}): NonHeroQaResult {
  const fixes: string[] = [];
  let brandFit = 88;
  if (!isDurableR2Reference(input.metadata.r2Bucket, input.metadata.r2Key)) {
    brandFit -= 40;
    fixes.push('Render did not produce a durable asset.');
  }
  if (input.brief.allowTextInImage !== true && input.contract.forbiddenTextInImage !== true) {
    fixes.push('Text should not be baked into the image unless explicitly approved.');
  }
  const qaStatus = fixes.length === 0 && brandFit >= 60 ? 'passed' : 'failed';
  return { qaStatus, brandFitScore: clampScore(brandFit), requiredFixes: fixes };
}

/** Map QA outcome to the persisted asset status. */
export function deriveStatusFromQa(
  sectionType: 'hero' | 'section',
  qaStatus: 'passed' | 'failed',
): GeneratedImageStatus {
  return qaStatus === 'passed' ? 'ready_for_review' : 'qa_failed';
}

// ── Validation of persisted records ─────────────────────────────────────────

/**
 * Validate a set of generated asset records against the durability + QA rules.
 * Returns a list of issues (empty = all valid). Diagnostic `failed` rows are
 * exempt from the durable-R2 requirement.
 */
export function validateGeneratedAssets(
  records: GeneratedImageAssetRecord[],
): GeneratedAssetValidationIssue[] {
  const issues: GeneratedAssetValidationIssue[] = [];
  for (const r of records) {
    if (!nonEmpty(r.imageBriefId) || !nonEmpty(r.imageBriefSetId)) {
      issues.push({ imageBriefId: r.imageBriefId, kind: 'missing_brief_link', reason: 'Asset is not linked to an image brief.' });
    }
    if (!nonEmpty(r.pageSlug) || !nonEmpty(r.sectionName)) {
      issues.push({ imageBriefId: r.imageBriefId, kind: 'missing_slug_or_section', reason: 'Asset is missing page slug or section name.' });
    }
    const isFailedDiagnostic = r.status === 'failed';
    if (!isFailedDiagnostic) {
      if (isSignedUrl(r.r2Key)) {
        issues.push({ imageBriefId: r.imageBriefId, kind: 'signed_url_stored', reason: 'A signed URL was stored as the durable reference.' });
      }
      if (!isDurableR2Reference(r.r2Bucket, r.r2Key)) {
        issues.push({ imageBriefId: r.imageBriefId, kind: 'non_durable_r2', reason: 'Asset does not have a durable R2 bucket/key.' });
      } else if (r.r2Bucket !== GENERATED_IMAGE_BUCKET) {
        issues.push({ imageBriefId: r.imageBriefId, kind: 'wrong_bucket', reason: `Generated image stored in wrong bucket (expected ${GENERATED_IMAGE_BUCKET}).` });
      }
      if (r.assetRole === 'hero_image' && !Number.isFinite(r.qualityScore as number)) {
        issues.push({ imageBriefId: r.imageBriefId, kind: 'hero_missing_qa', reason: 'Hero image is missing QA scores.' });
      }
    }
    if (r.assetRole === 'hero_image' && r.status === 'approved' && r.qaStatus === 'failed') {
      issues.push({ imageBriefId: r.imageBriefId, kind: 'failed_hero_approved', reason: 'A hero image that failed QA cannot be approved.' });
    }
  }
  return issues;
}

/** Guard: a hero asset may only transition to approved when QA passed. */
export function canApproveAsset(record: {
  assetRole: ImageAssetRole;
  qaStatus: string | null;
  status: string;
}): { allowed: boolean; reason: string } {
  if (record.status === 'failed') {
    return { allowed: false, reason: 'A failed asset cannot be approved.' };
  }
  if (record.assetRole === 'hero_image' && record.qaStatus === 'failed') {
    return { allowed: false, reason: 'A hero image that failed QA cannot be approved.' };
  }
  return { allowed: true, reason: 'Approval allowed.' };
}
