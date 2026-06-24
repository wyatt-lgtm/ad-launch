/**
 * Tests for LiveActivityLog event builder and sanitization.
 *
 * Verifies:
 *  1. Task rows convert to customer-safe activity entries.
 *  2. Agent names are NOT included.
 *  3. Worker names/IDs are NOT included.
 *  4. Workflow IDs and command IDs are NOT included.
 *  5. Timestamps render in local readable format.
 *  6. Completed tasks show as completed; active tasks as started/working.
 *  7. Deduplication by task_id + event_type.
 *  8. No secrets leak.
 *  9. Empty task list produces no events ("Preparing your workspace..." handled by component).
 * 10. Retry logic produces "is retrying" message.
 */

import {
  buildActivityEvents,
  RawTaskForActivity,
} from '@/lib/activity-log-utils';

// ── Helper ──────────────────────────────────────────────────────────────
function makeTask(overrides: Partial<RawTaskForActivity> & { id: number }): RawTaskForActivity {
  return {
    department: 'Marketing',
    status: 'waiting',
    rawStatus: 'waiting',
    created_at: null,
    claimed_at: null,
    heartbeat_at: null,
    updated_at: null,
    retry_count: 0,
    ...overrides,
  };
}

// ── Test 1: Basic started + completed events ────────────────────────────
describe('buildActivityEvents', () => {
  it('produces started and completed events for a complete task', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 2521,
        department: 'Marketing',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    expect(events.length).toBe(2);
    expect(events[0].message).toBe('Marketing started Task #2521');
    expect(events[1].message).toBe('Marketing completed Task #2521');
  });

  // ── Test 2: Agent names never appear ──────────────────────────────────
  it('does not include agent names in events', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 100,
        department: 'Creative Strategy',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    const allText = events.map(e => e.message).join(' ');
    expect(allText).not.toContain('Andy Warhol');
    expect(allText).not.toContain('Don Draper');
    expect(allText).not.toContain('Zig Ziglar');
    expect(allText).not.toContain('Claude Hopkins');
    expect(allText).not.toContain('David Ogilvy');
    expect(allText).not.toContain('Jim Bridger');
  });

  // ── Test 3: Worker names/IDs never appear ────────────────────────────
  it('does not include worker instance IDs', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 101,
        department: 'Render Production',
        status: 'active',
        rawStatus: 'in_progress',
        claimed_at: '2025-06-23T04:45:00Z',
        heartbeat_at: '2025-06-23T04:45:30Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    const allText = events.map(e => e.message).join(' ');
    expect(allText).not.toMatch(/worker[-_]?\d+/i);
  });

  // ── Test 4: No workflow IDs or command IDs ────────────────────────────
  it('does not include workflow IDs or UUIDs in messages', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 102,
        department: 'Marketing',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    const allText = events.map(e => e.message).join(' ');
    expect(allText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  // ── Test 5: Timestamps are Date objects ────────────────────────────────
  it('event times are valid Date objects', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 103,
        department: 'Research',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    for (const e of events) {
      expect(e.time).toBeInstanceOf(Date);
      expect(e.time.getTime()).not.toBeNaN();
    }
  });

  // ── Test 6: Active task shows "started" / "is working on" ──────────────
  it('active task shows started and optionally working', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 104,
        department: 'Creative Direction',
        status: 'active',
        rawStatus: 'in_progress',
        claimed_at: '2025-06-23T04:47:00Z',
        heartbeat_at: '2025-06-23T04:47:30Z', // 30s after claim
      }),
    ];
    const events = buildActivityEvents(tasks);
    expect(events.some(e => e.message.includes('started'))).toBe(true);
    expect(events.some(e => e.message.includes('is working on'))).toBe(true);
    expect(events.some(e => e.message.includes('completed'))).toBe(false);
  });

  // ── Test 7: Deduplication by task_id + event_type ──────────────────────
  it('deduplicates events by id', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 105,
        department: 'Marketing',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
      // Duplicate entry (same task appearing again)
      makeTask({
        id: 105,
        department: 'Marketing',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:46:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    const startedEvents = events.filter(e => e.id === '105-started');
    const completedEvents = events.filter(e => e.id === '105-completed');
    expect(startedEvents.length).toBe(1);
    expect(completedEvents.length).toBe(1);
  });

  // ── Test 8: No secrets leak ───────────────────────────────────────────
  it('messages contain no API keys, fingerprints, or HTTP routes', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 106,
        department: 'Render Production',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: '2025-06-23T04:45:00Z',
        updated_at: '2025-06-23T04:50:00Z',
      }),
    ];
    const events = buildActivityEvents(tasks);
    const allText = events.map(e => e.message).join(' ');
    expect(allText).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(allText).not.toContain('sha256:');
    expect(allText).not.toContain('/api/');
    expect(allText).not.toMatch(/req_[A-Za-z0-9]+/);
  });

  // ── Test 9: Empty task list produces no events ─────────────────────────
  it('empty task list produces no events', () => {
    const events = buildActivityEvents([]);
    expect(events.length).toBe(0);
  });

  // ── Test 10: Failed task with retry shows "is retrying" ────────────────
  it('failed task with retry shows retrying message', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 107,
        department: 'Render Production',
        status: 'error',
        rawStatus: 'failed',
        claimed_at: '2025-06-23T04:48:00Z',
        updated_at: '2025-06-23T04:49:00Z',
        retry_count: 1,
      }),
    ];
    const events = buildActivityEvents(tasks);
    expect(events.some(e => e.message.includes('is retrying'))).toBe(true);
  });

  // ── Test 11: Failed task with no retry shows "needs attention" ─────────
  it('failed task with no retry shows needs attention', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({
        id: 108,
        department: 'Creative Strategy',
        status: 'error',
        rawStatus: 'failed',
        claimed_at: '2025-06-23T04:48:00Z',
        updated_at: '2025-06-23T04:49:00Z',
        retry_count: 0,
      }),
    ];
    const events = buildActivityEvents(tasks);
    expect(events.some(e => e.message.includes('needs attention'))).toBe(true);
  });

  // ── Test 12: Department label mapping is customer-safe ─────────────────
  it('maps raw department to customer-safe label', () => {
    const departments = [
      { raw: 'Research', expected: 'Research' },
      { raw: 'Marketing', expected: 'Marketing' },
      { raw: 'Creative Strategy', expected: 'Creative Strategy' },
      { raw: 'Creative Direction', expected: 'Creative Direction' },
      { raw: 'Render Production', expected: 'Render Production' },
      { raw: 'Conversion Assembly', expected: 'Post Assembly' },
      { raw: 'UnknownDept', expected: 'Operations' },
    ];
    for (const { raw, expected } of departments) {
      const tasks: RawTaskForActivity[] = [
        makeTask({ id: 200, department: raw, status: 'complete', rawStatus: 'complete', claimed_at: '2025-06-23T04:45:00Z', updated_at: '2025-06-23T04:46:00Z' }),
      ];
      const events = buildActivityEvents(tasks);
      expect(events[0].message).toContain(expected);
    }
  });

  // ── Test 13: Events sorted ascending by timestamp ──────────────────────
  it('sorts events ascending by timestamp', () => {
    const tasks: RawTaskForActivity[] = [
      makeTask({ id: 302, department: 'Creative Direction', status: 'complete', rawStatus: 'complete', claimed_at: '2025-06-23T04:47:00Z', updated_at: '2025-06-23T04:48:00Z' }),
      makeTask({ id: 301, department: 'Marketing', status: 'complete', rawStatus: 'complete', claimed_at: '2025-06-23T04:45:00Z', updated_at: '2025-06-23T04:46:00Z' }),
    ];
    const events = buildActivityEvents(tasks);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].sortKey).toBeGreaterThanOrEqual(events[i - 1].sortKey);
    }
  });

  // ── Test 14: Only latest 10 would be shown (builder returns all, component slices) ──
  it('returns all events (component responsible for slicing to 10)', () => {
    const tasks: RawTaskForActivity[] = Array.from({ length: 15 }, (_, i) =>
      makeTask({
        id: 400 + i,
        department: 'Marketing',
        status: 'complete',
        rawStatus: 'complete',
        claimed_at: `2025-06-23T04:${String(i).padStart(2, '0')}:00Z`,
        updated_at: `2025-06-23T04:${String(i).padStart(2, '0')}:30Z`,
      }),
    );
    const events = buildActivityEvents(tasks);
    // 15 tasks × 2 events each = 30 events (builder returns all)
    expect(events.length).toBe(30);
  });
});
