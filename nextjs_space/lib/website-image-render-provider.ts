/**
 * Milestone 5 — Website image render provider seam.
 *
 * The Next.js app does NOT hold R2 (Cloudflare) write credentials; the R2
 * bucket `tombstoner2` is owned by the Tombstone backend, which runs Don
 * (render-contract validation), Andy (generation/selection + logo-as-hero
 * rejection), the R2 upload, and the hero QA pass. This module is the ONLY
 * seam through which Milestone 5 requests a durable render.
 *
 * It POSTs a structured Don render contract to the Tombstone backend and
 * expects a structured result containing the DURABLE R2 bucket/key (never a
 * signed URL), provider/model, Andy metadata, and optional hero QA scores.
 *
 * HARD BOUNDARIES: this module performs NO local image generation, NO local
 * R2 upload, NO static build, NO publish, NO deploy. If the backend endpoint
 * is unavailable it fails CLEANLY (no partial success) so the orchestrator can
 * record a diagnostic `failed` asset. The provider is injectable so tests can
 * supply a mock without any network access.
 */
import type { DonRenderContract } from '@/lib/website-image-generation';

const TOMBSTONE_URL =
  process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Client-side timeout for the website image render call ONLY (this seam). A
 * live hero render on a cold backend can take multiple minutes, so the default
 * is generous (240s) and is configurable via WEBSITE_RENDER_TIMEOUT_MS. It is
 * clamped to a sane band and is NOT applied to any other API. Unrelated
 * network calls elsewhere keep their own timeouts.
 */
const RENDER_TIMEOUT_MIN_MS = 30_000;
const RENDER_TIMEOUT_MAX_MS = 300_000;
const RENDER_TIMEOUT_DEFAULT_MS = 240_000;
export function websiteRenderTimeoutMs(): number {
  const raw = Number(process.env.WEBSITE_RENDER_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return RENDER_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.max(Math.floor(raw), RENDER_TIMEOUT_MIN_MS), RENDER_TIMEOUT_MAX_MS);
}

/** Raw render result returned by the Tombstone backend (validated downstream). */
export interface RenderProviderResult {
  provider?: string;
  model?: string;
  r2Bucket?: string;
  r2Key?: string;
  bucket?: string;
  key?: string;
  /** Backend status; `validated` indicates a dry-run (no image generated). */
  status?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  altText?: string;
  promptSummary?: string;
  visualRationale?: string;
  rejectedLogoAsHero?: boolean;
  heroQa?: Record<string, unknown> | null;
}

export interface RenderProviderResponse {
  ok: boolean;
  /** Present on success. */
  result?: RenderProviderResult;
  /** Present on failure — human-readable diagnostic. */
  error?: string;
  /** True when the failure is safe to retry once (transient / server error). */
  retryable?: boolean;
  /** True when the prompt was blocked by moderation — MUST NOT retry unchanged. */
  moderationBlocked?: boolean;
  /** True when this response is a dry-run validation (no image generated). */
  dryRun?: boolean;
}

/**
 * Extra per-call context the provider needs but that is not part of the Don
 * render contract itself (the contract has no businessId field). The backend
 * uses `businessId` to build the durable, business-scoped R2 key.
 */
export interface RenderProviderContext {
  businessId?: string | number;
  /**
   * When true, the backend VALIDATES the contract and returns the durable
   * expected R2 key WITHOUT generating an image or uploading any R2 object.
   * Used by the dry-run gate check so callers can preview the contract and
   * expected key at zero cost. No asset row is persisted for dry-run results.
   */
  dryRun?: boolean;
  /**
   * Stable per-request idempotency key (businessId + brief set + brief + page +
   * section + attempt). Sent to the backend so a backend that supports it can
   * dedupe an in-flight render and avoid producing a duplicate R2 object if a
   * retry arrives while the first render is still running. Harmless if the
   * backend ignores it.
   */
  idempotencyKey?: string;
}

/**
 * A render provider takes a Don contract (+ optional context) and returns a
 * structured render result. The default implementation delegates to the
 * Tombstone backend; tests inject a mock.
 */
export type WebsiteImageRenderProvider = (
  contract: DonRenderContract,
  ctx?: RenderProviderContext,
) => Promise<RenderProviderResponse>;

/** True when the render provider (Tombstone backend) is reachable/configured. */
export function isImageRenderProviderConfigured(): boolean {
  return Boolean(TOMBSTONE_URL);
}

/**
 * Best-effort warm-up ping so the first live render does not pay the full cold
 * start inside the render call. Hits a cheap GET on the backend root with a
 * short timeout and NEVER triggers image generation. All errors are swallowed;
 * warm-up must never block or fail a render.
 */
export async function warmUpRenderProvider(): Promise<boolean> {
  const base = TOMBSTONE_URL.replace(/\/+$/, '');
  for (const path of ['/health', '/']) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        signal: AbortSignal.timeout ? AbortSignal.timeout(20_000) : undefined,
      });
      if (res.ok) return true;
    } catch {
      /* ignore — warm-up is best-effort only */
    }
  }
  return false;
}

/**
 * Default provider: POST the Don contract to the Tombstone backend render
 * endpoint. Any network / non-2xx / malformed response fails cleanly.
 */
export async function renderWebsiteImageViaTombstone(
  contract: DonRenderContract,
  ctx?: RenderProviderContext,
): Promise<RenderProviderResponse> {
  const url = `${TOMBSTONE_URL.replace(/\/+$/, '')}/website-images/render`;
  const serviceToken = process.env.WEBSITE_RENDER_SERVICE_TOKEN ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (serviceToken) headers['X-Service-Token'] = serviceToken;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contract,
        businessId: ctx?.businessId,
        dry_run: ctx?.dryRun === true,
        idempotency_key: ctx?.idempotencyKey,
      }),
      // Bounded wait scoped to THIS render call only (see websiteRenderTimeoutMs).
      signal: AbortSignal.timeout ? AbortSignal.timeout(websiteRenderTimeoutMs()) : undefined,
    });
  } catch (err: any) {
    return {
      ok: false,
      error: `Render provider unreachable: ${err?.message || 'network error'}`,
      retryable: true,
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      error:
        'Render endpoint not available on the backend yet. Live image generation requires the Tombstone /website-images/render endpoint.',
      retryable: false,
    };
  }
  if (res.status === 422 || res.status === 400) {
    // Treat client-side validation / moderation rejections as non-retryable.
    let detail = '';
    try {
      const j = await res.json();
      detail = String(j?.detail || j?.error || '');
    } catch {
      /* ignore */
    }
    const moderationBlocked = /moderat|safety|blocked|policy/i.test(detail);
    return {
      ok: false,
      error: detail || 'Render request rejected by the backend.',
      retryable: false,
      moderationBlocked,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Render provider error (${res.status}).`,
      retryable: res.status >= 500,
    };
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'Render provider returned a malformed response.', retryable: false };
  }
  const result: RenderProviderResult = body?.result && typeof body.result === 'object' ? body.result : body;
  const dryRun = ctx?.dryRun === true || /^validated$/i.test(String(result?.status ?? ''));
  return { ok: true, result, dryRun };
}
