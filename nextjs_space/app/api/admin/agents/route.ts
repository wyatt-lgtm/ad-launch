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
  { name: 'Asset Scout', display_name: 'Asset Scout', department: 'Asset Retrieval' },
  { name: 'Clara Barton', display_name: 'Clara Barton', department: 'SEO Audit' },
  { name: 'Rand Fishkin', display_name: 'Rand Fishkin', department: 'Keyword Strategy' },
  { name: 'Gutenberg', display_name: 'Gutenberg', department: 'Site Publishing' },
];

// App-level services are NOT Tombstone worker agents. Clark Kent is the Launch OS
// Social Scout feature (local news + interest-feed + event discovery); the work it
// triggers is owned by Jim Bridger + the social-lane pipeline. It does not claim
// tasks or emit heartbeats, so it is surfaced as a typed "app_service" card.
const APP_SERVICES = [
  {
    name: 'Clark Kent',
    display_name: 'Clark Kent',
    kind: 'app_service',
    status_source: 'Launch OS Social Scout',
    department: 'Social Scout / Launch OS',
    role: 'Local news, interest-feed, and event discovery',
    worker_type: 'App-level service',
    backend_agent: null,
  },
];

function fallbackRoster(error: string) {
  return NextResponse.json({
    agents: [
      ...KNOWN_AGENTS.map(a => ({
        ...a,
        status: 'unreachable',
        running: false,
        last_seen: null,
        current_task_id: null,
        seconds_since_heartbeat: null,
        service_name: null,
        instance_id: null,
      })),
      // App services are not affected by Tombstone reachability — always app_service.
      ...APP_SERVICES.map(s => ({
        ...s,
        status: 'app_service',
        running: false,
        last_seen: null,
        current_task_id: null,
        seconds_since_heartbeat: null,
        service_name: null,
        instance_id: null,
      })),
    ],
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
    // Also track whether any instance is busy (has a current task)
    const ALIVE_THRESHOLD = 45; // seconds — must match Tombstone HEARTBEAT_ALIVE_THRESHOLD_SECONDS
    const STALE_THRESHOLD = 90;
    const heartbeatMap: Record<string, { seconds: number; service_name: string; instance_id: string; isBusy: boolean }> = {};
    if (metricsData?.agents) {
      for (const m of metricsData.agents) {
        const key = m.agent_name;
        const secs = m.seconds_since_heartbeat ?? 9999;
        const busy = m.status === 'busy' || !!m.current_task_id;
        const existing = heartbeatMap[key];
        if (!existing || secs < existing.seconds) {
          heartbeatMap[key] = { seconds: secs, service_name: m.service_name, instance_id: m.instance_id, isBusy: busy || (existing?.isBusy ?? false) };
        } else if (busy && !existing.isBusy) {
          // Another instance is busy — mark as busy even if not the freshest
          existing.isBusy = true;
        }
      }
    }

    // Enrich agents with heartbeat freshness AND re-derive status from metrics
    // This fixes the bug where /agents/status picks the wrong replica row
    // (e.g. stale singleton) while /metrics/agents shows a fresh dedicated worker.
    const enriched = (Array.isArray(agents) ? agents : []).map((a: any) => {
      const hb = heartbeatMap[a.name];
      let correctedStatus = a.status;
      if (hb && hb.seconds !== null) {
        if (hb.seconds <= ALIVE_THRESHOLD) {
          correctedStatus = hb.isBusy ? 'alive_busy' : 'alive_idle';
        } else if (hb.seconds <= STALE_THRESHOLD) {
          correctedStatus = 'stale';
        } else {
          correctedStatus = 'offline';
        }
      }
      return {
        ...a,
        status: correctedStatus,
        running: correctedStatus === 'alive_idle' || correctedStatus === 'alive_busy',
        seconds_since_heartbeat: hb?.seconds ?? null,
        service_name: hb?.service_name ?? null,
        instance_id: hb?.instance_id ?? null,
      };
    });

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
