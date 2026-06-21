export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL || 'https://tombstone-api-xjc4.onrender.com';

/**
 * GET /api/workflow-progress?workflowId=...
 *
 * Proxies to Tombstone GET /workflows/{id}/progress
 * Returns progressive mission visibility data:
 *   - timeline stages with status/agent/elapsed
 *   - available artifacts
 *   - customer-safe activity messages
 *   - operator diagnostics (filtered by role on frontend)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(
        `${TOMBSTONE_URL}/workflows/${encodeURIComponent(workflowId)}/progress`,
        { cache: 'no-store', signal: controller.signal }
      );

      if (!res.ok) {
        // Fallback: if endpoint doesn't exist yet (404), return empty progress
        if (res.status === 404) {
          return NextResponse.json({
            status: 'not_found',
            workflow_id: workflowId,
            activity_message: 'Preparing...',
            timeline: [],
            available_artifacts: [],
            still_working: [],
            completed_count: 0,
            total_count: 0,
            events: [],
            operator_diagnostics: [],
          });
        }
        const errText = await res.text().catch(() => 'Unknown error');
        console.error(`[workflow-progress] Tombstone returned ${res.status}: ${errText}`);
        return NextResponse.json({ error: 'Progress fetch failed' }, { status: 502 });
      }

      const data = await res.json();
      return NextResponse.json(data);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout fetching progress' }, { status: 504 });
    }
    console.error('[workflow-progress] Error:', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
