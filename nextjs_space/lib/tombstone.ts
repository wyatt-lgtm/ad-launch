import { loadBusinessProfile, formatProfileForCommand, isStale } from '@/lib/business-profile';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

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

/**
 * Submit a command to Tombstone OS. Returns created task IDs and workflow info.
 *
 * `businessId` (the Tombstone integer business_id from /businesses/provisional)
 * is REQUIRED by the backend isolation gate for customer-facing content — it is
 * sent in the payload so every generated task is scoped to the correct business.
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
  tombstoneBusinessId?: number | string | null,
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  // Load saved business profile to avoid full re-analysis
  const profileBlock = await getBusinessProfileBlock(businessId);

  let command = '';
  if (lane === 'website') {
    command = [
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} promoting the business.`,
      `Focus on the business brand, services, offers, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website. Make it feel authentic — like the business owner wrote it.`,
      profileBlock,
      context ? `\nAdditional context:\n${context}` : '',
    ].filter(Boolean).join('\n');
  } else if (lane === 'news') {
    command = [
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
  } = {},
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const platforms = options.platforms || ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];
  const mode = options.contentSourceMode || 'local_plus_interests';
  const MAX_POSTS = 3;
  const stories = (options.stories || []).slice(0, MAX_POSTS);

  // Load saved business profile to avoid full re-analysis
  const profileBlock = options.businessId ? await getBusinessProfileBlock(options.businessId) : '';

  // If no individual stories provided, fall back to single command with full brief
  if (stories.length === 0) {
    console.log(`[tombstone] No individual stories — sending single command for: ${normalizedUrl}`);
    const command = [
      `review ${normalizedUrl} and create 1 social media post promoting the business.`,
      `Focus on the business brand, services, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website.`,
      `Make it feel authentic — like a real small business owner wrote it.`,
      `Target platforms: ${platforms.join(', ')}.`,
      profileBlock,
      scoutSummary ? `\nContext from scout brief:\n${scoutSummary}` : '',
    ].filter(Boolean).join('\n');

    const result = await sendCommand(command);
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
    const command = buildStoryCommand(normalizedUrl, story, platforms, mode, profileBlock);
    console.log(`[tombstone] Sending command ${i + 1}/${stories.length}: "${story.headline?.slice(0, 60)}..." (${story.type || 'interest'})`);

    const result = await sendCommand(command);
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
  },
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const type = story.sourceType === 'national' ? 'event' : story.sourceType === 'industry' ? 'interest' : 'local_news';

  // Load saved business profile to avoid full re-analysis
  const profileBlock = await getBusinessProfileBlock(meta.businessId);

  const command = [
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

  console.log(`[tombstone] Scout story mission for: ${normalizedUrl} — "${story.title.slice(0, 60)}"`);
  const result = await sendCommand(command);

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
  },
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  // Load saved business profile to avoid full re-analysis
  const profileBlock = opts.businessId ? await getBusinessProfileBlock(opts.businessId) : '';

  const command = [
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

  console.log(`[tombstone] Weekly tip mission for: ${normalizedUrl} — "${opts.topic.slice(0, 60)}"`);
  const result = await sendCommand(command);

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

  commandParts.push(`\nIMPORTANT: This is intent=copy_edit_user_post, source=user_written_post. Do NOT run RSS scouting or story discovery.`);

  const command = commandParts.join('\n');
  console.log(`[tombstone] Draft polish mission for: ${normalizedUrl} (art=${generateArt})`);

  const result = await sendCommand(command);
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
    const timer = setTimeout(() => controller.abort(), 25000); // 25s timeout for large response
    let res: Response;
    try {
      res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const allTasks = await res.json().catch(() => []);
    if (!Array.isArray(allTasks)) return { success: false, tasks: [], status: 'error' };

    // Filter tasks belonging to our workflows
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
    const timer = setTimeout(() => controller.abort(), 20000); // 20s timeout
    let res: Response;
    try {
      res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store', signal: controller.signal });
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
      }
    }

    // Enrich ads with artifact URLs and outputs
    // Andy Warhol outputs: { renders: [...], background_asset_path, ... }
    // Claude Hopkins (legacy): { assets: [...], final_ad_path, ... }
    const enrichedAds = [];
    for (const ad of ads) {
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

  try {
    const res = await fetch(`${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(cleanPath)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? null;
  } catch { return null; }
}

export async function getTaskOutputs(taskId: number): Promise<any[]> {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/outputs`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/**
 * Get social content results from a completed social workflow.
 * Parses Tombstone task outputs to extract social posts with captions,
 * hashtags, images, and metadata for SocialPost storage.
 */
export async function getSocialWorkflowResults(workflowIds: string[]) {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store' });
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
}

/**
 * Create a concept-website workflow via the dedicated Tombstone endpoint.
 * Returns the workflow_id and task_ids for progress tracking.
 */
export async function createConceptWebsiteMission(payload: ConceptWebsitePayload) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
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
    'Research': 'Brand Asset Recon',
    'Marketing': 'Website Strategy',
    'Creative Strategy': 'Copy Deck',
    'Creative Direction': 'Creative Contract',
    'Asset Retrieval': 'Asset Retrieval',
    'Render Production': 'Image Generation',
    'Code Execution': 'HTML Generation',
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

  return {
    ...statusResult,
    steps,
    html,
  };
}