export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status') || ''; // comma-separated
  const search = url.searchParams.get('search')?.trim() || '';
  const hoursBack = parseInt(url.searchParams.get('hours') || '24');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${TOMBSTONE_URL}/tasks`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: 'Tombstone API error', status: res.status }, { status: 502 });
    }

    let tasks: any[] = await res.json();
    if (!Array.isArray(tasks)) tasks = [];

    // Filter by recency
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);
    tasks = tasks.filter((t: any) => {
      const updated = t?.updated_at || t?.created_at || t?.heartbeat_at;
      if (!updated) return true; // keep tasks with no timestamp
      return new Date(updated) >= cutoff;
    });

    // Filter by status
    if (statusFilter) {
      const allowed = new Set(statusFilter.split(',').map(s => s.trim().toLowerCase()));
      tasks = tasks.filter((t: any) => {
        const s = (t?.status || '').toLowerCase();
        return allowed.has(s);
      });
    }

    // Search by mission/department/claimed_by
    if (search) {
      const q = search.toLowerCase();
      tasks = tasks.filter((t: any) =>
        (t?.mission || '').toLowerCase().includes(q) ||
        (t?.department || '').toLowerCase().includes(q) ||
        (t?.claimed_by || '').toLowerCase().includes(q) ||
        String(t?.id || '').includes(q) ||
        (t?.workflow_id || '').toLowerCase().includes(q)
      );
    }

    // Sort: active first, then by id desc
    const statusPriority: Record<string, number> = {
      'in progress': 0, 'in_progress': 0, 'running': 0, 'claimed': 0,
      'ready for pickup': 1,
      'blocked': 2,
      'failed': 3, 'error': 3,
      'complete': 4, 'completed': 4,
    };
    tasks.sort((a: any, b: any) => {
      const pa = statusPriority[(a?.status || '').toLowerCase()] ?? 5;
      const pb = statusPriority[(b?.status || '').toLowerCase()] ?? 5;
      if (pa !== pb) return pa - pb;
      return (b?.id || 0) - (a?.id || 0);
    });

    // Limit response size
    const limited = tasks.slice(0, 200);

    // Sanitize — only return safe fields
    const sanitized = limited.map((t: any) => ({
      id: t?.id,
      workflow_id: t?.workflow_id,
      mission: t?.mission ? String(t.mission).slice(0, 200) : null,
      department: t?.department,
      status: t?.status,
      summary: t?.summary ? String(t.summary).slice(0, 300) : null,
      claimed_by: t?.claimed_by,
      worker_instance_id: t?.worker_instance_id,
      heartbeat_at: t?.heartbeat_at,
      created_at: t?.created_at,
      updated_at: t?.updated_at,
      last_error: t?.last_error ? String(t.last_error).slice(0, 300) : null,
      retry_count: t?.retry_count,
      max_retries: t?.max_retries,
    }));

    return NextResponse.json({
      tasks: sanitized,
      total: sanitized.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Tombstone API timeout', tasks: [] }, { status: 504 });
    }
    console.error('[admin/tasks] Tombstone proxy error:', err?.message);
    return NextResponse.json({ error: 'Failed to reach Tombstone API', tasks: [] }, { status: 502 });
  }
}
