export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    // Fetch both /agents/status (for running/status) and /metrics/agents (for heartbeat freshness)
    const [statusRes, metricsRes] = await Promise.all([
      fetch(`${TOMBSTONE_URL}/agents/status`, { cache: 'no-store', signal: controller.signal }),
      fetch(`${TOMBSTONE_URL}/metrics/agents`, { cache: 'no-store', signal: controller.signal }).catch(() => null),
    ]);
    clearTimeout(timer);

    if (!statusRes.ok) {
      return NextResponse.json({ error: 'Tombstone API error', status: statusRes.status }, { status: 502 });
    }

    const agents = await statusRes.json();

    // Merge heartbeat freshness data from /metrics/agents
    let metricsData: any = null;
    if (metricsRes && metricsRes.ok) {
      metricsData = await metricsRes.json();
    }

    // Build lookup: agent_name -> best (lowest) seconds_since_heartbeat across instances
    const heartbeatMap: Record<string, { seconds: number; service_name: string; instance_id: string }> = {};
    if (metricsData?.agents) {
      for (const m of metricsData.agents) {
        const key = m.agent_name;
        const secs = m.seconds_since_heartbeat ?? 9999;
        if (!heartbeatMap[key] || secs < heartbeatMap[key].seconds) {
          heartbeatMap[key] = { seconds: secs, service_name: m.service_name, instance_id: m.instance_id };
        }
      }
    }

    // Enrich agents with heartbeat freshness
    const enriched = (Array.isArray(agents) ? agents : []).map((a: any) => ({
      ...a,
      seconds_since_heartbeat: heartbeatMap[a.name]?.seconds ?? null,
      service_name: heartbeatMap[a.name]?.service_name ?? null,
      instance_id: heartbeatMap[a.name]?.instance_id ?? null,
    }));

    return NextResponse.json({
      agents: enriched,
      fetchedAt: new Date().toISOString(),
      stale_count: metricsData?.stale_count ?? null,
      total_agents: metricsData?.count ?? null,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Tombstone API timeout', agents: [] }, { status: 504 });
    }
    console.error('[admin/agents] Tombstone proxy error:', err?.message);
    return NextResponse.json({ error: 'Failed to reach Tombstone API', agents: [] }, { status: 502 });
  }
}
