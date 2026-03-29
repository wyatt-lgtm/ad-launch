const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Submit a command to Tombstone OS via /commands endpoint.
 * This creates a full workflow (6-step pipeline) and returns created task IDs.
 */
export async function createMission(websiteUrl: string) {
  try {
    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const command = `review ${normalizedUrl} and make facebook ad for the business - minimal design use colors and logo from website`;

    const res = await fetch(`${TOMBSTONE_URL}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('Tombstone /commands error:', res.status, data);
      return { success: false, data: null, missionId: null, taskIds: [] };
    }

    const taskIds: number[] = data?.created_task_ids ?? [];
    // The workflow_id comes from fetching any created task
    let workflowId: string | null = null;
    if (taskIds.length > 0) {
      try {
        const taskRes = await fetch(`${TOMBSTONE_URL}/tasks/${taskIds[0]}`);
        const taskData = await taskRes.json().catch(() => ({}));
        workflowId = taskData?.workflow_id ?? null;
      } catch { /* ignore */ }
    }

    return {
      success: true,
      data,
      missionId: workflowId ?? (taskIds.length > 0 ? `tasks:${taskIds.join(',')}` : null),
      taskIds,
    };
  } catch (err: any) {
    console.error('Tombstone create mission error:', err?.message);
    return { success: false, data: null, missionId: null, taskIds: [] };
  }
}

/**
 * Get the status of a workflow by checking all tasks with the given workflow_id.
 * If missionId starts with "tasks:", we fetch individual tasks instead.
 */
export async function getMissionStatus(missionId: string) {
  try {
    let tasks: any[] = [];

    if (missionId.startsWith('tasks:')) {
      // Legacy: fetch individual task IDs
      const ids = missionId.replace('tasks:', '').split(',').map(Number);
      for (const id of ids) {
        const res = await fetch(`${TOMBSTONE_URL}/tasks/${id}`);
        if (res.ok) {
          const t = await res.json().catch(() => null);
          if (t) tasks.push(t);
        }
      }
    } else {
      // The /tasks endpoint returns ALL tasks (filter param is ignored by the API),
      // so we must filter client-side by workflow_id.
      const res = await fetch(`${TOMBSTONE_URL}/tasks`);
      const data = await res.json().catch(() => []);
      const allTasks = Array.isArray(data) ? data : [];
      tasks = allTasks.filter((t: any) => t?.workflow_id === missionId);
    }

    if (tasks.length === 0) {
      return { success: false, data: null, status: 'unknown', tasks: [] };
    }

    // Determine overall status from ONLY this workflow's tasks
    const statuses = tasks.map((t: any) => (t?.status ?? '').toLowerCase());
    const allComplete = statuses.every((s: string) => s === 'complete' || s === 'completed');
    const anyFailed = statuses.some((s: string) => s === 'failed' || s === 'error');
    const anyBlocked = statuses.some((s: string) => s === 'blocked');
    const anyRunning = statuses.some((s: string) =>
      s === 'in progress' || s === 'in_progress' || s === 'running' || s === 'claimed' || s === 'ready for pickup'
    );

    let overallStatus = 'processing';
    if (allComplete) overallStatus = 'completed';
    else if (anyFailed && !anyRunning && !anyBlocked) overallStatus = 'error';
    else if (anyRunning || anyBlocked) overallStatus = 'generating';

    return { success: true, data: { tasks }, status: overallStatus, tasks };
  } catch (err: any) {
    console.error('Tombstone mission status error:', err?.message);
    return { success: false, data: null, status: 'error', tasks: [] };
  }
}

/**
 * Get the full results for a completed workflow — fetches outputs and artifact URLs
 * for all "Conversion Assembly" (Claude Hopkins) tasks.
 */
export async function getMissionResults(missionId: string) {
  try {
    let tasks: any[] = [];

    if (missionId.startsWith('tasks:')) {
      const ids = missionId.replace('tasks:', '').split(',').map(Number);
      for (const id of ids) {
        const res = await fetch(`${TOMBSTONE_URL}/tasks/${id}`);
        if (res.ok) {
          const t = await res.json().catch(() => null);
          if (t) tasks.push(t);
        }
      }
    } else {
      const res = await fetch(`${TOMBSTONE_URL}/tasks`);
      const data = await res.json().catch(() => []);
      const allTasks = Array.isArray(data) ? data : [];
      tasks = allTasks.filter((t: any) => t?.workflow_id === missionId);
    }

    return { success: true, data: tasks };
  } catch (err: any) {
    console.error('Tombstone results error:', err?.message);
    return { success: false, data: null };
  }
}

/**
 * Get artifact URL (signed R2 URL) for a specific task.
 */
export async function getTaskArtifact(taskId: number): Promise<string | null> {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/artifact`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Get task output (from /tasks/{id}/outputs endpoint).
 */
export async function getTaskOutputs(taskId: number): Promise<any[]> {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/tasks/${taskId}/outputs`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Extract ads from workflow tasks.
 * Looks for "Conversion Assembly" tasks (Claude Hopkins) which contain final ad outputs.
 */
export function extractAdsFromResults(tasks: any[]): { ads: any[]; seoData: any; postingPlan: any } {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const ads: any[] = [];
  let seoData: any = null;
  let postingPlan: any = null;

  // Sort by step_order descending to get the latest tasks first
  const sorted = [...taskList].sort((a, b) => (b?.step_order ?? 0) - (a?.step_order ?? 0));

  for (const task of sorted) {
    const dept = (task?.department ?? '').toLowerCase();
    const status = (task?.status ?? '').toLowerCase();

    // Only process completed tasks
    if (status !== 'complete' && status !== 'completed') continue;

    // Conversion Assembly = final ad (Claude Hopkins)
    if (dept.includes('conversion') || dept.includes('assembly')) {
      ads.push({
        taskId: task.id,
        headline: task?.summary ?? task?.mission ?? 'Ad',
        caption: null, // Will be filled from outputs
        imageUrl: null, // Will be filled from artifact
      });
    }

    // Research tasks may contain SEO data
    if (dept.includes('research')) {
      if (!seoData) seoData = { source: 'research', taskId: task.id };
    }

    // Marketing tasks may contain posting plan info
    if (dept.includes('marketing')) {
      if (!postingPlan) postingPlan = { source: 'marketing', taskId: task.id };
    }
  }

  return { ads: ads.slice(0, 3), seoData, postingPlan };
}

/**
 * Enrich extracted ads with actual output data and artifact URLs.
 */
export async function enrichAdsWithOutputs(ads: any[]): Promise<any[]> {
  const enriched = [];
  for (const ad of ads) {
    if (!ad?.taskId) {
      enriched.push(ad);
      continue;
    }

    // Get artifact (image URL)
    const imageUrl = await getTaskArtifact(ad.taskId);

    // Get outputs for caption/headline
    const outputs = await getTaskOutputs(ad.taskId);
    let headline = ad.headline;
    let caption = '';
    let body = '';
    let cta = '';

    for (const out of outputs) {
      try {
        const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
        if (parsed?.headline) headline = parsed.headline;
        if (parsed?.body) body = parsed.body;
        if (parsed?.cta) cta = parsed.cta;
        if (parsed?.caption) caption = parsed.caption;
      } catch { /* ignore parse errors */ }
    }

    if (!caption && body) {
      caption = body + (cta ? `\n\n${cta}` : '');
    }

    enriched.push({
      ...ad,
      headline: headline ?? 'Ad',
      caption: caption || body || null,
      imageUrl: imageUrl ?? null,
      cta: cta || null,
    });
  }
  return enriched;
}