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

/** Raw render result returned by the Tombstone backend (validated downstream). */
export interface RenderProviderResult {
  provider?: string;
  model?: string;
  r2Bucket?: string;
  r2Key?: string;
  bucket?: string;
  key?: string;
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
}

/**
 * A render provider takes a Don contract and returns a structured render result.
 * The default implementation delegates to the Tombstone backend; tests inject a
 * mock.
 */
export type WebsiteImageRenderProvider = (
  contract: DonRenderContract,
) => Promise<RenderProviderResponse>;

/** True when the render provider (Tombstone backend) is reachable/configured. */
export function isImageRenderProviderConfigured(): boolean {
  return Boolean(TOMBSTONE_URL);
}

/**
 * Default provider: POST the Don contract to the Tombstone backend render
 * endpoint. Any network / non-2xx / malformed response fails cleanly.
 */
export async function renderWebsiteImageViaTombstone(
  contract: DonRenderContract,
): Promise<RenderProviderResponse> {
  const url = `${TOMBSTONE_URL.replace(/\/+$/, '')}/website-images/render`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract }),
      // Keep a bounded wait so a cold backend does not hang the request.
      signal: AbortSignal.timeout ? AbortSignal.timeout(120_000) : undefined,
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
  return { ok: true, result };
}
