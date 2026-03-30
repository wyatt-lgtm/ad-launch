const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// Ad campaign angles for generating 3 distinct ads
const AD_ANGLES = [
  'awareness - focus on what makes this business unique and memorable',
  'conversion - focus on a compelling offer, urgency, and clear call to action',
  'trust - focus on credibility, social proof, customer results, and reliability',
];

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
 * Create 3 distinct ad missions for the given website.
 * Each mission targets a different advertising angle.
 * Returns an array of workflow IDs.
 */
export async function createMissions(websiteUrl: string) {
  const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const results: { workflowId: string | null; taskIds: number[]; angle: string }[] = [];

  for (let i = 0; i < AD_ANGLES.length; i++) {
    const angle = AD_ANGLES[i];
    const command = `review ${normalizedUrl} and make a minimal facebook ad for the business - use colors and logo from website - ad angle: ${angle}`;
    console.log(`[tombstone] Creating mission ${i + 1}/3: ${angle.split(' - ')[0]}`);
    const result = await sendCommand(command);
    results.push({
      workflowId: result.workflowId,
      taskIds: result.taskIds,
      angle: angle.split(' - ')[0],
    });
    // Small delay between commands to avoid overwhelming the API
    if (i < AD_ANGLES.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const allTaskIds = results.flatMap((r) => r.taskIds);
  const workflowIds = results.map((r) => r.workflowId).filter(Boolean) as string[];

  return {
    success: workflowIds.length > 0,
    workflowIds,
    allTaskIds,
    angles: results.map((r) => r.angle),
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
  'render production': { label: 'Image Generation', description: 'Generating background artwork' },
  'conversion assembly': { label: 'Final Composition', description: 'Composing text overlays on final ad' },
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
    const res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store' });
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
    const res = await fetch(`${TOMBSTONE_URL}/tasks`, { cache: 'no-store' });
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

    for (const [wfId, tasks] of byWorkflow) {
      for (const task of tasks) {
        const dept = (task?.department ?? '').toLowerCase();
        const status = (task?.status ?? '').toLowerCase();
        if (status !== 'complete' && status !== 'completed') continue;

        // Conversion Assembly = final ad
        if (dept.includes('conversion') || dept.includes('assembly')) {
          ads.push({ taskId: task.id, workflowId: wfId });
        }
        // First research task has business data for SEO
        if (dept.includes('research') && !researchData) {
          researchData = { taskId: task.id };
        }
        // Marketing task has strategy data
        if (dept.includes('marketing') && !marketingData) {
          marketingData = { taskId: task.id };
        }
        // Creative strategy has copy data
        if (dept.includes('creative strategy') && !creativeData) {
          creativeData = { taskId: task.id };
        }
      }
    }

    // Enrich ads with artifact URLs and outputs
    const enrichedAds = [];
    for (const ad of ads.slice(0, 3)) {
      const imageUrl = await getTaskArtifact(ad.taskId);
      const outputs = await getTaskOutputs(ad.taskId);
      let headline = '';
      let caption = '';
      let cta = '';
      for (const out of outputs) {
        try {
          const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
          if (parsed?.headline) headline = parsed.headline;
          if (parsed?.body_copy || parsed?.body) caption = parsed.body_copy || parsed.body;
          if (parsed?.cta) cta = parsed.cta;
          if (parsed?.caption) caption = parsed.caption;
        } catch { /* ignore */ }
      }
      enrichedAds.push({ ...ad, headline, caption, cta, imageUrl });
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

    return {
      success: true,
      ads: enrichedAds,
      research: researchOutput,
      marketing: marketingData,
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

export async function getTaskOutputs(taskId: number): Promise<any[]> {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/outputs`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// Legacy exports for backward compatibility
export function extractAdsFromResults(tasks: any[]) {
  return { ads: [], seoData: null, postingPlan: null };
}
export async function enrichAdsWithOutputs(ads: any[]) {
  return ads;
}
export async function getMissionResults(missionId: string) {
  return getWorkflowResults([missionId]);
}
