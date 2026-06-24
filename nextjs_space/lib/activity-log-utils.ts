/**
 * Pure utility functions for building customer-safe live activity events
 * from raw Tombstone task data.
 *
 * No React / JSX — safe to import from tests and components.
 */

// ── Customer-safe department label mapping ────────────────────────
// Maps raw Tombstone department names to customer-friendly labels.
// Any department not listed here falls back to "Operations".
const SAFE_DEPARTMENT_LABELS: Record<string, string> = {
  'research': 'Research',
  'marketing': 'Marketing',
  'creative strategy': 'Creative Strategy',
  'creative direction': 'Creative Direction',
  'creative review': 'Creative Review',
  'render production': 'Render Production',
  'conversion assembly': 'Post Assembly',
  'operations': 'Operations',
  'strategy & intelligence': 'Strategy & Intelligence',
  'code execution': 'Development',
  'asset retrieval': 'Asset Retrieval',
};

export function safeDepartmentLabel(rawDepartment: string | null | undefined): string {
  const key = (rawDepartment ?? '').toLowerCase().trim();
  return SAFE_DEPARTMENT_LABELS[key] ?? 'Operations';
}

// ── Activity event types ──────────────────────────────────────────
export interface ActivityEvent {
  id: string;       // dedup key
  time: Date;
  message: string;
  sortKey: number;   // for stable ordering
}

export interface RawTaskForActivity {
  id?: number;
  department?: string;
  status?: string;
  rawStatus?: string;
  created_at?: string | null;
  claimed_at?: string | null;
  heartbeat_at?: string | null;
  updated_at?: string | null;
  retry_count?: number;
}

// ── Sanitization: strip anything that should never reach the UI ───
const FORBIDDEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,          // OpenAI keys
  /[0-9a-f]{8}-[0-9a-f]{4}-/i,      // UUIDs
  /\b\d{1,3}(\.\d{1,3}){3}\b/,      // IP addresses
  /\/api\//,                         // HTTP routes
  /req_[A-Za-z0-9]+/,               // OpenAI request IDs
  /sha256:/,                         // key fingerprints
  /worker[-_]?\d+/i,                 // worker instance IDs
  /Traceback|Error:|Exception/i,     // stack traces
];

function isSanitized(text: string): boolean {
  return !FORBIDDEN_PATTERNS.some(p => p.test(text));
}

// ── Build activity events from raw task data ──────────────────────
export function buildActivityEvents(tasks: RawTaskForActivity[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const task of tasks) {
    const dept = safeDepartmentLabel(task.department);
    const taskId = task.id;
    const taskLabel = taskId ? `Task #${taskId}` : 'a task';
    const status = (task.rawStatus ?? task.status ?? '').toLowerCase();
    const retryCount = task.retry_count ?? 0;

    const hasClaimed = !!task.claimed_at;

    // Event: task started (claimed)
    if (task.claimed_at) {
      const t = new Date(task.claimed_at);
      const msg = `${dept} started ${taskLabel}`;
      if (isSanitized(msg)) {
        events.push({
          id: `${taskId}-started`,
          time: t,
          message: msg,
          sortKey: t.getTime(),
        });
      }
    }

    // Event: task completed
    if (status === 'complete' || status === 'completed') {
      const completedTime = task.updated_at ?? task.heartbeat_at ?? task.claimed_at;
      if (completedTime) {
        const t = new Date(completedTime);
        const msg = `${dept} completed ${taskLabel}`;
        if (isSanitized(msg)) {
          events.push({
            id: `${taskId}-completed`,
            time: t,
            message: msg,
            sortKey: t.getTime() + 1, // ensure completed sorts after started
          });
        }
      }
    }
    // Event: task is actively being worked on (heartbeat update, not yet complete)
    else if (hasClaimed && task.heartbeat_at && (status === 'in progress' || status === 'in_progress' || status === 'running' || status === 'claimed' || status === 'active')) {
      const hbTime = new Date(task.heartbeat_at);
      const claimedTime = task.claimed_at ? new Date(task.claimed_at) : null;
      // Only show "working on" if heartbeat is meaningfully after claimed_at (>5s)
      if (claimedTime && (hbTime.getTime() - claimedTime.getTime()) > 5000) {
        const msg = `${dept} is working on ${taskLabel}`;
        if (isSanitized(msg)) {
          events.push({
            id: `${taskId}-working`,
            time: hbTime,
            message: msg,
            sortKey: hbTime.getTime(),
          });
        }
      }
    }
    // Event: task failed with retry
    else if (status === 'failed' || status === 'error') {
      const failTime = task.updated_at ?? task.heartbeat_at ?? task.claimed_at;
      if (failTime) {
        const t = new Date(failTime);
        const msg = retryCount > 0
          ? `${dept} is retrying ${taskLabel}`
          : `${dept} needs attention on ${taskLabel}`;
        if (isSanitized(msg)) {
          events.push({
            id: `${taskId}-failed`,
            time: t,
            message: msg,
            sortKey: t.getTime(),
          });
        }
      }
    }
  }

  // Sort ascending by time, then deduplicate by id
  events.sort((a, b) => a.sortKey - b.sortKey);
  const seen = new Set<string>();
  const deduped: ActivityEvent[] = [];
  for (const e of events) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      deduped.push(e);
    }
  }

  return deduped;
}

// ── Format time as local readable (e.g. "10:45 PM") ──────────────
export function formatActivityTime(date: Date): string {
  try {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}
