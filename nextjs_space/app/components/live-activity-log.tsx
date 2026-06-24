'use client';

import React from 'react';
import {
  buildActivityEvents,
  formatActivityTime,
  type RawTaskForActivity,
} from '@/lib/activity-log-utils';

// Re-export for backward compat
export type { RawTaskForActivity } from '@/lib/activity-log-utils';
export { buildActivityEvents } from '@/lib/activity-log-utils';

// ── Component ────────────────────────────────────────────────────
interface LiveActivityLogProps {
  tasks: RawTaskForActivity[];
}

export default function LiveActivityLog({ tasks }: LiveActivityLogProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const events = React.useMemo(() => buildActivityEvents(tasks), [tasks]);

  // Show only latest 10 entries
  const visible = events.slice(-10);

  // Auto-scroll to newest entry
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible.length]);

  return (
    <div className="mt-4 mb-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Live activity</span>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="max-h-[160px] sm:max-h-[200px] overflow-y-auto rounded-lg bg-gray-50/80 border border-gray-100 px-3 py-2 space-y-0.5"
      >
        {visible.length === 0 ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-xs text-gray-400 italic">Preparing your workspace...</span>
          </div>
        ) : (
          visible.map(event => (
            <div key={event.id} className="flex items-start gap-2 py-0.5 animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
              <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap pt-px min-w-[60px]">
                {formatActivityTime(event.time)}
              </span>
              <span className="text-xs text-gray-600 leading-relaxed">
                {event.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
