export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const taskId = params.id;
  if (!taskId || isNaN(Number(taskId))) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    // Fetch task detail and outputs in parallel
    const [taskRes, outputsRes] = await Promise.all([
      fetch(`${TOMBSTONE_URL}/tasks/${taskId}`, {
        cache: 'no-store',
        signal: controller.signal,
      }),
      fetch(`${TOMBSTONE_URL}/tasks/${taskId}/outputs`, {
        cache: 'no-store',
        signal: controller.signal,
      }),
    ]);
    clearTimeout(timer);

    if (!taskRes.ok) {
      return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 });
    }

    const task = await taskRes.json();
    let outputs: any[] = [];
    try {
      outputs = await outputsRes.json();
      if (!Array.isArray(outputs)) outputs = [];
    } catch {
      outputs = [];
    }

    // Sanitize — never expose claim_token value
    const sanitizedTask = {
      id: task.id,
      workflow_id: task.workflow_id,
      department: task.department,
      status: task.status,
      mission: task.mission,
      summary: task.summary,
      execution_notes: task.execution_notes,
      claimed_by: task.claimed_by,
      worker_instance_id: task.worker_instance_id,
      claim_token_present: !!task.claim_token,
      created_at: task.created_at,
      claimed_at: task.claimed_at,
      heartbeat_at: task.heartbeat_at,
      last_attempt_at: task.last_attempt_at,
      timeout_at: task.timeout_at,
      updated_at: task.updated_at,
      retry_count: task.retry_count,
      max_retries: task.max_retries,
      last_error: task.last_error,
      depends_on_task_id: task.depends_on_task_id,
      input_from_task_id: task.input_from_task_id,
      step_order: task.step_order,
      execution_mode: task.execution_mode,
      blocked_reason: task.blocked_reason,
    };

    const sanitizedOutputs = outputs.map((o: any) => ({
      id: o.id,
      task_id: o.task_id,
      agent: o.agent,
      created_at: o.created_at,
      output: o.output,
    }));

    return NextResponse.json({ task: sanitizedTask, outputs: sanitizedOutputs });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Tombstone API timeout' }, { status: 504 });
    }
    console.error('[admin/tasks/[id]] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to fetch task detail' }, { status: 502 });
  }
}
