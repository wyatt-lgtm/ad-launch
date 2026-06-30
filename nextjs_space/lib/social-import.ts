/**
 * Shared Tombstone -> Launch OS social-content import core.
 *
 * Extracted so BOTH the on-demand poll (`/api/social/missions/poll`) and the
 * admin backfill endpoint (`/api/admin/social/import-missed-tombstone-content`)
 * use IDENTICAL discovery, enrichment, R2-key normalization, duplicate
 * detection, attribution and classification logic.
 *
 * Hard rules baked in here:
 *  - We store the DURABLE R2 object KEY (never a signed/presigned URL).
 *  - Imported posts are ALWAYS status `pending_approval` (or a diagnostic
 *    `generation_incomplete` / `generation_failed` shell). Import NEVER
 *    publishes anything anywhere.
 *  - Business scoping is preserved: a task discovered via a business lane is
 *    attributed to that business's Launch OS id; cross-business leakage is
 *    impossible because the queue is filtered per business_id server-side.
 */

export const TOMBSTONE_URL =
  process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export type FetchFn = typeof fetch;

export interface EnrichedPost {
  tombstoneTaskId: string;
  workflowId: string | null;
  caption: string;
  hashtags: string[];
  imageUrl: string | null;
  postType: string;
  sourceType: string | null;
  newsAngle: string | null;
  platforms: string[];
  sourceName: string | null;
  sourceArticleTitle: string | null;
  sourceArticleUrl: string | null;
  cta: string | null;
  createdAt: string | null;
}

export interface RejectedItem {
  tombstoneTaskId: string;
  reason: string;
}

export type ImportStatus =
  | 'pending_approval'
  | 'generation_incomplete'
  | 'generation_failed';

export const DEFAULT_PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'pinterest',
  'snapchat',
];

/**
 * Normalize a raw image reference into the durable R2 object key.
 *
 * Presigned R2 URLs look like:
 *   https://<acct>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-...
 * We strip the scheme/host, the query string, and the leading bucket prefix
 * (`tombstoner2/`) so only the stable artifact key remains, e.g.
 *   renders/task_1559/task_1559_1700000000.png
 *
 * Non-http inputs (already-bare keys) are returned unchanged.
 */
export function normalizeR2Key(rawImageUrl: string | null | undefined): string {
  const raw = (rawImageUrl || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('http')) return raw;
  try {
    const parsed = new URL(raw);
    // pathname is like /tombstoner2/renders/task_1559/file.png (query already excluded)
    let pathPart = parsed.pathname.replace(/^\//, '');
    const bucketPrefix = 'tombstoner2/';
    if (pathPart.startsWith(bucketPrefix)) {
      pathPart = pathPart.slice(bucketPrefix.length);
    }
    return pathPart;
  } catch {
    return raw;
  }
}

/**
 * A caption is usable unless it is empty or a parent multi-campaign placeholder.
 */
export function isUsableCaption(caption: string | null | undefined): boolean {
  const c = (caption || '').trim();
  if (!c) return false;
  if (c.startsWith('Multi-campaign render')) return false;
  return true;
}

export interface Classification {
  status: ImportStatus;
  missingFields: string[];
  importError: string | null;
  hasCaption: boolean;
  hasImage: boolean;
}

/**
 * Classify an enriched post into complete / incomplete / failed and record the
 * missing required fields. Mirrors the poll route's validation exactly.
 */
export function classifyPost(post: EnrichedPost): Classification {
  const missing: string[] = [];
  if (!post.caption?.trim()) missing.push('caption');
  if (!post.imageUrl) missing.push('imageUrl');
  if (!post.cta) missing.push('cta');
  if (!post.sourceName && !post.sourceArticleTitle) missing.push('source_attribution');
  if (!post.sourceArticleUrl) missing.push('sourceArticleUrl');

  const hasCaption = !!post.caption?.trim();
  const hasImage = !!post.imageUrl;

  if (hasCaption || hasImage) {
    if (missing.length > 0 && !hasCaption) {
      return {
        status: 'generation_incomplete',
        missingFields: missing,
        importError: `Missing required fields: ${missing.join(', ')}`,
        hasCaption,
        hasImage,
      };
    }
    return {
      status: 'pending_approval',
      missingFields: missing,
      importError: null,
      hasCaption,
      hasImage,
    };
  }

  return {
    status: 'generation_failed',
    missingFields: missing,
    importError: `No usable output — missing: ${missing.join(', ')}`,
    hasCaption,
    hasImage,
  };
}

/**
 * Fetch the publish-ready content queue for a single Tombstone business.
 * Returns an array of raw queue items (never throws — returns [] on error).
 */
export async function fetchQueueByBusiness(
  tsBizId: number,
  opts: { limit?: number; fetchFn?: FetchFn } = {}
): Promise<any[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 100;
  try {
    const res = await fetchFn(
      `${TOMBSTONE_URL}/content/queue?limit=${limit}&business_id=${tsBizId}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * Fetch the publish-ready content queue for a set of workflow IDs.
 */
export async function fetchQueueByWorkflows(
  workflowIds: string[],
  opts: { limit?: number; fetchFn?: FetchFn } = {}
): Promise<any[]> {
  if (!workflowIds.length) return [];
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = opts.limit ?? 100;
  try {
    const res = await fetchFn(
      `${TOMBSTONE_URL}/content/queue?limit=${limit}&workflow_ids=${encodeURIComponent(
        workflowIds.join(',')
      )}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * Enrich a single raw queue item with caption / cta / hashtags / source
 * attribution from the `/content/<id>` detail endpoint, normalize its image
 * to a durable R2 key, and resolve its workflow_id if missing.
 *
 * Returns either an EnrichedPost or a RejectedItem with a human reason.
 */
export async function enrichQueueItem(
  item: any,
  opts: { fetchFn?: FetchFn } = {}
): Promise<EnrichedPost | RejectedItem> {
  const fetchFn = opts.fetchFn ?? fetch;
  const taskId = String(item.task_id);
  try {
    const detailRes = await fetchFn(`${TOMBSTONE_URL}/content/${item.task_id}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!detailRes.ok) {
      return { tombstoneTaskId: taskId, reason: `detail_fetch_failed_${detailRes.status}` };
    }
    const detail = await detailRes.json();

    const caption = detail.base_caption || detail.preview_text || item.preview_text || '';
    const cta = detail.cta || '';
    const hashtags = Array.isArray(detail.hashtags) ? detail.hashtags : [];

    const srcAttr = detail.source_attribution || {};
    const sourceName = srcAttr.source_name || null;
    const sourceArticleTitle = srcAttr.article_title || null;
    const sourceArticleUrl = srcAttr.article_url || null;

    const rawImageUrl = item.first_image_url || '';
    const imageKey = normalizeR2Key(rawImageUrl);

    // Resolve workflow_id from the task endpoint if the queue item lacked it.
    let resolvedWorkflowId = item.workflow_id || null;
    if (!resolvedWorkflowId) {
      try {
        const taskRes = await fetchFn(`${TOMBSTONE_URL}/tasks/${item.task_id}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (taskRes.ok) {
          const taskData = await taskRes.json();
          resolvedWorkflowId = taskData.workflow_id || null;
        }
      } catch {
        /* non-critical */
      }
    }

    const pv = detail.platform_variants;
    let campaignName = '';
    if (Array.isArray(pv) && pv.length > 0) {
      campaignName = pv[0]?.campaign_name || '';
    }

    if (!isUsableCaption(caption)) {
      return { tombstoneTaskId: taskId, reason: 'no_usable_caption' };
    }

    return {
      tombstoneTaskId: taskId,
      workflowId: resolvedWorkflowId,
      caption: caption + (cta ? `\n\n${cta}` : ''),
      hashtags,
      imageUrl: imageKey || null,
      postType: 'general',
      sourceType: campaignName ? 'campaign' : null,
      newsAngle: campaignName || null,
      platforms: DEFAULT_PLATFORMS,
      sourceName,
      sourceArticleTitle,
      sourceArticleUrl,
      cta: cta || null,
      createdAt: item.created_at || detail.created_at || null,
    };
  } catch (e: any) {
    return { tombstoneTaskId: taskId, reason: `enrich_error_${e?.message || 'unknown'}` };
  }
}

export function isRejected(
  x: EnrichedPost | RejectedItem
): x is RejectedItem {
  return (x as RejectedItem).reason !== undefined;
}

/**
 * Filter a list of raw queue items down to those created on/after `since`.
 * Items with an unparseable/missing created_at are KEPT (fail-open) so we never
 * silently drop a render just because its timestamp is malformed.
 */
export function filterBySince(items: any[], since?: string | null): any[] {
  if (!since) return items;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return items;
  return items.filter((it) => {
    const ts = it?.created_at;
    if (!ts) return true;
    const ms = Date.parse(String(ts));
    if (Number.isNaN(ms)) return true;
    return ms >= sinceMs;
  });
}

export interface BuildRecordOpts {
  userId: string;
  analysisId: string | null;
  businessId: string | null;
  classification: Classification;
  generationRunId?: string | null;
  generationStartedAt?: Date | null;
  generationCompletedAt: Date;
  totalGenerationTimeMs?: number | null;
}

/**
 * Build the SocialPost row for an enriched post. Status is derived from the
 * classification and is ALWAYS one of pending_approval / generation_incomplete
 * / generation_failed — never a published state.
 */
export function buildSocialPostRecord(post: EnrichedPost, opts: BuildRecordOpts) {
  const { classification } = opts;
  const isComplete = classification.status === 'pending_approval';
  const diagCaption = isComplete
    ? post.caption
    : post.caption?.trim()
    ? post.caption
    : `[${
        classification.status === 'generation_incomplete'
          ? 'Generation incomplete'
          : 'Generation failed'
      } — ${classification.importError || 'no usable output'}]`;

  return {
    userId: opts.userId,
    analysisId: opts.analysisId,
    businessId: opts.businessId,
    caption: diagCaption,
    hashtags: isComplete ? post.hashtags : [],
    imageUrl: post.imageUrl,
    imagePrompt: null,
    postType: post.postType || 'general',
    sourceType: post.sourceType,
    newsAngle: post.newsAngle,
    patternType: null,
    rssItemTitle: isComplete ? null : post.sourceArticleTitle || null,
    rssItemLink: isComplete ? null : post.sourceArticleUrl || null,
    platforms: post.platforms || [],
    status: classification.status,
    tombstoneTaskId: post.tombstoneTaskId || null,
    workflowId: post.workflowId || null,
    sourceName: post.sourceName || null,
    sourceArticleTitle: post.sourceArticleTitle || null,
    sourceArticleUrl: post.sourceArticleUrl || null,
    cta: post.cta || null,
    generationRunId: opts.generationRunId || null,
    generationStartedAt: opts.generationStartedAt || null,
    generationCompletedAt: opts.generationCompletedAt,
    totalGenerationTimeMs: opts.totalGenerationTimeMs ?? null,
  };
}
