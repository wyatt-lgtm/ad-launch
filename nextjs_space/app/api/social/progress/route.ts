export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getMultiWorkflowStatus } from '@/lib/tombstone';

// ── Lag warning thresholds (ms) ──────────────────────────────────────────────
const LAG_THRESHOLDS = {
  AGENT_PICKUP_DELAY: 10_000,       // ready → claimed
  WORKER_HEARTBEAT_DELAY: 10_000,   // claimed → first heartbeat
  COMPLETION_STATE_LAG: 3_000,      // output saved → complete
  POST_PACKAGING_DELAY: 5_000,      // last task complete → social post
  QUEUE_HYDRATION_DELAY: 5_000,     // social post → visible in queue
};

// ── Step labels for the UI progress tracker ──────────────────────────────────
const STEP_LABELS: Record<string, { label: string; icon: string; order: number }> = {
  'business recon':       { label: 'Business Analysis',                   icon: '🔍', order: 1 },
  'research':             { label: 'Research & Source Brief',              icon: '📰', order: 2 },
  'marketing':            { label: 'Marketing Angle',                     icon: '📝', order: 3 },
  'creative strategy':    { label: 'Ogilvy Copy',                         icon: '✏️', order: 4 },
  'creative direction':   { label: 'Don Draper Creative Concepts',        icon: '🎨', order: 5 },
  'creative synthesizer': { label: 'Creative Synthesizer',                icon: '🧪', order: 6 },
  'strategy & intelligence': { label: 'Creative War Room Review',         icon: '⚔️', order: 7 },
  'quality review':       { label: 'Bat Masterson Approval',              icon: '🎩', order: 8 },
  'render production':    { label: 'Image Render',                        icon: '🖼️', order: 9 },
  'conversion assembly':  { label: 'Final Post Assembly',                 icon: '📦', order: 10 },
  'asset retrieval':      { label: 'Asset Retrieval',                     icon: '🎭', order: 6 },
};

function getStepInfo(dept: string): { label: string; icon: string; order: number } {
  const key = dept.toLowerCase().trim();
  return STEP_LABELS[key] || { label: dept, icon: '⚙️', order: 50 };
}

/**
 * Sanitize a progress message to remove any internal vendor/model/provider references.
 */
function sanitizeProgressMessage(msg: string): string {
  const s = String(msg || '');
  if (/fal|gpt-image|openai|render provider|image model/i.test(s)) {
    if (/direction|render direction/i.test(s)) return 'Creating visual direction';
    if (/image|render|generation/i.test(s)) return 'Creating portrait social image';
    return 'Preparing feed-ready image';
  }
  return s
    .replace(/\b(FAL|fal\.ai|gpt-image-\d+|gpt_image\d*|GPT[- ]?image|OpenAI|render provider|image model)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Generating mobile-ready creative';
}

/**
 * Compute derived timing metrics for a single task.
 */
function computeTaskTiming(task: any) {
  const created = task.created_at ? new Date(task.created_at).getTime() : null;
  const claimed = task.claimed_at ? new Date(task.claimed_at).getTime() : null;
  const heartbeat = task.heartbeat_at ? new Date(task.heartbeat_at).getTime() : null;
  const updated = task.updated_at ? new Date(task.updated_at).getTime() : null;
  const isComplete = ['complete', 'completed'].includes((task.status || '').toLowerCase());
  const isFailed = ['failed', 'error'].includes((task.status || '').toLowerCase());
  const completedAt = (isComplete || isFailed) && updated ? updated : null;

  const timing: Record<string, number | null> = {
    createdToClaimedMs: created && claimed ? claimed - created : null,
    claimedToHeartbeatMs: claimed && heartbeat ? heartbeat - claimed : null,
    activeProcessingMs: claimed && completedAt ? completedAt - claimed : null,
    totalLifecycleMs: created && completedAt ? completedAt - created : null,
    heartbeatAgeMs: heartbeat ? Date.now() - heartbeat : null,
  };

  // Lag warnings
  const warnings: string[] = [];
  if (timing.createdToClaimedMs && timing.createdToClaimedMs > LAG_THRESHOLDS.AGENT_PICKUP_DELAY) {
    warnings.push('Agent pickup delay');
  }
  if (timing.claimedToHeartbeatMs && timing.claimedToHeartbeatMs > LAG_THRESHOLDS.WORKER_HEARTBEAT_DELAY) {
    warnings.push('Worker heartbeat delay');
  }
  if (timing.heartbeatAgeMs && timing.heartbeatAgeMs > 60_000 && !isComplete && !isFailed) {
    warnings.push('Stale heartbeat — worker may be stuck');
  }

  return { timing, warnings };
}

/**
 * GET /api/social/progress?workflowIds=id1,id2,...&generationRunId=xxx
 *
 * Returns real-time stage progress for active Tombstone workflows with
 * timing instrumentation, task IDs, elapsed time, and lag warnings.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workflowIdsParam = req.nextUrl.searchParams.get('workflowIds');
    const generationRunId = req.nextUrl.searchParams.get('generationRunId') || null;
    if (!workflowIdsParam) {
      return NextResponse.json({ error: 'workflowIds parameter required' }, { status: 400 });
    }

    const workflowIds = workflowIdsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (workflowIds.length === 0) {
      return NextResponse.json({ error: 'No valid workflow IDs' }, { status: 400 });
    }

    const result = await getMultiWorkflowStatus(workflowIds);

    // Build enriched stages with timing data
    const stages = (result.tasks || []).map((t: any) => {
      const stepInfo = getStepInfo(t.department || t.label || '');
      const rawStatus = (t.status || '').toLowerCase();
      let uiStatus: 'waiting' | 'active' | 'complete' | 'error' = 'waiting';
      if (rawStatus === 'complete' || rawStatus === 'completed') uiStatus = 'complete';
      else if (rawStatus === 'failed' || rawStatus === 'error') uiStatus = 'error';
      else if (['in progress', 'in_progress', 'running', 'claimed'].includes(rawStatus)) uiStatus = 'active';

      const { timing, warnings } = computeTaskTiming(t);

      return {
        label: stepInfo.label,
        icon: stepInfo.icon,
        description: sanitizeProgressMessage(t.description || ''),
        status: uiStatus,
        order: stepInfo.order,
        taskId: t.id,
        workflowId: t.workflow_id || t.workflowId,
        department: t.department,
        agentName: t.claimed_by || null,
        retryCount: t.retry_count || 0,
        timing,
        warnings,
        // Timestamps for admin
        createdAt: t.created_at || null,
        claimedAt: t.claimed_at || null,
        heartbeatAt: t.heartbeat_at || null,
        updatedAt: t.updated_at || null,
        lastError: t.last_error ? 'Step encountered an issue' : null,
      };
    }).sort((a: any, b: any) => {
      // Sort by workflow first, then step order, then task ID
      if (a.workflowId !== b.workflowId) return (a.workflowId || '').localeCompare(b.workflowId || '');
      if (a.order !== b.order) return a.order - b.order;
      return (a.taskId ?? 0) - (b.taskId ?? 0);
    });

    // Compute progress percentage from completed stages
    const total = stages.length || 1;
    const completed = stages.filter((s: any) => s.status === 'complete').length;
    const active = stages.filter((s: any) => s.status === 'active').length;
    const failed = stages.filter((s: any) => s.status === 'error').length;
    const pct = Math.round(((completed + active * 0.5) / total) * 100);

    // Current stage message
    const activeStage = stages.find((s: any) => s.status === 'active');
    const lastCompleted = [...stages].reverse().find((s: any) => s.status === 'complete');
    const failedStage = stages.find((s: any) => s.status === 'error');

    let message = 'Starting up…';
    if (failedStage) {
      message = `Something went wrong during ${failedStage.label.toLowerCase()}. You can retry.`;
    } else if (activeStage) {
      message = activeStage.description || `Working on ${activeStage.label.toLowerCase()}…`;
    } else if (result.status === 'completed') {
      message = 'All done! Your post is ready.';
    } else if (lastCompleted) {
      const lcLabel = lastCompleted.label.toLowerCase();
      if (lcLabel === 'business analysis') {
        message = 'Loaded your saved business profile.';
      } else {
        message = `Finished ${lcLabel}, moving to next step…`;
      }
    }
    message = sanitizeProgressMessage(message);

    // Workflow-level timing
    const allCreatedAts = stages.filter((s: any) => s.createdAt).map((s: any) => new Date(s.createdAt).getTime());
    const allClaimedAts = stages.filter((s: any) => s.claimedAt).map((s: any) => new Date(s.claimedAt).getTime());
    const allCompletedAts = stages.filter((s: any) => s.status === 'complete' && s.updatedAt)
      .map((s: any) => new Date(s.updatedAt).getTime());

    const workflowTiming = {
      firstTaskCreatedAt: allCreatedAts.length ? new Date(Math.min(...allCreatedAts)).toISOString() : null,
      firstTaskClaimedAt: allClaimedAts.length ? new Date(Math.min(...allClaimedAts)).toISOString() : null,
      lastTaskCompletedAt: allCompletedAts.length ? new Date(Math.max(...allCompletedAts)).toISOString() : null,
      totalWorkflowTimeMs: allCreatedAts.length && allCompletedAts.length
        ? Math.max(...allCompletedAts) - Math.min(...allCreatedAts)
        : null,
      elapsedSinceFirstTaskMs: allCreatedAts.length
        ? Date.now() - Math.min(...allCreatedAts)
        : null,
    };

    // Collect all lag warnings
    const lagWarnings = stages.flatMap((s: any) =>
      (s.warnings || []).map((w: string) => ({ taskId: s.taskId, step: s.label, warning: w }))
    );

    return NextResponse.json({
      status: result.status,
      progress: Math.min(pct, result.status === 'completed' ? 100 : 95),
      message,
      stages,
      hasError: failed > 0,
      failedStep: failedStage ? { label: failedStage.label, taskId: failedStage.taskId, workflowId: failedStage.workflowId } : null,
      workflowIds,
      generationRunId,
      workflowTiming,
      lagWarnings,
      stageCount: { total, completed, active, failed },
    });
  } catch (error: any) {
    console.error('Social progress error:', error);
    return NextResponse.json({ error: 'Failed to check progress' }, { status: 500 });
  }
}
