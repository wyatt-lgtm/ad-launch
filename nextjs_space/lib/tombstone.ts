const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Submit a command to Tombstone OS. Returns created task IDs and workflow info.
 */
async function sendCommand(command: string) {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Tombstone /commands error:', res.status, data);
      return { success: false, data: null, workflowId: null, taskIds: [] };
    }
    const taskIds: number[] = data?.created_task_ids ?? [];
    let workflowId: string | null = null;
    if (taskIds.length > 0) {
      try {
        const taskRes = await fetch(`${TOMBSTONE_URL}/tasks/${taskIds[0]}`, { cache: 'no-store' });
        const taskData = await taskRes.json().catch(() => ({}));
        workflowId = taskData?.workflow_id ?? null;
      } catch { /* ignore */ }
    }
    return { success: true, data, workflowId, taskIds };
  } catch (err: any) {
    console.error('Tombstone command error:', err?.message);
    return { success: false, data: null, workflowId: null, taskIds: [] };
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
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  let command = '';
  if (lane === 'website') {
    command = [
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} promoting the business.`,
      `Focus on the business brand, services, offers, and unique value proposition found on the website.`,
      `Use colors, logo, and brand voice from the website. Make it feel authentic — like the business owner wrote it.`,
      context ? `\nAdditional context:\n${context}` : '',
    ].filter(Boolean).join('\n');
  } else if (lane === 'news') {
    command = [
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} that connects the business to local news.`,
      `The post should tie the business to local community news in a way that feels natural and relevant.`,
      `Use the business brand colors and voice from the website.`,
      `\nLocal news context to reference:\n${context}`,
    ].join('\n');
  } else if (lane === 'holiday') {
    command = [
      `review ${normalizedUrl} and create ${count} social media post${count > 1 ? 's' : ''} tied to an upcoming holiday or seasonal event.`,
      `The post should connect the business to the holiday/event in a creative, engaging way.`,
      `Use the business brand colors and voice from the website.`,
      `\nUpcoming events/holidays:\n${context}`,
    ].join('\n');
  }

  console.log(`[tombstone] Creating ${lane} lane mission (${count} posts) for: ${normalizedUrl}`);
  const result = await sendCommand(command);

  return {
    success: !!result.workflowId,
    workflowId: result.workflowId,
    taskIds: result.taskIds,
    lane,
  };
}

/**
 * Create a social content mission that sends Clark Kent's LOCAL scout brief
 * to Tombstone. Jim Bridger (Research agent, step 1 of every workflow)
 * handles all website/business intelligence — Clark Kent only provides
 * local context: RSS headlines, upcoming events, and trade area geography.
 *
 * The scout brief is embedded in the command text so Wyatt routes it
 * through Bridger → Zig → Ogilvy → Draper → Warhol → Hopkins.
 */
export async function createSocialMissions(
  websiteUrl: string,
  scoutSummary: string,
  options: { postCount?: number; platforms?: string[] } = {},
) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const postCount = options.postCount || 9;
  const platforms = options.platforms || ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'];

  // Build the Tombstone command with local scout intel embedded.
  // Jim Bridger will independently scout the website for business identity,
  // brand voice, offers, palette, etc. Clark Kent supplements with LOCAL intel only.
  const command = [
    `Create ${postCount} social media posts for ${normalizedUrl} targeting these platforms: ${platforms.join(', ')}.`,
    ``,
    `Jim Bridger will handle website recon (business identity, brand voice, offers, palette).`,
    `Below is LOCAL intelligence from Clark Kent's scout report — RSS news, upcoming events,`,
    `and trade area context that Bridger cannot get from the website:`,
    ``,
    `--- LOCAL SCOUT BRIEF ---`,
    scoutSummary,
    `--- END LOCAL SCOUT BRIEF ---`,
    ``,
    `Create 3 lanes of content:`,
    `  Lane 1 (Local News): 3 posts leveraging the local RSS headlines above — community news a business owner would share`,
    `  Lane 2 (Business): 3 promotional posts using Bridger's website recon — who they are, what they offer, why choose them`,
    `  Lane 3 (Seasonal): 3 posts tied to the upcoming events/holidays listed above`,
    ``,
    `Each post needs: caption, hashtags, an image/artwork, and the target platforms.`,
    `Posts should feel authentic — like a real small business owner wrote them.`,
    `Use Bridger's brand palette and voice for visual and tonal consistency.`,
  ].join('\n');

  console.log(`[tombstone] Creating social content mission for: ${normalizedUrl} (${postCount} posts)`);

  const result = await sendCommand(command);

  return {
    success: !!result.workflowId,
    workflowIds: result.workflowId ? [result.workflowId] : [],
    allTaskIds: result.taskIds,
    postCount,
    platforms,
  };
}

// Legacy single-mission creator (kept for backward compat)
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
  'research': { label: 'Business Analysis', description: 'Scanning website, extracting brand assets & palette' },
  'marketing': { label: 'Marketing Strategy', description: 'Defining audience, offer framing & keywords' },
  'creative strategy': { label: 'Ad Copywriting', description: 'Writing headlines, body copy & CTAs' },
  'creative direction': { label: 'Visual Direction', description: 'Creating art direction & image prompt' },
  'render production': { label: 'Image Generation', description: 'Generating final ad images with GPT 5.1' },
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
    const timer = setTimeout(() => controller.abort(), 15000); // 15s timeout for large response
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
        department: t?.department ?? '',
        label,
        description,
        status: uiStatus,
        rawStatus: t?.status,
        lastError: t?.last_error ?? null,
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

    return { success: true, tasks: taskList, status: overallStatus };
  } catch (err: any) {
    console.error('Multi-workflow status error:', err?.message);
    return { success: false, tasks: [], status: 'error' };
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
        const artifactPath = taskOutput?.background_asset_path ?? '';
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
  try {
    const res = await fetch(`${TOMBSTONE_URL}/artifacts/resolve?artifact_path=${encodeURIComponent(artifactPath)}`, { cache: 'no-store' });
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
      return { success: true, posts: [], status: overallStatus };
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
                platforms: parsed.platforms ?? ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'snapchat'],
              });
            }
          } catch { /* skip unparseable outputs */ }
        }
      }
    }

    return { success: true, posts, status: 'completed' };
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