export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

// Known agent roster — returned with "unreachable" status when API is down
const KNOWN_AGENTS = [
  { name: 'Wyatt Earp', display_name: 'Wyatt Earp', department: 'Operations' },
  { name: 'Dispatcher', display_name: 'Dispatcher', department: 'Operations' },
  { name: 'Watchdog', display_name: 'Watchdog', department: 'Operations' },
  { name: 'Zig Ziglar', display_name: 'Zig Ziglar', department: 'Marketing' },
  { name: 'David Ogilvy', display_name: 'David Ogilvy', department: 'Creative Strategy' },
  { name: 'Don Draper', display_name: 'Don Draper', department: 'Creative Direction' },
  { name: 'Andy Warhol', display_name: 'Andy Warhol', department: 'Render Production' },
  { name: 'George Boole', display_name: 'George Boole', department: 'Code Execution' },
  { name: 'Ada Lovelace', display_name: 'Ada Lovelace', department: 'Development' },
  { name: 'Peter Drucker', display_name: 'Peter Drucker', department: 'Strategy & Intelligence' },
  { name: 'Tom Hopkins', display_name: 'Tom Hopkins', department: 'Sales Coaching' },
  { name: 'Operations Worker', display_name: 'Operations Worker', department: 'Operations' },
  { name: 'Jim Bridger', display_name: 'Jim Bridger', department: 'Research' },
  { name: 'Bat Masterson', display_name: 'Bat Masterson', department: 'Creative Review' },
  { name: 'Creative Synthesizer', display_name: 'Creative Synthesizer', department: 'Creative Synthesis' },
  { name: 'Creative War Room', display_name: 'Creative War Room', department: 'Creative Prompt Engineering' },
  { name: 'Clark Kent', display_name: 'Clark Kent', department: 'Research' },
  { name: 'Asset Scout', display_name: 'Asset Scout', department: 'Asset Retrieval' },
  { name: 'Clara Barton', display_name: 'Clara Barton', department: 'SEO Audit' },
  { name: 'Rand Fishkin', display_name: 'Rand Fishkin', department: 'Keyword Strategy' },
  { name: 'Gutenberg', display_name: 'Gutenberg', department: 'Site Publishing' },
];

function fallbackRoster(error: string) {
  return NextResponse.json({
    agents: KNOWN_AGENTS.map(a => ({
      ...a,
      status: 'unreachable',
      running: false,
      last_seen: null,
      current_task_id: null,
      seconds_since_heartbeat: null,
      service_name: null,
      instance_id: null,
    })),
    fetchedAt: new Date().toISOString(),
    error,
    api_unreachable: true,
  });
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    // Fetch both /agents/status (for running/status) and /metrics/agents (for heartbeat freshness)
    const [statusRes, metricsRes] = await Promise.all([
      fetch(`${TOMBSTONE_URL}/agents/status`, { cache: 'no-store', signal: controller.signal }),
      fetch(`${TOMBSTONE_URL}/metrics/agents`, { cache: 'no-store', signal: controller.signal }).catch(() => null),
    ]);
    clearTimeout(timer);

    if (!statusRes.ok) {
      return fallbackRoster(`Tombstone API returned ${statusRes.status}`);
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
      console.warn('[admin/agents] Tombstone API timeout (15s)');
      return fallbackRoster('Tombstone API timeout — backend may be cold-starting');
    }
    console.error('[admin/agents] Tombstone proxy error:', err?.message);
    return fallbackRoster('Failed to reach Tombstone API');
  }
}
