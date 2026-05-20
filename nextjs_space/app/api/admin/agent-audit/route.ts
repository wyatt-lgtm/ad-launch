export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// Agent display metadata — maps department names to friendly agent info
const AGENT_META: Record<string, { agent: string; department: string; order: number }> = {
  'business analysis':    { agent: 'Jim Bridger',     department: 'Business Analysis',    order: 1 },
  'website recon':        { agent: 'Jim Bridger',     department: 'Website Recon',         order: 1 },
  'research':             { agent: 'Jim Bridger',     department: 'Research',              order: 1 },
  'marketing':            { agent: 'Zig Ziglar',      department: 'Marketing Strategy',    order: 2 },
  'marketing strategy':   { agent: 'Zig Ziglar',      department: 'Marketing Strategy',    order: 2 },
  'creative strategy':    { agent: 'David Ogilvy',    department: 'Creative Strategy',     order: 3 },
  'ad copywriting':       { agent: 'David Ogilvy',    department: 'Ad Copywriting',        order: 3 },
  'creative direction':   { agent: 'Don Draper',      department: 'Creative Direction',    order: 4 },
  'visual direction':     { agent: 'Don Draper',      department: 'Visual Direction',      order: 4 },
  'render production':    { agent: 'Andy Warhol',     department: 'Render Production',     order: 5 },
  'image generation':     { agent: 'Andy Warhol',     department: 'Image Generation',      order: 5 },
  'conversion assembly':  { agent: 'Claude Hopkins',  department: 'Conversion Assembly',   order: 6 },
  'final assembly':       { agent: 'Claude Hopkins',  department: 'Final Assembly',        order: 6 },
  'operations':           { agent: 'Wyatt Earp',      department: 'Operations / Routing',  order: 0 },
  'dispatch':             { agent: 'Dispatcher',      department: 'Dispatch',              order: 0 },
};

function resolveAgentMeta(dept: string, claimedBy?: string | null) {
  const key = (dept || '').toLowerCase().trim();
  const meta = AGENT_META[key];
  return {
    agentName: meta?.agent || claimedBy || 'Unknown',
    departmentLabel: meta?.department || dept || 'Unknown',
    sortOrder: meta?.order ?? 99,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const url = new URL(req.url);
  const postIdParam = url.searchParams.get('postId');

  try {
    // Step 1: Find the most recent SocialPost with a tombstoneTaskId
    const post = postIdParam
      ? await prisma.socialPost.findUnique({ where: { id: postIdParam } })
      : await prisma.socialPost.findFirst({
          where: { tombstoneTaskId: { not: null } },
          orderBy: { createdAt: 'desc' },
        });

    if (!post || !post.tombstoneTaskId) {
      return NextResponse.json({
        error: 'No social post found with a linked Tombstone task',
        post: null,
        stages: [],
      });
    }

    // Step 2: Fetch the originating task from Tombstone to get workflow_id
    const taskRes = await fetchTombstone(`/tasks/${post.tombstoneTaskId}`);
    if (!taskRes.ok) {
      return NextResponse.json({
        error: `Could not fetch Tombstone task ${post.tombstoneTaskId} (HTTP ${taskRes.status})`,
        post: formatPost(post),
        stages: [],
      });
    }

    const originTask = await taskRes.json();
    const workflowId = originTask?.workflow_id;

    if (!workflowId) {
      return NextResponse.json({
        error: `Task ${post.tombstoneTaskId} has no workflow_id — cannot trace pipeline`,
        post: formatPost(post),
        stages: [await buildStage(originTask)],
      });
    }

    // Step 3: Fetch ALL tasks, filter to this workflow
    const allRes = await fetchTombstone('/tasks');
    if (!allRes.ok) {
      return NextResponse.json({
        error: `Failed to fetch Tombstone tasks list (HTTP ${allRes.status})`,
        post: formatPost(post),
        stages: [],
      });
    }

    const allTasks: any[] = await allRes.json();
    const workflowTasks = allTasks.filter((t: any) => t?.workflow_id === workflowId);

    // Step 4: Fetch outputs for each task and build stage objects
    const stages = await Promise.all(
      workflowTasks.map((t: any) => buildStage(t))
    );

    // Step 5: Sort by pipeline order (step_order → dependency chain → sortOrder)
    stages.sort((a, b) => {
      // Primary: step_order if available
      if (a.stepOrder !== null && b.stepOrder !== null) return a.stepOrder - b.stepOrder;
      if (a.stepOrder !== null) return -1;
      if (b.stepOrder !== null) return 1;
      // Secondary: agent pipeline order
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      // Tertiary: task ID (creation order)
      return a.taskId - b.taskId;
    });

    // Step 6: Detect Claude Hopkins bypass
    const hasHopkins = stages.some(s => s.agentName === 'Claude Hopkins');
    const hopkinsNote = hasHopkins
      ? null
      : 'Claude Hopkins (Conversion Assembly) is currently bypassed in the active pipeline. All rendering is handled by Andy Warhol in single-shot mode.';

    return NextResponse.json({
      post: formatPost(post),
      workflowId,
      taskCount: stages.length,
      hopkinsNote,
      stages,
    });
  } catch (err: any) {
    console.error('[agent-audit] Error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

async function fetchTombstone(path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${TOMBSTONE_URL}${path}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function formatPost(post: any) {
  return {
    id: post.id,
    caption: post.caption,
    hashtags: post.hashtags,
    imageUrl: post.imageUrl,
    imagePrompt: post.imagePrompt,
    status: post.status,
    postType: post.postType,
    sourceType: post.sourceType,
    tombstoneTaskId: post.tombstoneTaskId,
    createdAt: post.createdAt,
  };
}

async function buildStage(task: any) {
  const { agentName, departmentLabel, sortOrder } = resolveAgentMeta(
    task?.department, task?.claimed_by
  );

  // Fetch outputs
  let rawOutputs: any[] = [];
  let parsedOutput: any = null;
  let artifactUrl: string | null = null;
  let metadata: Record<string, any> = {};

  try {
    const outRes = await fetchTombstone(`/tasks/${task.id}/outputs`);
    if (outRes.ok) {
      rawOutputs = await outRes.json();
      if (!Array.isArray(rawOutputs)) rawOutputs = [];
    }
  } catch { /* ignore */ }

  // Try to parse the most recent output
  for (const out of rawOutputs) {
    try {
      const parsed = typeof out.output === 'string' ? JSON.parse(out.output) : out.output;
      if (parsed && typeof parsed === 'object') {
        parsedOutput = parsed;
        break;
      }
    } catch { /* raw text output */ }
  }

  // Extract metadata from parsed output
  if (parsedOutput) {
    if (parsedOutput.provider) metadata.provider = parsedOutput.provider;
    if (parsedOutput.render_model) metadata.render_model = parsedOutput.render_model;
    if (parsedOutput.storage) metadata.storage = parsedOutput.storage;
    if (parsedOutput.aspect_ratio) metadata.aspect_ratio = parsedOutput.aspect_ratio;
    if (parsedOutput.full_composition !== undefined) metadata.full_composition = parsedOutput.full_composition;
    if (parsedOutput.task_type) metadata.task_type = parsedOutput.task_type;

    // Extract artifact URL if present
    artifactUrl = parsedOutput.background_asset_path
      || parsedOutput.artifact_path
      || parsedOutput.image_path
      || null;

    // Multi-render: first render's path
    if (!artifactUrl && Array.isArray(parsedOutput.renders) && parsedOutput.renders.length > 0) {
      artifactUrl = parsedOutput.renders[0]?.background_asset_path || null;
    }
  }

  return {
    taskId: task.id,
    agentName,
    departmentLabel,
    sortOrder,
    stepOrder: task.step_order ?? null,
    status: task.status,
    claimedBy: task.claimed_by || null,
    dependsOnTaskId: task.depends_on_task_id || null,
    inputFromTaskId: task.input_from_task_id || null,
    createdAt: task.created_at || null,
    completedAt: task.status?.toLowerCase().includes('complete') ? (task.updated_at || null) : null,
    mission: task.mission || null,
    summary: task.summary || null,
    rawOutput: rawOutputs.length > 0 ? rawOutputs[0]?.output || null : null,
    parsedOutput,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    artifactUrl,
    retryCount: task.retry_count ?? 0,
    lastError: task.last_error || null,
  };
}
