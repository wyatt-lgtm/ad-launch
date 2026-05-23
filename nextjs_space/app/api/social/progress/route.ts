export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getMultiWorkflowStatus } from '@/lib/tombstone';

/**
 * GET /api/social/progress?workflowIds=id1,id2,...
 *
 * Returns real-time stage progress for active Tombstone workflows.
 * Used by the GenerationProgress component to show task-level status.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workflowIdsParam = req.nextUrl.searchParams.get('workflowIds');
    if (!workflowIdsParam) {
      return NextResponse.json({ error: 'workflowIds parameter required' }, { status: 400 });
    }

    const workflowIds = workflowIdsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (workflowIds.length === 0) {
      return NextResponse.json({ error: 'No valid workflow IDs' }, { status: 400 });
    }

    const result = await getMultiWorkflowStatus(workflowIds);

    // Map tasks to user-friendly stage data (never expose raw IDs or logs)
    const stages = (result.tasks || []).map((t: any) => ({
      label: t.label || 'Processing',
      description: t.description || '',
      status: t.status, // 'waiting' | 'active' | 'complete' | 'error'
    }));

    // Compute progress percentage from completed stages
    const total = stages.length || 1;
    const completed = stages.filter((s: any) => s.status === 'complete').length;
    const active = stages.filter((s: any) => s.status === 'active').length;
    const failed = stages.filter((s: any) => s.status === 'error').length;
    const pct = Math.round(((completed + active * 0.5) / total) * 100);

    // Determine current stage message
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
      message = `Finished ${lastCompleted.label.toLowerCase()}, moving to next step…`;
    }

    return NextResponse.json({
      status: result.status, // 'processing' | 'generating' | 'completed' | 'error'
      progress: Math.min(pct, result.status === 'completed' ? 100 : 95),
      message,
      stages,
      hasError: failed > 0,
    });
  } catch (error: any) {
    console.error('Social progress error:', error);
    return NextResponse.json({ error: 'Failed to check progress' }, { status: 500 });
  }
}
