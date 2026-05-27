export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(
  req: NextRequest,
  { params }: { params: { workflowId: string } }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const workflowId = params.workflowId;
  if (!workflowId) {
    return NextResponse.json({ error: 'Missing workflow ID' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${TOMBSTONE_URL}/tasks`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: 'Tombstone API error' }, { status: 502 });
    }

    let allTasks: any[] = await res.json();
    if (!Array.isArray(allTasks)) allTasks = [];

    const wfTasks = allTasks
      .filter((t: any) => t?.workflow_id === workflowId)
      .sort((a: any, b: any) => (a?.step_order ?? a?.id ?? 0) - (b?.step_order ?? b?.id ?? 0));

    const sanitized = wfTasks.map((t: any) => ({
      id: t.id,
      workflow_id: t.workflow_id,
      department: t.department,
      status: t.status,
      mission: t.mission,
      summary: t.summary ? String(t.summary).slice(0, 300) : null,
      claimed_by: t.claimed_by,
      created_at: t.created_at,
      heartbeat_at: t.heartbeat_at,
      last_error: t.last_error ? String(t.last_error).slice(0, 300) : null,
      retry_count: t.retry_count,
      max_retries: t.max_retries,
      step_order: t.step_order,
      depends_on_task_id: t.depends_on_task_id,
      input_from_task_id: t.input_from_task_id,
      worker_instance_id: t.worker_instance_id,
    }));

    return NextResponse.json({
      workflowId,
      tasks: sanitized,
      total: sanitized.length,
      mission: sanitized[0]?.mission || null,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Tombstone API timeout' }, { status: 504 });
    }
    console.error('[admin/tasks/workflow] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to fetch workflow tasks' }, { status: 502 });
  }
}
