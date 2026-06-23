import { loadBusinessProfile, formatProfileForCommand, isStale } from '@/lib/business-profile';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// ── Fallback Image Generation ──────────────────────────────────────────────────
// Env vars:
//   IMAGE_PROVIDER       — "openai" (default). Controls which provider to use.
//   OPENAI_IMAGE_MODEL   — "gpt-image-2" (default). Must match Render env.
//   OPENAI_API_KEY       — Required when IMAGE_PROVIDER=openai.
// DALL-E 3 is NOT used unless OPENAI_IMAGE_MODEL is explicitly set to "dall-e-3".

interface FallbackImageResult {
  imageUrl: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  degraded: boolean;  // true if image gen failed but copy exists
}

/**
 * Generate a fallback image when Tombstone Render Production fails.
 * Uses the Creative Direction render_prompt to produce a social-media-ready image.
 * Provider & model controlled by IMAGE_PROVIDER / OPENAI_IMAGE_MODEL env vars.
 */
async function generateFallbackImage(renderPrompt: string, meta?: { workflowId?: string; taskId?: string; lane?: string }): Promise<FallbackImageResult> {
  // ── DIAGNOSTIC: disabled during debugging ─────────────────────────────
  // Frontend fallback is disabled to prevent double-calling OpenAI while
  // we diagnose the 429/HTML issue. Backend (Andy Warhol) is the sole renderer.
  const FALLBACK_DISABLED = process.env.DISABLE_FRONTEND_FALLBACK !== 'false'; // disabled unless explicitly set to "false"
  if (FALLBACK_DISABLED) {
    console.warn(
      `[generateFallbackImage] ⛔ DISABLED — frontend fallback is turned off during debugging. ` +
      `Set DISABLE_FRONTEND_FALLBACK=false to re-enable. ` +
      `workflow=${meta?.workflowId ?? 'n/a'} lane=${meta?.lane ?? 'n/a'}`
    );
    return { imageUrl: null, provider: null, model: null, error: 'Frontend fallback disabled during debugging', degraded: true };
  }

  const provider = (process.env.IMAGE_PROVIDER ?? 'openai').toLowerCase();
  const openaiModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
  const openaiKey = process.env.OPENAI_API_KEY;
  const keySuffix = openaiKey ? `...${openaiKey.slice(-6)}` : 'MISSING';
  const endpoint = 'https://api.openai.com/v1/images/generations';
  const metaTag = `workflow=${meta?.workflowId ?? 'n/a'} task=${meta?.taskId ?? 'n/a'} lane=${meta?.lane ?? 'n/a'}`;

  const fail = (error: string): FallbackImageResult => {
    console.error(`[generateFallbackImage] FAILED provider=${provider} model=${openaiModel} key=${keySuffix} ${metaTag} error="${error}"`);
    return { imageUrl: null, provider, model: openaiModel, error, degraded: true };
  };

  if (provider !== 'openai') {
    return fail(`Unsupported IMAGE_PROVIDER="${provider}". Only "openai" is supported.`);
  }

  if (!openaiKey) {
    return fail('OPENAI_API_KEY is not configured. Cannot generate fallback image.');
  }

  console.log(
    `[generateFallbackImage] ⚠️ FRONTEND_FALLBACK Starting: ` +
    `endpoint=${endpoint} method=POST provider=${provider} model=${openaiModel} ` +
    `key=${keySuffix} prompt_len=${renderPrompt.length} ${metaTag}`
  );

  const isDalle = openaiModel.startsWith('dall-e');
  const maxPromptLen = isDalle ? 4000 : 32000;
  const truncatedPrompt = renderPrompt.slice(0, maxPromptLen);

  // Single attempt only — no blind retry while diagnosing
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000); // 180s — production 1024x1536+high can take 120-150s

    const body: Record<string, any> = {
      model: openaiModel,
      prompt: truncatedPrompt,
      n: 1,
      size: isDalle ? '1024x1024' : '1024x1536',
    };
    if (isDalle) {
      body.quality = 'standard';
    } else {
      body.quality = 'medium';
    }

    const startTime = Date.now();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ── DIAGNOSTIC: log full response metadata ─────────────────────────
    const contentType = res.headers.get('content-type') ?? 'null';
    const retryAfterRaw = res.headers.get('retry-after');
    const ratelimitHeaders: Record<string, string | null> = {};
    res.headers.forEach((v, k) => {
      if (k.startsWith('x-ratelimit')) ratelimitHeaders[k] = v;
    });
    console.log(
      `[generateFallbackImage] RESPONSE status=${res.status} elapsed=${elapsed}s ` +
      `content-type="${contentType}" retry-after-raw="${retryAfterRaw ?? 'null'}" ` +
      `x-ratelimit=${JSON.stringify(ratelimitHeaders)} ` +
      `endpoint=${endpoint} model=${openaiModel} key=${keySuffix} ${metaTag}`
    );

    if (res.ok) {
      const data = await res.json();
      const item = data?.data?.[0];
      const rawUrl = item?.url ?? null;
      const b64 = item?.b64_json ?? null;

      if (rawUrl) {
        console.log(`[generateFallbackImage] SUCCESS format=url elapsed=${elapsed}s ${metaTag}`);
        return { imageUrl: rawUrl, provider, model: openaiModel, error: null, degraded: false };
      }
      if (b64) {
        const dataUrl = `data:image/png;base64,${b64}`;
        console.log(`[generateFallbackImage] SUCCESS format=b64 elapsed=${elapsed}s ${metaTag}`);
        return { imageUrl: dataUrl, provider, model: openaiModel, error: null, degraded: false };
      }

      return fail(`200 OK but no image data. Response keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
    }

    // ── Non-OK: read body for diagnostics ────────────────────────────
    const rawBody = await res.text().catch(() => '');
    const isJson = contentType.includes('application/json');
    const isHtml = rawBody.trimStart().startsWith('<') || contentType.includes('text/html');
    let bodyPreview: string;
    let parsedError: { type?: string; code?: string; message?: string } | null = null;

    if (isJson) {
      try {
        const parsed = JSON.parse(rawBody);
        parsedError = {
          type: parsed?.error?.type,
          code: parsed?.error?.code,
          message: parsed?.error?.message?.slice(0, 300),
        };
        bodyPreview = JSON.stringify(parsedError);
      } catch {
        bodyPreview = rawBody.slice(0, 300);
      }
    } else if (isHtml) {
      bodyPreview = `[HTML] ${rawBody.slice(0, 300)}`;
    } else {
      bodyPreview = rawBody.slice(0, 300);
    }

    console.error(
      `[generateFallbackImage] HTTP_ERROR status=${res.status} ` +
      `content-type="${contentType}" is_json=${isJson} is_html=${isHtml} ` +
      `retry-after-raw="${retryAfterRaw ?? 'null'}" ` +
      `body_preview=${bodyPreview} ` +
      `x-ratelimit=${JSON.stringify(ratelimitHeaders)} ` +
      `endpoint=${endpoint} model=${openaiModel} key=${keySuffix} ${metaTag}`
    );

    if (isHtml && res.status === 429) {
      return fail(
        `429 with HTML body — this is NOT an OpenAI API error. Likely Cloudflare WAF or CDN rate limit. ` +
        `The request may not have reached OpenAI. Check: (1) API key project rate limits in OpenAI dashboard, ` +
        `(2) IP-level blocks, (3) Cloudflare configuration. ` +
        `retry-after-raw="${retryAfterRaw}" content-type="${contentType}"`
      );
    }

    return fail(
      `HTTP ${res.status} | content-type="${contentType}" | ` +
      `${parsedError ? `type=${parsedError.type} code=${parsedError.code} msg=${parsedError.message}` : `body=${bodyPreview.slice(0, 200)}`}`
    );
  } catch (e: any) {
    const isTimeout = e?.name === 'AbortError';
    const errMsg = isTimeout ? 'Request timed out (60s)' : (e?.message ?? String(e));
    return fail(`${errMsg} | endpoint=${endpoint} model=${openaiModel} key=${keySuffix}`);
  }
}

/**
 * Load saved business profile and format as a command block.
 * Returns empty string if no profile exists.
 */
async function getBusinessProfileBlock(businessId: string | undefined, workflowId?: string): Promise<string> {
  if (!businessId) return '';
  try {
    const result = await loadBusinessProfile(businessId);
    if (!result) return '';
    if (isStale(result.ageDays)) {
      console.log(
        `SOCIAL_BUSINESS_CONTEXT_REFRESH_STARTED business_id=${businessId} ` +
        `analysis_age_days=${result.ageDays} workflow_id=${workflowId || 'n/a'}`,
      );
      // Profile is stale — still use it but don't block. Jim Bridger will
      // do a light refresh when it detects the stale marker.
    }
    return '\n' + formatProfileForCommand(result.profile) + '\n';
  } catch {
    return '';
  }
}

/**
 * Create a PROVISIONAL business in Tombstone OS so the integer business_id
 * required by the /commands isolation gate exists BEFORE any content command
 * is sent. Called from the Ad Launch confirm-and-launch flow right after the
 * customer verifies their address (and before they register an account).
 *
 * Returns { businessId, businessUuid } on success. Throws a structured
 * TombstoneError on failure so callers can surface the real backend status
 * instead of masking it.
 */
export class TombstoneError extends Error {
  stage: string;
  backendStatus: number | null;
  backendError: string | null;
  constructor(stage: string, message: string, backendStatus: number | null = null, backendError: string | null = null) {
    super(message);
    this.name = 'TombstoneError';
    this.stage = stage;
    this.backendStatus = backendStatus;
    this.backendError = backendError;
  }
}

export async function createProvisionalBusiness(input: {
  businessName: string;
  address?: string;
  website?: string;
  phone?: string;
}): Promise<{ businessId: number; businessUuid: string }> {
  const businessName = (input.businessName || '').trim();
  if (!businessName) {
    throw new TombstoneError('provisional_business', 'businessName is required to create a provisional business');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(`${TOMBSTONE_URL}/businesses/provisional`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_name: businessName,
        address: input.address || undefined,
        website: input.website || undefined,
        phone: input.phone || undefined,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new TombstoneError('provisional_business', `Failed to reach Tombstone /businesses/provisional: ${err?.message || err}`, null, String(err?.message || err));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    console.error('[tombstone] /businesses/provisional error:', res.status, detail);
    throw new TombstoneError('provisional_business', `Provisional business creation failed: ${detail}`, res.status, String(detail));
  }
  const businessId = data?.business_id;
  const businessUuid = data?.business_uuid;
  if (businessId == null || businessUuid == null) {
    throw new TombstoneError('provisional_business', 'Provisional business response missing business_id/business_uuid', res.status, JSON.stringify(data));
  }
  console.log(`[tombstone] Provisional business created: business_id=${businessId} uuid=${businessUuid}`);
  return { businessId: Number(businessId), businessUuid: String(businessUuid) };
}

// ── Async command run (parallel lanes) ──────────────────────────────────

export interface AsyncLaneConfig {
  lane_type: 'website_post' | 'evergreen_post' | 'scout_news_retrieval' | 'news_post';
  command: string;
  context?: string; // For scout lane — raw RSS context
}

export interface AsyncRunResult {
  command_id: string;
  status: string;
  duplicate: boolean;
  lanes: Array<{
    lane_id: string;
    lane_type: string;
    status: string;
    workflow_id?: string | null;
    task_ids?: number[];
  }>;
}

export interface AsyncRunStatus {
  command_id: string;
  status: string;
  business_id?: number | null;
  business_name?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  lanes: Array<{
    lane_id: string;
    lane_type: string;
    status: string;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    duration_ms?: number | null;
    workflow_id?: string | null;
    task_ids?: number[];
    error_message?: string | null;
    warning_message?: string | null;
  }>;
}

/**
 * Create an async multi-lane command run on Tombstone.
 * Returns immediately with a command_id. Lanes are processed in background.
 *
 * This replaces the sequential sendCommand() calls for the 3-lane flow.
 * Website + evergreen lanes run in parallel, scout/news lane runs
 * concurrently (scout first, then news).
 */
export async function createAsyncRun(
  businessId: number | null,
  businessName: string,
  websiteUrl: string,
  lanes: AsyncLaneConfig[],
  idempotencyKey?: string,
): Promise<AsyncRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // 90s — Render cold-starts can take 30-60s on first request of the day
  try {
    const res = await fetch(`${TOMBSTONE_URL}/commands/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: businessId,
        business_name: businessName,
        website_url: websiteUrl,
        lanes,
        idempotency_key: idempotencyKey,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const detail = data?.detail || `HTTP ${res.status}`;
      throw new TombstoneError('async_run', `Failed to create async run: ${detail}`, res.status, detail);
    }
    console.log(`[tombstone] Async run created: command_id=${data.command_id} duplicate=${data.duplicate} lanes=${data.lanes?.length}`);
    return data as AsyncRunResult;
  } catch (err: any) {
    if (err instanceof TombstoneError) throw err;
    throw new TombstoneError('async_run', `Failed to reach Tombstone /commands/run: ${err?.message}`, null, err?.message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll the status of an async command run.
 * Returns per-lane progress with timing, workflow IDs, and errors.
 */
export async function pollRunStatus(commandId: string): Promise<AsyncRunStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${TOMBSTONE_URL}/commands/${commandId}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[tombstone] Poll /commands/${commandId} failed: ${res.status}`);
      return null;
    }
    return await res.json() as AsyncRunStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recovery endpoint: look up a command run by its idempotency key.
 *
 * When the frontend's initial POST /commands/run times out (no command_id
 * received), the frontend can call this with the analysisId (which was
 * used as the idempotency_key) to see if Tombstone actually created
 * and/or completed the run.
 *
 * Returns the full AsyncRunStatus if found, null if not.
 */
export async function recoverRunByIdempotencyKey(key: string): Promise<AsyncRunStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(
      `${TOMBSTONE_URL}/commands/by-idempotency-key/${encodeURIComponent(key)}`,
      { cache: 'no-store', signal: controller.signal },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[tombstone] Recovery by idempotency key failed: ${res.status}`);
      return null;
    }
    return await res.json() as AsyncRunStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build lane commands for the 3-lane async run.
 * This constructs the command text for each lane type.
 */
export async function buildLaneCommands(
  websiteUrl: string,
  businessName: string,
  businessCity: string,
  businessState: string,
  businessId: string | undefined,
  newsContext: string,
  holidayContext: string,
): Promise<AsyncLaneConfig[]> {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const profileBlock = await getBusinessProfileBlock(businessId);
  const identityLock = buildIdentityLockBlock(businessName, normalizedUrl, normalizedUrl);

  const ctaRules = [
    `CTA RULES:`,
    `- The CTA button MUST relate to the business's actual service/product found on the website.`,
    `- Good examples: "Get a Free Quote", "Book Now", "Schedule Service", "Shop Now", "Learn More", "Call Today"`,
    `- NEVER use generic CTAs like "Check Availability" unless the business is actually a booking/reservation service.`,
    `- Read the website to understand what action a customer would take, then make the CTA match that action.`,
  ].join('\n');

  const websiteCommand = [
    identityLock,
    `review ${normalizedUrl} and create 1 social media post promoting the business.`,
    `Focus on the business brand, services, offers, and unique value proposition found on the website.`,
    `Use colors, logo, and brand voice from the website. Make it feel authentic — like the business owner wrote it.`,
    profileBlock,
    `Additional context:\nBusiness: ${businessName} in ${businessCity}, ${businessState}`,
  ].filter(Boolean).join('\n');

  const evergreenCommand = [
    identityLock,
    `review ${normalizedUrl} and create 1 social media post tied to an upcoming holiday or seasonal event.`,
    `The post should connect the business to the holiday/event in a creative, engaging way.`,
    `Use the business brand colors and voice from the website.`,
    profileBlock,
    ctaRules,
    ``,
    `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
    holidayContext,
    `--- END RSS STORY METADATA ---`,
  ].filter(Boolean).join('\n');

  const newsCommand = [
    identityLock,
    `review ${normalizedUrl} and create 1 social media post that connects the business to local news.`,
    `The post should tie the business to local community news in a way that feels natural and relevant.`,
    `Use the business brand colors and voice from the website.`,
    profileBlock,
    ctaRules,
    ``,
    `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
    newsContext,
    `--- END RSS STORY METADATA ---`,
  ].filter(Boolean).join('\n');

  return [
    { lane_type: 'website_post', command: websiteCommand },
    { lane_type: 'evergreen_post', command: evergreenCommand },
    { lane_type: 'scout_news_retrieval', command: '', context: newsContext },
    { lane_type: 'news_post', command: newsCommand },
  ];
}

/**
 * Submit a command to Tombstone OS. Returns created task IDs and workflow info.
 *
 * `businessId` (the Tombstone integer business_id from /businesses/provisional)
 * is REQUIRED by the backend isolation gate for customer-facing content — it is
 * sent in the payload so every generated task is scoped to the correct business.
 *
 * @deprecated Use createAsyncRun() for new flows. This is kept for backward
 * compatibility with social mission creation and other single-command flows.
 */
async function sendCommand(command: string, excludeWorkflowIds?: string[], businessId?: number | string | null) {
  try {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000); // 120s timeout — Tombstone can be slow when cold
    const payload: Record<string, any> = { command };
    if (businessId !== undefined && businessId !== null && businessId !== '') {
      payload.business_id = typeof businessId === 'string' ? businessId : Number(businessId);
    }
    let res: Response;
    try {
      res = await fetch(`${TOMBSTONE_URL}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const apiLatency = Date.now() - t0;
    console.log(`[tombstone-latency] POST /commands responded in ${apiLatency}ms (status=${res.status})`);
    if (apiLatency > 10000) {
      console.warn(`[tombstone-latency] SLOW: Tombstone /commands took ${apiLatency}ms — possible cold start or worker spin-up`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const backendError = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
      console.error('Tombstone /commands error:', res.status, data, `latency=${apiLatency}ms`);
      return { success: false, data: null, workflowId: null, taskIds: [], backendStatus: res.status, backendError: String(backendError) };
    }
    const taskIds: number[] = data?.created_task_ids ?? [];
    let workflowId: string | null = null;

    // Strategy 1: Get workflow ID from created task
    if (taskIds.length > 0) {
      try {
        const taskRes = await fetch(`${TOMBSTONE_URL}/tasks/${taskIds[0]}`, { cache: 'no-store' });
        const taskData = await taskRes.json().catch(() => ({}));
        workflowId = taskData?.workflow_id ?? null;
      } catch { /* ignore */ }
    }

    // Strategy 2: Extract workflow ID from response_text (when created_task_ids is empty
    // due to Tombstone internal ID resolution issues but mission was actually created)
    if (!workflowId && data?.response_text) {
      const wfMatch = data.response_text.match(/Workflow ID:\s*([0-9a-f-]{36})/i);
      if (wfMatch) {
        workflowId = wfMatch[1];
        console.log(`[tombstone] Extracted workflowId from response_text: ${workflowId}`);
      }
      // Also try to extract task IDs from response_text
      const taskIdMatch = data.response_text.match(/Task IDs:\s*\[([^\]]+)\]/i);
      if (taskIdMatch && taskIds.length === 0) {
        const ids = taskIdMatch[1].split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        if (ids.length > 0) {
          taskIds.push(...ids);
          console.log(`[tombstone] Extracted taskIds from response_text: ${ids.join(',')}`);
        }
      }
    }

    // Strategy 3: If still no workflowId, the mission was likely created but IDs weren't
    // returned properly. Wait briefly for tasks to propagate, then query /tasks.
    if (!workflowId && data?.ok) {
      try {
        const excludeSet = new Set(excludeWorkflowIds ?? []);
        console.log(`[tombstone] No workflowId from response — waiting 3s then searching /tasks... (excluding ${excludeSet.size} known workflows)`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        const tasksRes = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store' });
        const allTasks = await tasksRes.json().catch(() => []);
        if (Array.isArray(allTasks) && allTasks.length > 0) {
          // Sort by id descending (most recent first)
          allTasks.sort((a: any, b: any) => (b.id ?? 0) - (a.id ?? 0));
          // Find newest task whose workflow_id is NOT in the exclude set
          const candidate = allTasks.find((t: any) => t.workflow_id && !excludeSet.has(t.workflow_id));
          if (candidate?.workflow_id) {
            workflowId = candidate.workflow_id;
            // Collect all task IDs for this workflow
            const wfTasks = allTasks.filter((t: any) => t.workflow_id === workflowId);
            const wfTaskIds = wfTasks.map((t: any) => t.id).filter((id: any) => typeof id === 'number');
            if (wfTaskIds.length > 0 && taskIds.length === 0) {
              taskIds.push(...wfTaskIds);
            }
            console.log(`[tombstone] Found recent workflow ${workflowId} with ${wfTaskIds.length} tasks`);
          } else {
            console.warn('[tombstone] No new workflow found (all matched exclude list)');
          }
        }
      } catch (e: any) {
        console.warn('[tombstone] Failed to search /tasks fallback:', e.message);
      }
    }

    return { success: true, data, workflowId, taskIds, backendStatus: res.status, backendError: null };
  } catch (err: any) {
    console.error('Tombstone command error:', err?.message, err?.cause || '');
    return { success: false, data: null, workflowId: null, taskIds: [], backendStatus: null, backendError: String(err?.message || err) };
  }
}

/**
 * Create a single mission that generates 3 ads (awareness, conversion, trust).
 * Sends 1 command → 1 workflow → 5 tasks.
 */
export async function createMissions(websiteUrl: string) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  const command = `review ${normalizedUrl} and make 3 minimal facebook ads for the business (awareness angle, conversion angle, trust angle) - use colors and logo from website`;
  console.log(`[tombstone] Creating single 3-ad mission for: ${normalizedUrl}`);

  const result = await sendCommand(command);

  return {
    success: !!result.workflowId,
    workflowIds: result.workflowId ? [result.workflowId] : [],
    allTaskIds: result.taskIds,
    angles: ['awareness', 'conversion', 'trust'],
  };
}

/**
 * Create a single-lane mission for one content type.
 * lane: 'website' | 'news' | 'holiday'
 * context: additional context (news headline, holiday info, etc.)
 * count: number of posts to generate (default 1)
 */
export async function createLaneMission(
  websiteUrl: string,
  lane: 'website' | 'news' | 'holiday',
  context: string,
  count: number = 1,
  excludeWorkflowIds?: string[],
  businessId?: string,
  businessName?: string,
  tombstoneBusinessId?: number | string | null,
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  // Load saved business profile to avoid full re-analysis
  const profileBlock = await getBusinessProfileBlock(businessId);

  // Build identity lock to prevent cross-business contamination
  const identityLock = buildIdentityLockBlock(
    businessName || '',
    normalizedUrl,
    normalizedUrl,
  );

  let command = '';
  if (lane === 'website') {
    command = [
      identityLock,
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} promoting the business.`,
      `Focus on the business brand, services, offers, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website. Make it feel authentic — like the business owner wrote it.`,
      profileBlock,
      context ? `\nAdditional context:\n${context}` : '',
    ].filter(Boolean).join('\n');
  } else if (lane === 'news') {
    command = [
      identityLock,
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} that connects the business to local news.`,
      `The post should tie the business to local community news in a way that feels natural and relevant.`,
      `Use the business brand colors and voice from the website.`,
      profileBlock,
      `CTA RULES:`,
      `- The CTA button MUST relate to the business's actual service/product found on the website.`,
      `- Good examples: "Get a Free Quote", "Book Now", "Schedule Service", "Shop Now", "Learn More", "Call Today"`,
      `- NEVER use generic CTAs like "Check Availability" unless the business is actually a booking/reservation service (hotels, rentals, venues).`,
      `- Read the website to understand what action a customer would take, then make the CTA match that action.`,
      ``,
      `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
      `${context}`,
      `--- END RSS STORY METADATA ---`,
    ].filter(Boolean).join('\n');
  } else if (lane === 'holiday') {
    command = [
      identityLock,
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} tied to an upcoming holiday or seasonal event.`,
      `The post should connect the business to the holiday/event in a creative, engaging way.`,
      `Use the business brand colors and voice from the website.`,
      profileBlock,
      `CTA RULES:`,
      `- The CTA button MUST relate to the business's actual service/product found on the website.`,
      `- Good examples: "Get a Free Quote", "Book Now", "Schedule Service", "Shop Now", "Learn More", "Call Today"`,
      `- NEVER use generic CTAs like "Check Availability" unless the business is actually a booking/reservation service (hotels, rentals, venues).`,
      `- Read the website to understand what action a customer would take, then make the CTA match that action.`,
      ``,
      `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
      `${context}`,
      `--- END RSS STORY METADATA ---`,
    ].filter(Boolean).join('\n');
  }

  console.log(`[tombstone] Creating ${lane} lane mission (${count} posts) for: ${normalizedUrl} (business_id=${tombstoneBusinessId ?? 'none'})`);
  const result = await sendCommand(command, excludeWorkflowIds, tombstoneBusinessId);

  return {
    success: !!result.workflowId,
    workflowId: result.workflowId,
    taskIds: result.taskIds,
    lane,
    backendStatus: (result as any).backendStatus ?? null,
    backendError: (result as any).backendError ?? null,
  };
}

/**
 * Create social content missions — one Tombstone workflow per post.
 *
 * Tombstone's pipeline (Bridger → Zig → Ogilvy → Draper → Warhol) creates
 * exactly ONE rendered post per workflow. So to get N posts we send N
 * individual commands, each with a specific content angle / headline.
 *
 * `stories` is an array of content items to turn into posts. Each has:
 *   - headline: the news/interest headline to riff on
 *   - source: feed source name
 *   - category: interest category label (e.g. "Rural & Agriculture")
 *   - type: 'interest' | 'local_news' | 'event' | 'business'
 *
 * Commands are sent in parallel (up to 3 concurrent) to avoid overloading
 * Tombstone while keeping total wall-clock time reasonable.
 */
export async function createSocialMissions(
  websiteUrl: string,
  scoutSummary: string,
  options: {
    postCount?: number;
    platforms?: string[];
    contentSourceMode?: string;
    stories?: { headline: string; source?: string; category?: string; type?: string; link?: string }[];
    businessId?: string;
    businessName?: string;
    businessDomain?: string;
    tombstoneBusinessId?: number;
  } = {},
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const platforms = options.platforms || ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
  const mode = options.contentSourceMode || 'local_plus_interests';
  const MAX_POSTS = 3;
  const stories = (options.stories || []).slice(0, MAX_POSTS);

  // Load saved business profile to avoid full re-analysis
  const profileBlock = options.businessId ? await getBusinessProfileBlock(options.businessId) : '';

  // Build advertiser identity lock block — ensures downstream agents never
  // confuse the RSS article's source with the actual advertiser
  const identityLockBlock = buildIdentityLockBlock(
    options.businessName || '',
    options.businessDomain || normalizedUrl,
    normalizedUrl,
  );

  // Preflight: validate the identity lock matches the selected business
  const preflight = validateIdentityPreflight({
    selectedBusinessName: options.businessName,
    selectedBusinessDomain: options.businessDomain,
    identityLockName: options.businessName,
    identityLockDomain: options.businessDomain,
  });
  if (!preflight.valid) {
    console.error(`[tombstone] IDENTITY_PREFLIGHT_FAILED: ${preflight.error}`);
    throw new Error(preflight.error);
  }

  // If no individual stories provided, fall back to single command with full brief
  if (stories.length === 0) {
    console.log(`[tombstone] No individual stories — sending single command for: ${normalizedUrl}`);
    const command = [
      identityLockBlock,
      `review ${normalizedUrl} and create 1 social media post promoting the business.`,
      `Focus on the business brand, services, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website.`,
      `Make it feel authentic — like a real small business owner wrote it.`,
      `Target platforms: ${platforms.join(', ')}.`,
      profileBlock,
      scoutSummary ? `\nContext from scout brief:\n${scoutSummary}` : '',
    ].filter(Boolean).join('\n');

    const result = await sendCommand(command, undefined, options.tombstoneBusinessId);
    return {
      success: !!result.workflowId,
      workflowIds: result.workflowId ? [result.workflowId] : [],
      allTaskIds: result.taskIds,
      postCount: 1,
      platforms,
    };
  }

  // Send one command per story, collecting workflow IDs
  console.log(`[tombstone] Creating ${stories.length} individual social post missions for: ${normalizedUrl}`);

  const allWorkflowIds: string[] = [];
  const allTaskIds: number[] = [];
  let successCount = 0;

  // Process sequentially — Tombstone serialises commands so parallel sends cause timeouts
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const command = buildStoryCommand(normalizedUrl, story, platforms, mode, profileBlock, identityLockBlock);
    console.log(`[tombstone] Sending command ${i + 1}/${stories.length}: "${story.headline?.slice(0, 60)}..." (${story.type || 'interest'})`);

    const result = await sendCommand(command, undefined, options.tombstoneBusinessId);
    if (result.workflowId) {
      allWorkflowIds.push(result.workflowId);
      allTaskIds.push(...result.taskIds);
      successCount++;
    } else {
      console.warn(`[tombstone] Command ${i + 1} failed — no workflowId returned`);
    }

    // Brief pause between commands to let Tombstone breathe
    if (i < stories.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  console.log(`[tombstone] Created ${successCount}/${stories.length} workflows: ${allWorkflowIds.join(', ')}`);

  return {
    success: successCount > 0,
    workflowIds: allWorkflowIds,
    allTaskIds,
    postCount: successCount,
    platforms,
  };
}

/**
 * Build an ADVERTISER IDENTITY LOCK block that anchors the business identity
 * throughout the entire Tombstone pipeline. This prevents downstream agents
 * from accidentally adopting the identity of a scraped RSS article source
 * (e.g. a Fetch Wireless article scrape overriding a Blazing Hog campaign).
 *
 * When present, Jim Bridger and all downstream agents MUST use this identity
 * for mission titles, brand bridges, CTAs, and creative output — regardless
 * of what any scraped website returns.
 */
/**
 * Preflight validation: ensures selected business identity matches the identity lock.
 * Throws a descriptive error if mismatched.
 */
export function validateIdentityPreflight(opts: {
  selectedBusinessName?: string;
  selectedBusinessDomain?: string;
  identityLockName?: string;
  identityLockDomain?: string;
  commandText?: string;
}): { valid: boolean; error?: string } {
  const selName = (opts.selectedBusinessName || '').toLowerCase().trim();
  const selDomain = (opts.selectedBusinessDomain || '').toLowerCase().replace(/^www\./, '').trim();
  const lockName = (opts.identityLockName || '').toLowerCase().trim();
  const lockDomain = (opts.identityLockDomain || '').toLowerCase().replace(/^www\./, '').trim();

  if (!selName && !selDomain) {
    return { valid: false, error: 'No business selected. Please select a business before generating.' };
  }

  // Check identity lock name matches
  if (lockName && selName && lockName !== selName && !lockName.includes(selName) && !selName.includes(lockName)) {
    return {
      valid: false,
      error: `Business identity mismatch: selected business is "${opts.selectedBusinessName}", but command was built for "${opts.identityLockName}".`,
    };
  }

  // Check identity lock domain matches
  if (lockDomain && selDomain && lockDomain !== selDomain && !lockDomain.includes(selDomain) && !selDomain.includes(lockDomain)) {
    return {
      valid: false,
      error: `Business identity mismatch: selected domain is "${opts.selectedBusinessDomain}", but command targets "${opts.identityLockDomain}".`,
    };
  }

  // Check command text for foreign advertiser names (if command is provided)
  if (opts.commandText && selName) {
    // Extract advertiser name from lock block in command
    const lockMatch = opts.commandText.match(/Advertiser Business Name:\s*(.+)/i);
    if (lockMatch) {
      const cmdAdvName = lockMatch[1].trim().toLowerCase();
      if (cmdAdvName !== selName && !cmdAdvName.includes(selName) && !selName.includes(cmdAdvName)) {
        return {
          valid: false,
          error: `Business identity mismatch: selected business is "${opts.selectedBusinessName}", but identity lock advertiser is "${lockMatch[1].trim()}".`,
        };
      }
    }
  }

  return { valid: true };
}

function buildIdentityLockBlock(
  businessName: string,
  businessDomain: string,
  websiteUrl: string,
): string {
  // Extract a clean domain for matching (strip protocol + www)
  const cleanDomain = businessDomain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  if (!businessName && !cleanDomain) return '';

  return [
    ``,
    `--- ADVERTISER IDENTITY LOCK (authoritative — overrides any scraped identity) ---`,
    businessName ? `Advertiser Business Name: ${businessName}` : '',
    `Advertiser Domain: ${cleanDomain}`,
    `Advertiser Website URL: ${websiteUrl}`,
    ``,
    `RULES:`,
    `1. ALL mission titles, brand bridges, CTAs, and creative output MUST reference this advertiser.`,
    `2. If you scrape a URL that belongs to a DIFFERENT business, use that content as TOPIC CONTEXT only — the brand identity is ALWAYS the advertiser above.`,
    `3. Do NOT adopt the name, logo, colors, or voice of any scraped third-party site. The creative must represent the advertiser.`,
    `4. If the RSS story source or scraped article is from a competitor or unrelated brand, explicitly position the advertiser in relation to that topic.`,
    `--- END ADVERTISER IDENTITY LOCK ---`,
    ``,
  ].filter(Boolean).join('\n');
}

/**
 * Build a Tombstone command for a single story/content item.
 *
 * IMPORTANT: The command text includes clearly labeled RSS story metadata
 * so that Jim Bridger's _extract_rss_story_context() can parse it and
 * preserve the original RSS title/source/category in story_context,
 * separate from the business website recon (business_context).
 */
function buildStoryCommand(
  websiteUrl: string,
  story: { headline: string; source?: string; category?: string; type?: string; link?: string },
  platforms: string[],
  mode: string,
  profileBlock: string = '',
  identityLockBlock: string = '',
): string {
  const type = story.type || 'interest';
  const platformStr = platforms.join(', ');

  // Build a consistent RSS metadata block for all story types
  // so downstream extraction always finds the same format
  const rssMetaBlock = [
    ``,
    `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
    `Trending headline: "${story.headline}"`,
    story.source ? `Source: ${story.source}` : '',
    story.category ? `Category: ${story.category}` : '',
    story.link ? `RSS URL: ${story.link}` : '',
    `--- END RSS STORY METADATA ---`,
  ].filter(Boolean).join('\n');

  // Portrait/mobile-first instruction for all RSS/social posts
  const portraitInstruction = `Image creative MUST be portrait 4:5 aspect ratio (1080×1350), mobile-first, full-frame composition. Do NOT generate landscape images.`;

  if (type === 'event') {
    return [
      identityLockBlock,
      `review ${websiteUrl} and create 1 social media post tied to an upcoming event/holiday.`,
      `The post should connect the business to this event in a creative, engaging way.`,
      `Use the business brand colors and voice from the website.`,
      `Target platforms: ${platformStr}.`,
      portraitInstruction,
      profileBlock,
      rssMetaBlock,
    ].filter(Boolean).join('\n');
  }

  if (type === 'local_news') {
    return [
      identityLockBlock,
      `review ${websiteUrl} and create 1 social media post that connects the business to local news.`,
      `The post should tie the business to this local community news in a way that feels natural and relevant.`,
      `Use the business brand colors and voice from the website.`,
      `Target platforms: ${platformStr}.`,
      portraitInstruction,
      profileBlock,
      rssMetaBlock,
    ].filter(Boolean).join('\n');
  }

  if (type === 'business') {
    return [
      identityLockBlock,
      `review ${websiteUrl} and create 1 social media post promoting the business.`,
      `Focus on the business brand, services, offers, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website. Make it feel authentic.`,
      `Target platforms: ${platformStr}.`,
      portraitInstruction,
      profileBlock,
    ].filter(Boolean).join('\n');
  }

  // Default: interest/trending headline
  return [
    identityLockBlock,
    `review ${websiteUrl} and create 1 social media post that connects the business to a trending topic.`,
    `The post should show the business's expertise and relevance to this topic — thought leadership style.`,
    `Use the business brand colors and voice from the website.`,
    `Target platforms: ${platformStr}.`,
    portraitInstruction,
    profileBlock,
    rssMetaBlock,
  ].filter(Boolean).join('\n');
}

/**
 * Create a single-story Tombstone workflow triggered from scout email.
 * Produces exactly 1 post for 1 story — no multi-post generation.
 */
export async function createScoutStoryMission(
  websiteUrl: string,
  story: {
    title: string;
    source: string;
    sourceUrl: string;
    summary: string;
    relevance: string;
    suggestedAngle: string;
    sourceType: string;
  },
  meta: {
    businessId: string;
    userId: string;
    scoutReportId: string;
    storyId: string;
    postPackageId: string;
    businessName?: string;
    tombstoneBusinessId?: number | null;
  },
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const type = story.sourceType === 'national' ? 'event' : story.sourceType === 'industry' ? 'interest' : 'local_news';

  // Load saved business profile to avoid full re-analysis
  const profileBlock = await getBusinessProfileBlock(meta.businessId);

  // Build identity lock from meta if available, otherwise from URL
  const identityLock = buildIdentityLockBlock(
    meta.businessName || '',
    normalizedUrl,
    normalizedUrl,
  );

  const command = [
    identityLock,
    `review ${normalizedUrl} and create 1 social media post based on the story below.`,
    `This is a single-story post creation from the Daily Scout Email.`,
    `Create EXACTLY 1 post — do not generate variants or multiple outputs.`,
    `Use the business brand colors and voice from the website.`,
    `Target platforms: facebook, instagram.`,
    `Image creative MUST be portrait 4:5 aspect ratio (1080×1350), mobile-first, full-frame composition. Do NOT generate landscape images.`,
    profileBlock,
    `--- SCOUT STORY CONTEXT ---`,
    `source: daily_scout_email`,
    `workflow_type: single_story_post`,
    `max_posts: 1`,
    `manual_publishing_only: true`,
    `business_id: ${meta.businessId}`,
    `post_package_id: ${meta.postPackageId}`,
    `--- END SCOUT CONTEXT ---`,
    ``,
    `--- RSS STORY METADATA (preserve exactly — do not alter) ---`,
    `Trending headline: "${story.title}"`,
    story.source ? `Source: ${story.source}` : '',
    story.sourceUrl ? `RSS URL: ${story.sourceUrl}` : '',
    story.summary ? `Summary: ${story.summary}` : '',
    story.relevance ? `Relevance: ${story.relevance}` : '',
    story.suggestedAngle ? `Suggested angle: ${story.suggestedAngle}` : '',
    `--- END RSS STORY METADATA ---`,
  ].filter(Boolean).join('\n');

  console.log(`[tombstone] Scout story mission for: ${normalizedUrl} — "${story.title.slice(0, 60)}" (business_id=${meta.tombstoneBusinessId ?? 'none'})`);
  const result = await sendCommand(command, undefined, meta.tombstoneBusinessId);

  return {
    success: !!result.workflowId,
    workflowId: result.workflowId,
    taskIds: result.taskIds,
  };
}

/**
 * Create a Tombstone mission for a Weekly Tip post.
 * Generates an evergreen, educational/value-driven social post based on
 * the business's content profile rather than external news or RSS stories.
 */
export async function createWeeklyTipMission(
  websiteUrl: string,
  opts: {
    topic: string;
    category: string;
    audience: string;
    tone: string;
    cta?: string;
    generateArt: boolean;
    businessName?: string;
    location?: string;
    contentPillars: string[];
    allowedAdjacentTopics: string[];
    restrictedTopics: string[];
    brandVoiceSummary: string;
    industry: string;
    businessId?: string;
    tombstoneBusinessId?: number | null;
  },
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  // Load saved business profile to avoid full re-analysis
  const profileBlock = opts.businessId ? await getBusinessProfileBlock(opts.businessId) : '';
  const identityLock = buildIdentityLockBlock(opts.businessName || '', normalizedUrl, normalizedUrl);

  const command = [
    identityLock,
    `review ${normalizedUrl} and create 1 social media post based on the weekly tip topic below.`,
    `This is an EVERGREEN CONTENT task — do NOT use RSS, news, or external stories.`,
    `Write a helpful, value-driven post that positions the business as a knowledgeable authority.`,
    `The post should educate or inform the audience, include a clear takeaway, and feel natural (not salesy).`,
    opts.generateArt
      ? `Also create a social media image/artwork that complements this post using the business brand from the website.`
      : `Do NOT generate any image or artwork for this post.`,
    `Target platforms: facebook, instagram.`,
    profileBlock,
    ``,
    `--- WEEKLY TIP CONTEXT ---`,
    `source: weekly_tip`,
    `workflow_type: evergreen_weekly_tip`,
    `requires_external_story: false`,
    `max_posts: 1`,
    `manual_publishing_only: true`,
    `--- END WEEKLY TIP CONTEXT ---`,
    ``,
    `--- TOPIC ---`,
    `Topic: ${opts.topic}`,
    `Category: ${opts.category}`,
    `Target audience: ${opts.audience}`,
    `Tone: ${opts.tone}`,
    opts.cta ? `Call-to-action: ${opts.cta}` : '',
    `--- END TOPIC ---`,
    ``,
    `--- BUSINESS PROFILE ---`,
    opts.businessName ? `Business name: ${opts.businessName}` : '',
    opts.industry ? `Industry: ${opts.industry}` : '',
    opts.location ? `Location: ${opts.location}` : '',
    opts.contentPillars.length > 0 ? `Content pillars: ${opts.contentPillars.join(', ')}` : '',
    opts.allowedAdjacentTopics.length > 0 ? `Allowed adjacent topics: ${opts.allowedAdjacentTopics.join(', ')}` : '',
    opts.restrictedTopics.length > 0 ? `Restricted / off-limits topics: ${opts.restrictedTopics.join(', ')}` : '',
    opts.brandVoiceSummary ? `Brand voice: ${opts.brandVoiceSummary}` : '',
    `--- END BUSINESS PROFILE ---`,
    ``,
    `IMPORTANT: This is intent=weekly_tip, source=weekly_tip. Do NOT run RSS scouting or story discovery.`,
  ].filter(Boolean).join('\n');

  console.log(`[tombstone] Weekly tip mission for: ${normalizedUrl} — "${opts.topic.slice(0, 60)}" (business_id=${opts.tombstoneBusinessId ?? 'none'})`);
  const result = await sendCommand(command, undefined, opts.tombstoneBusinessId);

  return {
    success: !!result.workflowId,
    workflowIds: result.workflowId ? [result.workflowId] : [],
    allTaskIds: result.taskIds,
  };
}

// Legacy single-mission creator (kept for backward compat)
/**
 * Create a Tombstone mission to copy-edit a user-written draft post.
 * Sends the user's draft text + optional preferences as a Tombstone command.
 * Returns workflow/task info for polling.
 */
export async function createDraftPolishMission(
  websiteUrl: string,
  draft: string,
  options: {
    platform?: string;
    tone?: string;
    cta?: string;
    offer?: string;
    artDirection?: string;
    generateArt?: boolean;
    tombstoneBusinessId?: number | null;
  } = {},
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const generateArt = options.generateArt !== false;

  const commandParts = [
    `review ${normalizedUrl} and polish the following user-written social media post draft.`,
    `This is a COPY EDITING task — do NOT create new content from scratch.`,
    `Improve the grammar, flow, engagement, and professionalism while keeping the user's voice and intent.`,
    `Return ONE polished version of the post, a shorter version suitable for Twitter/X, and relevant hashtags.`,
    generateArt
      ? `Also create a social media image/artwork that complements this post using the business brand from the website.`
      : `Do NOT generate any image or artwork for this post.`,
    ``,
    `--- USER DRAFT (preserve the core message) ---`,
    draft,
    `--- END USER DRAFT ---`,
  ];

  if (options.platform) commandParts.push(`\nTarget platform: ${options.platform}`);
  if (options.tone) commandParts.push(`Desired tone: ${options.tone}`);
  if (options.cta) commandParts.push(`Call-to-action to include: ${options.cta}`);
  if (options.offer) commandParts.push(`Offer/promotion to highlight: ${options.offer}`);
  if (options.artDirection) commandParts.push(`Image/art direction notes: ${options.artDirection}`);

  // === SECONDARY TEXT LINES ===
  // Extract key data points (dates, stats, schedules) from the user's draft.
  // These will be rendered INTO the image as secondary text below the headline,
  // ensuring important facts are visible in the visual, not just the caption.
  commandParts.push(`\n=== IMAGE TEXT RULES ===`);
  commandParts.push(`When creating the ad image, include key data points from the draft as SECONDARY TEXT in the image.`);
  commandParts.push(`Examples of data points to include: dates, game schedules, event times, statistics, prices, deadlines.`);
  commandParts.push(`Pass these as "secondary_text_lines" (array of short strings) in the creative direction output.`);
  commandParts.push(`Each line should be concise (e.g. "Jun 12 vs Paraguay" not full sentences).`);
  commandParts.push(`These lines appear below the headline and above the CTA in the rendered image.`);
  commandParts.push(`Also ensure people/subjects in the image face TOWARD the main action/screen, not away from it.`);

  commandParts.push(`\nIMPORTANT: This is intent=copy_edit_user_post, source=user_written_post. Do NOT run RSS scouting or story discovery.`);

  const command = commandParts.join('\n');
  console.log(`[tombstone] Draft polish mission for: ${normalizedUrl} (art=${generateArt}, business_id=${options.tombstoneBusinessId ?? 'none'})`);

  const result = await sendCommand(command, undefined, options.tombstoneBusinessId);
  return {
    success: !!result.workflowId,
    workflowIds: result.workflowId ? [result.workflowId] : [],
    allTaskIds: result.taskIds,
  };
}

export async function createMission(websiteUrl: string) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const command = `review ${normalizedUrl} and make facebook ad for the business - minimal design use colors and logo from website`;
  const result = await sendCommand(command);
  return {
    success: result.success,
    data: result.data,
    missionId: result.workflowId ?? (result.taskIds.length > 0 ? `tasks:${result.taskIds.join(',')}` : null),
    taskIds: result.taskIds,
  };
}

// Human-readable task labels for the UI
const DEPT_LABELS: Record<string, { label: string; description: string }> = {
  'research': { label: 'Business Context', description: 'Matching the story to your business' },
  'marketing': { label: 'Marketing Strategy', description: 'Developing the post strategy' },
  'creative strategy': { label: 'Ad Copywriting', description: 'Writing the social post copy' },
  'creative direction': { label: 'Visual Direction', description: 'Creating visual direction for the final image' },
  'creative review': { label: 'Creative Review', description: 'Reviewing creative concept before generation' },
  'render production': { label: 'Image Generation', description: 'Generating final ad images' },
};

export function getTaskLabel(department: string): { label: string; description: string } {
  const key = (department ?? '').toLowerCase();
  return DEPT_LABELS[key] ?? { label: department ?? 'Processing', description: '' };
}

/**
 * Get the status of multiple workflows (for 3-ad generation).
 * Returns individual task statuses for live tracking.
 */
export async function getMultiWorkflowStatus(workflowIds: string[]) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000); // 25s timeout
    let res: Response;
    try {
      // Pass workflow_ids as comma-separated filter to avoid fetching all tasks
      const wfParam = workflowIds.join(',');
      res = await fetch(`${TOMBSTONE_URL}/tasks?workflow_id=${encodeURIComponent(wfParam)}`, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const allTasks = await res.json().catch(() => []);
    if (!Array.isArray(allTasks)) return { success: false, tasks: [], status: 'error' };

    // Filter tasks belonging to our workflows (belt-and-suspenders)
    const wfSet = new Set(workflowIds);
    const ourTasks = allTasks.filter((t: any) => wfSet.has(t?.workflow_id));

    if (ourTasks.length === 0) {
      return { success: false, tasks: [], status: 'unknown' };
    }

    // Build structured task list for UI
    const taskList = ourTasks.map((t: any) => {
      const dept = (t?.department ?? '').toLowerCase();
      const { label, description } = getTaskLabel(t?.department ?? '');
      const rawStatus = (t?.status ?? '').toLowerCase();
      let uiStatus: 'waiting' | 'active' | 'complete' | 'error' = 'waiting';
      if (rawStatus === 'complete' || rawStatus === 'completed') uiStatus = 'complete';
      else if (rawStatus === 'failed' || rawStatus === 'error') uiStatus = 'error';
      else if (rawStatus === 'in progress' || rawStatus === 'in_progress' || rawStatus === 'running' || rawStatus === 'claimed') uiStatus = 'active';
      else if (rawStatus === 'ready for pickup') uiStatus = 'waiting';
      else if (rawStatus === 'blocked') uiStatus = 'waiting';

      return {
        id: t?.id,
        workflowId: t?.workflow_id,
        department: t?.department ?? label,
        label,
        description,
        status: uiStatus,
        rawStatus: uiStatus,
        lastError: t?.last_error ? 'Step encountered an issue' : null,
        // Timing fields for progress instrumentation
        created_at: t?.created_at ?? null,
        claimed_at: t?.claimed_at ?? null,
        heartbeat_at: t?.heartbeat_at ?? null,
        updated_at: t?.updated_at ?? null,
        claimed_by: t?.claimed_by ?? null,
        worker_instance_id: t?.worker_instance_id ?? null,
        retry_count: t?.retry_count ?? 0,
        step_order: t?.step_order ?? null,
        last_error: t?.last_error ?? null,
      };
    }).sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));

    // Compute overall status
    const statuses = ourTasks.map((t: any) => (t?.status ?? '').toLowerCase());
    const allComplete = statuses.every((s: string) => s === 'complete' || s === 'completed');
    const anyFailed = statuses.some((s: string) => s === 'failed' || s === 'error');
    const anyActive = statuses.some((s: string) =>
      ['in progress', 'in_progress', 'running', 'claimed', 'ready for pickup'].includes(s)
    );
    const anyBlocked = statuses.some((s: string) => s === 'blocked');

    let overallStatus = 'processing';
    if (allComplete) overallStatus = 'completed';
    else if (anyFailed && !anyActive && !anyBlocked) overallStatus = 'error';
    else if (anyActive || anyBlocked) overallStatus = 'generating';

    // Per-workflow completion map: { workflowId: 'completed' | 'generating' | ... }
    const byWorkflow = new Map<string, any[]>();
    for (const t of ourTasks) {
      const wf = t?.workflow_id;
      if (!byWorkflow.has(wf)) byWorkflow.set(wf, []);
      byWorkflow.get(wf)!.push(t);
    }
    const completedWorkflows: string[] = [];
    for (const [wfId, wfTasks] of byWorkflow) {
      const wfStatuses = wfTasks.map((t: any) => (t?.status ?? '').toLowerCase());
      if (wfStatuses.every((s: string) => s === 'complete' || s === 'completed')) {
        completedWorkflows.push(wfId);
      }
    }

    return { success: true, tasks: taskList, status: overallStatus, completedWorkflows };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
    console.error('Multi-workflow status error:', err?.message, isTimeout ? '(timeout - transient)' : '');
    // Return 'pending' for transient errors so the frontend keeps polling
    // instead of showing a permanent failure message
    return { success: false, tasks: [], status: isTimeout ? 'pending' : 'error' };
  }
}

// Legacy single-workflow status
export async function getMissionStatus(missionId: string) {
  return getMultiWorkflowStatus([missionId]);
}

/**
 * Get full results for completed workflows.
 * Returns enriched ad data, research data for SEO, and marketing data for posting plan.
 */
export async function getWorkflowResults(workflowIds: string[]) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000); // 25s timeout
    let res: Response;
    try {
      // Pass workflow_ids as comma-separated filter to avoid fetching all tasks
      const wfParam = workflowIds.join(',');
      res = await fetch(`${TOMBSTONE_URL}/tasks?workflow_id=${encodeURIComponent(wfParam)}`, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const allTasks = await res.json().catch(() => []);
    if (!Array.isArray(allTasks)) return { success: false, ads: [], research: null, marketing: null, creative: null };

    const wfSet = new Set(workflowIds);
    const ourTasks = allTasks.filter((t: any) => wfSet.has(t?.workflow_id));

    const ads: any[] = [];
    let researchData: any = null;
    let marketingData: any = null;
    let creativeData: any = null;

    // Group tasks by workflow
    const byWorkflow = new Map<string, any[]>();
    for (const t of ourTasks) {
      const wf = t?.workflow_id;
      if (!byWorkflow.has(wf)) byWorkflow.set(wf, []);
      byWorkflow.get(wf)!.push(t);
    }

    // Also track Creative Strategy task per workflow for fallback copy
    const wfCreativeStrategy = new Map<string, number>(); // workflowId → taskId
    // Track Creative Direction task per workflow for fallback image generation prompt
    const wfCreativeDirection = new Map<string, number>(); // workflowId → taskId

    for (const [wfId, tasks] of byWorkflow) {
      // Pick ONE ad task per workflow: prefer Conversion Assembly (final step),
      // then Render Production, so we don't double-count ads per workflow.
      let bestAdTask: any = null;
      for (const task of tasks) {
        const dept = (task?.department ?? '').toLowerCase();
        const status = (task?.status ?? '').toLowerCase();
        if (status !== 'complete' && status !== 'completed') continue;

        if (dept.includes('conversion') || dept.includes('assembly')) {
          bestAdTask = task; // Highest priority — final pipeline step
        } else if ((dept.includes('render')) && !bestAdTask) {
          bestAdTask = task; // Fallback if no Conversion Assembly
        }
        // Track creative strategy per workflow (Ogilvy's copy data)
        if (dept.includes('creative strategy')) {
          wfCreativeStrategy.set(wfId, task.id);
        }
        // Track creative direction per workflow (Don Draper's render prompt)
        if (dept.includes('creative direction')) {
          wfCreativeDirection.set(wfId, task.id);
        }
        // First research task has business data for SEO
        if (dept.includes('research') && !researchData) {
          researchData = { taskId: task.id };
        }
        // Marketing task has strategy + SEO audit data
        if (dept.includes('marketing') && !marketingData) {
          marketingData = { taskId: task.id, output: null as any };
        }
        // Creative strategy has copy data (first across all workflows, for SEO/posting plan)
        if (dept.includes('creative strategy') && !creativeData) {
          creativeData = { taskId: task.id };
        }
      }
      if (bestAdTask) {
        ads.push({ taskId: bestAdTask.id, workflowId: wfId });
      } else if (wfCreativeStrategy.has(wfId)) {
        // Render Production failed but Creative Strategy completed — use copy-only fallback
        const taskDepts = tasks.map((t: any) => `${t.department}(${t.status})`).join(', ');
        console.warn(`[getWorkflowResults] Workflow ${wfId}: Render failed, falling back to Creative Strategy (task ${wfCreativeStrategy.get(wfId)}). Tasks: ${taskDepts}`);
        ads.push({ taskId: wfCreativeStrategy.get(wfId)!, workflowId: wfId, copyOnly: true });
      } else {
        // Log why this workflow produced no ad task
        const taskDepts = tasks.map((t: any) => `${t.department}(${t.status})`).join(', ');
        console.warn(`[getWorkflowResults] Workflow ${wfId} has ${tasks.length} tasks but no completed ad task. Tasks: ${taskDepts}`);
      }
    }

    // Enrich ads with artifact URLs and outputs
    // Andy Warhol outputs: { renders: [...], background_asset_path, ... }
    // Claude Hopkins (legacy): { assets: [...], final_ad_path, ... }
    const enrichedAds = [];
    for (const ad of ads) {
      // ── Copy-only fallback: Creative Strategy output (no rendered image) ──
      if ((ad as any).copyOnly) {
        const outputs = await getTaskOutputs(ad.taskId);
        let headline = '';
        let caption = '';
        let cta = '';
        for (const out of outputs) {
          try {
            const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
            if (parsed?.headline) {
              headline = parsed.headline;
              caption = parsed.body_copy ?? parsed.body ?? '';
              cta = parsed.cta ?? '';
              break;
            }
          } catch { /* ignore */ }
        }
        if (headline || caption) {
          // Attempt fallback image generation using Creative Direction prompt
          let fallbackResult: FallbackImageResult = { imageUrl: null, provider: null, model: null, error: null, degraded: true };
          const cdTaskId = wfCreativeDirection.get(ad.workflowId);
          if (cdTaskId) {
            try {
              const cdOutputs = await getTaskOutputs(cdTaskId);
              let renderPrompt = '';
              for (const out of cdOutputs) {
                try {
                  const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
                  if (parsed?.render_prompt) { renderPrompt = parsed.render_prompt; break; }
                } catch { /* ignore */ }
              }
              if (renderPrompt) {
                console.log(`[getWorkflowResults] ⚠️ FRONTEND_FALLBACK: Generating image for workflow ${ad.workflowId} because backend Render Production failed. This should not happen if Andy Warhol succeeds. prompt_len=${renderPrompt.length}`);
                fallbackResult = await generateFallbackImage(renderPrompt, { workflowId: String(ad.workflowId), taskId: String(cdTaskId), lane: ad.lane });
              } else {
                console.warn(`[getWorkflowResults] No render_prompt found in Creative Direction task ${cdTaskId} for workflow ${ad.workflowId}`);
                fallbackResult.error = 'No render_prompt in Creative Direction output';
              }
            } catch (e) {
              console.error(`[getWorkflowResults] Fallback image generation crashed for workflow ${ad.workflowId}:`, e);
              fallbackResult.error = `Exception: ${(e as Error)?.message ?? e}`;
            }
          } else {
            console.warn(`[getWorkflowResults] No Creative Direction task found for workflow ${ad.workflowId}`);
            fallbackResult.error = 'No Creative Direction task for this workflow';
          }

          // Only set copyOnly=false if we actually got an image
          const hasImage = !!fallbackResult.imageUrl;
          console.log(`[getWorkflowResults] Fallback result for workflow ${ad.workflowId}: hasImage=${hasImage} provider=${fallbackResult.provider} model=${fallbackResult.model} degraded=${fallbackResult.degraded}${fallbackResult.error ? ` error="${fallbackResult.error}"` : ''}`);

          enrichedAds.push({
            taskId: ad.taskId,
            workflowId: ad.workflowId,
            headline,
            caption,
            cta,
            imageUrl: fallbackResult.imageUrl,
            copyOnly: !hasImage, // false if image was generated, true if degraded
          });
        } else {
          console.warn(`[getWorkflowResults] Copy-only fallback for workflow ${ad.workflowId} produced no usable copy`);
        }
        continue;
      }

      const outputs = await getTaskOutputs(ad.taskId);
      let taskOutput: any = null;
      for (const out of outputs) {
        try {
          taskOutput = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
        } catch { /* ignore */ }
      }

      // Andy Warhol multi-campaign: renders array with per-campaign images
      // Each lane workflow should produce 1 ad — take the first render only
      const renders = taskOutput?.renders;
      if (Array.isArray(renders) && renders.length > 0) {
        for (const render of renders.slice(0, 1)) {
          const artifactPath = render?.background_asset_path ?? '';
          const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : await getTaskArtifact(ad.taskId);
          enrichedAds.push({
            taskId: ad.taskId,
            workflowId: ad.workflowId,
            headline: render?.headline ?? '',
            caption: render?.body ?? render?.body_copy ?? '',
            cta: render?.cta ?? '',
            imageUrl,
            campaignId: render?.campaign_id ?? '',
            campaignName: render?.campaign_name ?? '',
          });
        }
      }
      // Claude Hopkins legacy: assets array
      else if (Array.isArray(taskOutput?.assets) && taskOutput.assets.length > 0) {
        for (const asset of taskOutput.assets.slice(0, 1)) {
          const artifactPath = asset?.artifact_path ?? asset?.final_ad_path ?? '';
          const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : await getTaskArtifact(ad.taskId);
          enrichedAds.push({
            taskId: ad.taskId,
            workflowId: ad.workflowId,
            headline: asset?.headline ?? '',
            caption: asset?.body ?? asset?.body_copy ?? '',
            cta: asset?.cta ?? '',
            imageUrl,
            campaignId: asset?.campaign_id ?? '',
            campaignName: asset?.campaign_name ?? '',
          });
        }
      } else {
        // Single-asset fallback (e.g. Render Production only, no Conversion Assembly)
        // Support all possible image URL fields from Andy Warhol / render outputs
        const artifactPath = taskOutput?.background_asset_path
          ?? taskOutput?.background_asset_url
          ?? taskOutput?.asset_path
          ?? taskOutput?.image_url
          ?? taskOutput?.imageUrl
          ?? taskOutput?.public_url
          ?? taskOutput?.publicUrl
          ?? taskOutput?.signed_url
          ?? taskOutput?.signedUrl
          ?? taskOutput?.r2_url
          ?? taskOutput?.r2Url
          ?? taskOutput?.path
          ?? '';
        const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : await getTaskArtifact(ad.taskId);
        let headline = taskOutput?.headline ?? '';
        let caption = taskOutput?.body_copy ?? taskOutput?.body ?? taskOutput?.caption ?? '';
        let cta = taskOutput?.cta ?? '';

        // If Render Production output has no copy (background-only image),
        // pull headline/body/cta from Creative Strategy (Ogilvy) for this workflow
        if (!headline && !caption) {
          const ogilvyTaskId = wfCreativeStrategy.get(ad.workflowId);
          if (ogilvyTaskId) {
            const ogilvyOutputs = await getTaskOutputs(ogilvyTaskId);
            for (const out of ogilvyOutputs) {
              try {
                const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
                if (parsed?.headline) {
                  headline = parsed.headline;
                  caption = parsed.body_copy ?? parsed.body ?? '';
                  cta = parsed.cta ?? '';
                  console.log(`[getWorkflowResults] Pulled copy from Ogilvy (task ${ogilvyTaskId}) for workflow ${ad.workflowId}`);
                  break;
                }
              } catch { /* ignore */ }
            }
          }
        }
        enrichedAds.push({ ...ad, headline, caption, cta, imageUrl });
      }
    }

    // Get research outputs for SEO
    let researchOutput: any = null;
    if (researchData?.taskId) {
      const outputs = await getTaskOutputs(researchData.taskId);
      for (const out of outputs) {
        try {
          const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          if (parsed?.business_summary || parsed?.task_type === 'website_recon') {
            researchOutput = parsed;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Get creative strategy outputs
    let creativeOutput: any = null;
    if (creativeData?.taskId) {
      const outputs = await getTaskOutputs(creativeData.taskId);
      for (const out of outputs) {
        try {
          const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          if (parsed?.headline || parsed?.task_type === 'creative_strategy') {
            creativeOutput = parsed;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Get marketing/SEO audit outputs from Zig Ziglar
    let marketingOutput: any = null;
    if (marketingData?.taskId) {
      const outputs = await getTaskOutputs(marketingData.taskId);
      for (const out of outputs) {
        try {
          const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          if (parsed?.audit || parsed?.task_type === 'marketing_strategy') {
            marketingOutput = parsed;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    return {
      success: true,
      ads: enrichedAds,
      research: researchOutput,
      marketing: marketingOutput,
      creative: creativeOutput,
    };
  } catch (err: any) {
    console.error('Workflow results error:', err?.message);
    return { success: false, ads: [], research: null, marketing: null, creative: null };
  }
}

export async function getTaskArtifact(taskId: number): Promise<string | null> {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/artifact`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? null;
  } catch { return null; }
}

/**
 * Resolve an artifact path (R2 key or URL) into an accessible URL.
 * If already a URL, return as-is. Otherwise, use the /artifacts/resolve endpoint.
 */
async function resolveArtifactUrl(artifactPath: string): Promise<string | null> {
  if (!artifactPath) return null;
  if (artifactPath.startsWith('http://') || artifactPath.startsWith('https://')) return artifactPath;

  // Strip r2://bucket_name/ prefix — Jim Bridger stores paths as
  // r2://tombstoner2customerassets/recon/... but the actual R2 key is just recon/...
  let cleanPath = artifactPath;
  if (cleanPath.startsWith('r2://')) {
    // Remove r2://bucket_name/ prefix, keeping only the key
    const withoutScheme = cleanPath.slice(5); // remove 'r2://'
    const slashIdx = withoutScheme.indexOf('/');
    cleanPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
  }

  // Retry up to 2 times (artifact resolution is critical for image display)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(cleanPath)}`, { cache: 'no-store' });
      if (!res.ok) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); continue; }
        return null;
      }
      const data = await res.json().catch(() => ({}));
      return data?.artifact_url ?? null;
    } catch {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); continue; }
      return null;
    }
  }
  return null;
}

export async function getTaskOutputs(taskId: number): Promise<any[]> {
  // Retry up to 2 times on failure (task outputs are critical for ad extraction)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/outputs`, { cache: 'no-store' });
      if (!res.ok) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
        return [];
      }
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    } catch {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      return [];
    }
  }
  return [];
}

/**
 * Get social content results from a completed social workflow.
 * Parses Tombstone task outputs to extract social posts with captions,
 * hashtags, images, and metadata for SocialPost storage.
 */
export async function getSocialWorkflowResults(workflowIds: string[]) {
  try {
    const wfParam = workflowIds.join(',');
    const res = await fetch(`${TOMBSTONE_URL}/tasks?workflow_id=${encodeURIComponent(wfParam)}`, { cache: 'no-store' });
    const allTasks = await res.json().catch(() => []);
    if (!Array.isArray(allTasks)) return { success: false, posts: [], status: 'error' };

    const wfSet = new Set(workflowIds);
    const ourTasks = allTasks.filter((t: any) => wfSet.has(t?.workflow_id));

    if (ourTasks.length === 0) return { success: false, posts: [], status: 'unknown' };

    // Check overall status
    const statuses = ourTasks.map((t: any) => (t?.status ?? '').toLowerCase());
    const allComplete = statuses.every((s: string) => s === 'complete' || s === 'completed');
    const anyFailed = statuses.some((s: string) => s === 'failed' || s === 'error');
    const anyActive = statuses.some((s: string) =>
      ['in progress', 'in_progress', 'running', 'claimed', 'ready for pickup'].includes(s)
    );

    let overallStatus = 'processing';
    if (allComplete) overallStatus = 'completed';
    else if (anyFailed && !anyActive) overallStatus = 'error';
    else if (anyActive) overallStatus = 'generating';

    if (overallStatus !== 'completed') {
      // Check if error was caused by War Room (Creative Review) rejection
      let warRoomRejection: { rejected: boolean; reason?: string; score?: number } = { rejected: false };
      if (overallStatus === 'error') {
        const crTask = ourTasks.find((t: any) => {
          const d = (t?.department ?? '').toLowerCase();
          return d.includes('creative review') && (t?.status ?? '').toLowerCase() === 'failed';
        });
        if (crTask) {
          const errMsg = crTask.last_error ?? '';
          if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('war room')) {
            warRoomRejection = {
              rejected: true,
              reason: errMsg.replace(/^WORKFLOW CANCELLED.*?:\s*/i, '').slice(0, 2000),
            };
            // Try to extract score from error message
            const scoreMatch = errMsg.match(/score=(\d+)/);
            if (scoreMatch) warRoomRejection.score = parseInt(scoreMatch[1], 10);
          }
        }
      }
      return { success: true, posts: [], status: overallStatus, warRoomRejection };
    }

    // Extract business_context from Jim Bridger (research) task for profile caching
    let businessContext: Record<string, any> | null = null;
    for (const task of ourTasks) {
      const dept = (task?.department ?? '').toLowerCase();
      const taskStatus = (task?.status ?? '').toLowerCase();
      if (taskStatus !== 'complete' && taskStatus !== 'completed') continue;
      if (dept.includes('research')) {
        try {
          const outputs = await getTaskOutputs(task.id);
          for (const out of outputs) {
            const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
            if (parsed?.business_context) {
              businessContext = parsed.business_context;
              break;
            }
          }
        } catch { /* non-critical */ }
        if (businessContext) break;
      }
    }

    // Extract social posts from completed tasks
    const posts: any[] = [];

    for (const task of ourTasks) {
      const dept = (task?.department ?? '').toLowerCase();
      const taskStatus = (task?.status ?? '').toLowerCase();
      if (taskStatus !== 'complete' && taskStatus !== 'completed') continue;

      // Render Production (Andy Warhol) or Conversion Assembly (legacy) produces final social post assets
      if (dept.includes('render') || dept.includes('conversion') || dept.includes('assembly')) {
        const outputs = await getTaskOutputs(task.id);
        for (const out of outputs) {
          try {
            const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;

            // Multi-asset mode: assets array with individual posts
            const assets = parsed?.assets || parsed?.posts || [];
            if (Array.isArray(assets) && assets.length > 0) {
              for (const asset of assets) {
                const artifactPath = asset?.artifact_path ?? asset?.image_path ?? '';
                const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : null;
                posts.push({
                  caption: asset?.caption ?? asset?.body_copy ?? asset?.body ?? '',
                  hashtags: asset?.hashtags ?? [],
                  imageUrl,
                  imagePrompt: asset?.image_prompt ?? asset?.render_prompt ?? null,
                  postType: asset?.post_type ?? asset?.lane ?? 'general',
                  sourceType: asset?.source_type ?? asset?.lane ?? null,
                  newsAngle: asset?.news_angle ?? asset?.angle ?? null,
                  patternType: asset?.pattern_type ?? asset?.lane ?? null,
                  rssItemTitle: asset?.rss_item_title ?? null,
                  rssItemLink: asset?.rss_item_link ?? null,
                  sourceAttribution: asset?.source_attribution ?? parsed?.source_attribution ?? null,
                  platforms: asset?.platforms ?? ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
                });
              }
            } else if (parsed?.caption || parsed?.body_copy) {
              // Single-post fallback
              const artifactPath = parsed?.artifact_path ?? '';
              const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : await getTaskArtifact(task.id);
              posts.push({
                caption: parsed.caption ?? parsed.body_copy ?? '',
                hashtags: parsed.hashtags ?? [],
                imageUrl,
                imagePrompt: parsed.image_prompt ?? null,
                postType: parsed.post_type ?? 'general',
                sourceType: parsed.source_type ?? null,
                newsAngle: parsed.news_angle ?? null,
                patternType: parsed.pattern_type ?? null,
                rssItemTitle: null,
                rssItemLink: null,
                sourceAttribution: parsed?.source_attribution ?? null,
                platforms: parsed.platforms ?? ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
              });
            } else if (parsed?.status === 'success' && (parsed?.background_asset_path || parsed?.image_asset_path || parsed?.asset_path || parsed?.r2_key || parsed?.final_image_url || parsed?.image_url)) {
              // Render-only output (no caption in render task) — pull copy from upstream Creative Direction
              const artifactPath = parsed.background_asset_path || parsed.image_asset_path || parsed.asset_path || parsed.r2_key || parsed.final_image_url || parsed.image_url;
              const imageUrl = artifactPath ? await resolveArtifactUrl(artifactPath) : null;

              // Find Creative Direction task in same workflow for caption/copy
              let caption = '';
              let hashtags: string[] = [];
              let newsAngle: string | null = null;
              const creativeTask = ourTasks.find((t: any) => {
                const d = (t?.department ?? '').toLowerCase();
                return (d.includes('creative direction') || d.includes('direction')) &&
                  ((t?.status ?? '').toLowerCase() === 'complete' || (t?.status ?? '').toLowerCase() === 'completed');
              });
              if (creativeTask) {
                try {
                  const cdOutputs = await getTaskOutputs(creativeTask.id);
                  for (const cdOut of cdOutputs) {
                    const cdParsed = typeof cdOut.output === 'string' ? JSON.parse(cdOut.output) : cdOut.output;
                    const smc = cdParsed?.social_media_caption;
                    if (smc?.full_caption) {
                      caption = smc.full_caption;
                      hashtags = smc.hashtags ?? cdParsed?.hashtags ?? [];
                      newsAngle = cdParsed?.headline ?? cdParsed?.final_headline ?? null;
                      break;
                    }
                    if (cdParsed?.final_body_copy || cdParsed?.body_copy) {
                      caption = cdParsed.final_body_copy ?? cdParsed.body_copy ?? '';
                      hashtags = cdParsed?.hashtags ?? [];
                      newsAngle = cdParsed?.headline ?? cdParsed?.final_headline ?? null;
                      break;
                    }
                  }
                } catch { /* skip */ }
              }

              if (imageUrl) {
                console.log(`[getSocialWorkflowResults] Render-only post assembled: image=${artifactPath}, caption=${caption.slice(0, 60)}...`);
                posts.push({
                  caption,
                  hashtags,
                  imageUrl,
                  imagePrompt: parsed.prompt_used ?? null,
                  postType: parsed.post_type ?? 'general',
                  sourceType: parsed.source_type ?? null,
                  newsAngle,
                  patternType: parsed.pattern_type ?? null,
                  rssItemTitle: null,
                  rssItemLink: null,
                  sourceAttribution: parsed?.source_attribution ?? null,
                  platforms: parsed.platforms ?? ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
                });
              }
            }
          } catch { /* skip unparseable outputs */ }
        }
      }
    }

    return { success: true, posts, status: 'completed', businessContext };
  } catch (err: any) {
    console.error('Social workflow results error:', err?.message);
    return { success: false, posts: [], status: 'error' };
  }
}

export function extractAdsFromResults(tasks: any[]) {
  return { ads: [], seoData: null, postingPlan: null };
}
export async function enrichAdsWithOutputs(ads: any[]) {
  return ads;
}
export async function getMissionResults(missionId: string) {
  return getWorkflowResults([missionId]);
}

// ── Concept Website Workflow ──────────────────────────────────────────────────

export interface ConceptWebsitePayload {
  website_url: string;
  business_name: string;
  industry: string;
  location?: string;
  locations_count?: number;
  primary_location?: Record<string, any>;
  all_locations?: Array<Record<string, any>>;
  content_profile?: Record<string, any>;
  business_id?: string;
  user_id?: string;
  google_maps_api_key?: string;
  // Reference websites (design inspiration)
  reference_sites?: string[];
  reference_instructions?: string;
  inspiration_only?: boolean;
  do_not_copy_assets?: boolean;
  // Competitive SEO scout
  analyze_competitors?: boolean;
  primary_keyword?: string;
  trade_area?: string;
  competitor_urls?: string[];
  competitor_count?: number;
  // Owner feedback for revision workflows
  owner_feedback?: Array<{
    section_id: string;
    target: string;
    feedback: string;
    requested_action?: string;
  }>;
}

/**
 * Create a concept-website workflow via the dedicated Tombstone endpoint.
 * Returns the workflow_id and task_ids for progress tracking.
 */
export async function createConceptWebsiteMission(payload: ConceptWebsitePayload) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000); // 180s — Render cold-starts + business provisioning can be slow
    let res: Response;
    try {
      res = await fetch(`${TOMBSTONE_URL}/workflows/concept-website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      console.error('[concept-website] Tombstone error:', res.status, data);
      return { success: false, workflowId: null, taskIds: [], error: data?.detail ?? 'Workflow creation failed' };
    }
    return {
      success: true,
      workflowId: data.workflow_id as string,
      taskIds: (data.task_ids ?? []) as number[],
      missionName: data.mission_name as string,
      stepCount: data.step_count as number,
    };
  } catch (err: any) {
    console.error('[concept-website] Error creating workflow:', err?.message);
    return { success: false, workflowId: null, taskIds: [], error: err?.message ?? 'Unknown error' };
  }
}

/**
 * Get status + final HTML for a concept-website workflow.
 * Reuses getMultiWorkflowStatus for step tracking, then extracts
 * George Boole's HTML output from the final task when complete.
 */
export async function getConceptWebsiteStatus(workflowId: string, finalTaskId?: number) {
  const statusResult = await getMultiWorkflowStatus([workflowId]);

  // Map tasks to concept-website step labels
  const stepLabels: Record<string, string> = {
    'Research': 'Research & Competitor Evaluation',
    'Marketing': 'Website Strategy Brief',
    'Creative Strategy': 'Website War Room',
    'Creative Direction': 'Direction Selection',
    'Asset Retrieval': 'Asset Retrieval',
    'Render Production': 'Image Generation',
    'Code Execution': 'Website Copywriting',
    'Strategy & Intelligence': 'Quality Review',
  };

  const steps = (statusResult.tasks ?? []).map((t: any) => ({
    ...t,
    label: stepLabels[t.department] ?? t.label,
  }));

  let html: string | null = null;

  // Find the HTML artifact from the Code Execution step (George Boole),
  // NOT the last task (which is now the War Room review step).
  const allTasks = statusResult.tasks ?? [];
  const htmlTask = allTasks.find((t: any) => t.department === 'Code Execution' && t.status === 'complete');
  const htmlTaskId = htmlTask?.id ?? finalTaskId;

  // Extract HTML if Code Execution completed (even if War Room later rejected)
  if (htmlTaskId && (statusResult.status === 'completed' || htmlTask)) {
    const outputs = await getTaskOutputs(htmlTaskId);
    for (const out of outputs) {
      try {
        const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
        if (parsed?.html) {
          html = parsed.html;
          break;
        }
      } catch { /* skip non-JSON outputs */ }
    }
  }

  // Resolve any raw R2 key paths remaining in the HTML (e.g. renders/task_xxx/...)
  if (html) {
    // Match src attributes containing R2 keys: renders/, assets/, recon/, or r2:// URIs
    const r2PathRegex = /src="((?:renders|assets|recon)\/[^"]+|r2:\/\/[^"]+)"/g;
    const matches = [...html.matchAll(r2PathRegex)];
    if (matches.length > 0) {
      const resolvedMap = new Map<string, string>();
      await Promise.all(
        matches.map(async (m) => {
          const key = m[1];
          if (!resolvedMap.has(key)) {
            const url = await resolveArtifactUrl(key);
            if (url) resolvedMap.set(key, url);
          }
        }),
      );
      for (const [key, url] of resolvedMap) {
        html = html!.split(`src="${key}"`).join(`src="${url}"`);
      }
    }

    // Also fix malformed presigned URLs where r2://bucket/ was URL-encoded into the path
    // Pattern: ...r2.cloudflarestorage.com/bucket/r2%3A/bucketname/recon/... → extract real key
    const malformedR2Regex = /src="(https:\/\/[^"]*r2\.cloudflarestorage\.com\/[^\/]+\/r2%3A[^"]+)"/g;
    const malformedMatches = [...html.matchAll(malformedR2Regex)];
    if (malformedMatches.length > 0) {
      const fixedMap = new Map<string, string>();
      await Promise.all(
        malformedMatches.map(async (m) => {
          const badUrl = m[1];
          if (!fixedMap.has(badUrl)) {
            // Extract the real key: after r2%3A/bucketname/ find the actual path (recon/...)
            // URL pattern: .../tombstoner2/r2%3A/tombstoner2customerassets/recon/Name/file.jpg?sig...
            const r2Marker = badUrl.indexOf('r2%3A/');
            if (r2Marker >= 0) {
              const afterMarker = badUrl.slice(r2Marker + 6); // after 'r2%3A/'
              // Skip bucket name segment
              const slashIdx = afterMarker.indexOf('/');
              if (slashIdx >= 0) {
                let realKey = afterMarker.slice(slashIdx + 1);
                // Remove query string (presigned params)
                const qIdx = realKey.indexOf('?');
                if (qIdx >= 0) realKey = realKey.slice(0, qIdx);
                realKey = decodeURIComponent(realKey);
                const resolved = await resolveArtifactUrl(realKey);
                if (resolved) fixedMap.set(badUrl, resolved);
              }
            }
          }
        }),
      );
      for (const [badUrl, goodUrl] of fixedMap) {
        html = html!.split(`src="${badUrl}"`).join(`src="${goodUrl}"`);
      }
    }

    // Fix background-image: url('...') with malformed R2 paths too
    const bgMalformedRegex = /url\(['"]?(https:\/\/[^)]*r2\.cloudflarestorage\.com\/[^\/]+\/r2%3A[^)'"]+)['"]?\)/g;
    const bgMatches = [...html.matchAll(bgMalformedRegex)];
    if (bgMatches.length > 0) {
      for (const m of bgMatches) {
        const badUrl = m[1];
        const r2Marker = badUrl.indexOf('r2%3A/');
        if (r2Marker >= 0) {
          const afterMarker = badUrl.slice(r2Marker + 6);
          const slashIdx = afterMarker.indexOf('/');
          if (slashIdx >= 0) {
            let realKey = afterMarker.slice(slashIdx + 1);
            const qIdx = realKey.indexOf('?');
            if (qIdx >= 0) realKey = realKey.slice(0, qIdx);
            realKey = decodeURIComponent(realKey);
            const resolved = await resolveArtifactUrl(realKey);
            if (resolved) {
              html = html!.split(badUrl).join(resolved);
            }
          }
        }
      }
    }
  }

  // Extract competitor intelligence from the Research (Jim Bridger) step output
  let competitorIntelligence: Record<string, any> | null = null;
  const reconTask = allTasks.find((t: any) => t.department === 'Research' && t.status === 'complete');
  if (reconTask?.id) {
    try {
      const reconOutputs = await getTaskOutputs(reconTask.id);
      for (const out of reconOutputs) {
        try {
          const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          if (parsed?.competitor_intelligence && typeof parsed.competitor_intelligence === 'object') {
            const ci = parsed.competitor_intelligence;
            if (ci.status === 'ok' && ci.concepts?.length > 0) {
              competitorIntelligence = {
                concepts: ci.concepts,
                warRoomEvaluation: ci.war_room_evaluation,
                finalSitePlan: ci.final_site_plan,
                winningConceptId: ci.winning_concept_id,
                competitiveSynthesis: ci.competitive_synthesis?.synthesis,
                competitorCount: ci.competitor_analyses?.length ?? 0,
              };
            }
            break;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return {
    ...statusResult,
    steps,
    html,
    competitorIntelligence,
  };
}