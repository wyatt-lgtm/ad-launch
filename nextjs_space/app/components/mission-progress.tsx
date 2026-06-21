'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2, Circle, Loader2, AlertCircle, Clock, Sparkles,
  FileText, Palette, Image as ImageIcon, Code, Shield, Search,
  LayoutDashboard, ChevronDown, ChevronUp, Eye, EyeOff,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface TimelineStage {
  stage: string;
  department: string;
  status: 'completed' | 'active' | 'queued' | 'pending' | 'error';
  agent: string;
  task_id: number;
  elapsed_ms: number | null;
  artifact: { type: string; label: string; task_id: number } | null;
  error: string | null;
  blocked_reason: string | null;
}

interface ArtifactItem {
  type: string;
  label: string;
  task_id: number;
}

interface StillWorkingItem {
  label: string;
  status: string;
}

interface ProgressEvent {
  message: string;
  event_type: string;
  agent: string | null;
  created_at: string;
  artifact_type: string | null;
}

interface OperatorDiag {
  task_id: number;
  department: string;
  agent: string | null;
  status: string;
  retry_count: number;
  last_error: string | null;
  blocked_reason: string | null;
  heartbeat_at: string | null;
  claimed_at: string | null;
  warning: string | null;
}

interface ProgressData {
  status: string;
  workflow_id: string;
  activity_message: string;
  timeline: TimelineStage[];
  available_artifacts: ArtifactItem[];
  still_working: StillWorkingItem[];
  completed_count: number;
  total_count: number;
  events: ProgressEvent[];
  operator_diagnostics: OperatorDiag[];
}

interface MissionProgressProps {
  workflowId: string | null;
  isAdmin?: boolean;
  onArtifactClick?: (artifact: ArtifactItem) => void;
}

// ── Icons per stage ──────────────────────────────────────────────────────────

const STAGE_ICONS: Record<string, typeof Search> = {
  Researching: Search,
  Strategy: LayoutDashboard,
  Copy: FileText,
  Creative: Palette,
  Assets: ImageIcon,
  Rendering: ImageIcon,
  Assembly: Code,
  QA: Shield,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(ms: number | null): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function StageStatusIcon({ status }: { status: TimelineStage['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
    case 'active':
      return <Loader2 className="w-4 h-4 text-violet-500 animate-spin flex-shrink-0" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
    case 'queued':
      return <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />;
    default:
      return <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />;
  }
}

// ── Activity Ribbon ──────────────────────────────────────────────────────────

function ActivityRibbon({ message, pct }: { message: string; pct: number }) {
  return (
    <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 rounded-t-xl">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 flex-shrink-0 animate-pulse" />
        <span className="text-sm font-medium truncate">{message}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-24 h-1.5 bg-white/25 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-semibold tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function MissionTimeline({ stages }: { stages: TimelineStage[] }) {
  return (
    <div className="px-5 py-4">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Mission Timeline</h4>
      <div className="relative">
        {/* Connecting line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200" />
        <div className="space-y-1">
          {stages.map((stage, i) => {
            const Icon = STAGE_ICONS[stage.stage] || Circle;
            const elapsed = formatElapsed(stage.elapsed_ms);
            return (
              <div key={i} className="relative flex items-center gap-3 py-1.5 pl-6">
                {/* Status dot on the line */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <StageStatusIcon status={stage.status} />
                </div>
                <Icon className={`w-4 h-4 flex-shrink-0 ${
                  stage.status === 'completed' ? 'text-green-600' :
                  stage.status === 'active' ? 'text-violet-600' :
                  stage.status === 'error' ? 'text-red-500' :
                  'text-gray-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${
                      stage.status === 'completed' ? 'text-green-700' :
                      stage.status === 'active' ? 'text-violet-700' :
                      stage.status === 'error' ? 'text-red-600' :
                      'text-gray-400'
                    }`}>
                      {stage.stage}
                    </span>
                    {stage.agent && stage.status !== 'pending' && (
                      <span className="text-xs text-gray-400">{stage.agent}</span>
                    )}
                  </div>
                  {stage.error && (
                    <p className="text-xs text-red-400 truncate mt-0.5">{stage.error}</p>
                  )}
                </div>
                {elapsed && (
                  <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{elapsed}</span>
                )}
                {stage.artifact && stage.status === 'completed' && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                    ✓ Ready
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Artifact Cards ───────────────────────────────────────────────────────────

const ARTIFACT_ICONS: Record<string, typeof Search> = {
  business_research: Search,
  strategy_brief: LayoutDashboard,
  copy_deck: FileText,
  image_direction: Palette,
  rendered_images: ImageIcon,
  website_preview: Code,
  qa_report: Shield,
};

function ArtifactCards({
  available,
  stillWorking,
  onArtifactClick,
}: {
  available: ArtifactItem[];
  stillWorking: StillWorkingItem[];
  onArtifactClick?: (a: ArtifactItem) => void;
}) {
  if (available.length === 0 && stillWorking.length === 0) return null;

  return (
    <div className="px-5 py-4 border-t border-gray-100">
      {available.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Available Now
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {available.map((a, i) => {
              const Icon = ARTIFACT_ICONS[a.type] || FileText;
              return (
                <button
                  key={i}
                  onClick={() => onArtifactClick?.(a)}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 hover:bg-green-100 border border-green-200 transition-colors text-left group"
                >
                  <Icon className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-green-800 truncate">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {stillWorking.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Still Working
          </h4>
          <div className="flex flex-wrap gap-2">
            {stillWorking.map((item, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Operator Diagnostics ─────────────────────────────────────────────────────

function OperatorDiagnostics({ diags }: { diags: OperatorDiag[] }) {
  const [open, setOpen] = useState(false);
  if (diags.length === 0) return null;

  return (
    <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700 transition-colors w-full"
      >
        {open ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        Operator Diagnostics
        {open ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-200">
                <th className="py-1 pr-3">ID</th>
                <th className="py-1 pr-3">Dept</th>
                <th className="py-1 pr-3">Agent</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Retries</th>
                <th className="py-1">Error</th>
              </tr>
            </thead>
            <tbody>
              {diags.map((d) => (
                <tr key={d.task_id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3 text-gray-600 font-mono">{d.task_id}</td>
                  <td className="py-1.5 pr-3 text-gray-600">{d.department}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{d.agent || '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      d.status === 'Complete' ? 'bg-green-100 text-green-700' :
                      d.status === 'In Progress' ? 'bg-violet-100 text-violet-700' :
                      d.status === 'Failed' ? 'bg-red-100 text-red-700' :
                      d.status === 'Blocked' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-gray-500">{d.retry_count}</td>
                  <td className="py-1.5 truncate max-w-[200px]">
                    {d.last_error && <span className="text-red-400">{d.last_error}</span>}
                    {!d.last_error && d.warning && <span className="text-amber-500">{d.warning}</span>}
                    {!d.last_error && !d.warning && <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MissionProgress({
  workflowId,
  isAdmin = false,
  onArtifactClick,
}: MissionProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchProgress = useCallback(async () => {
    if (!workflowId || !mountedRef.current) return;
    try {
      const res = await fetch(`/api/workflow-progress?workflowId=${encodeURIComponent(workflowId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        // Don't surface transient errors — keep polling
        return;
      }
      const data: ProgressData = await res.json();
      if (!mountedRef.current) return;
      setProgress(data);
      setError(null);

      // Stop polling on terminal states
      if (data.status === 'completed' || data.status === 'error' || data.status === 'not_found') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // Non-fatal — keep polling
    }
  }, [workflowId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!workflowId) return;

    // Initial fetch after short delay
    const initialTimer = setTimeout(fetchProgress, 2000);
    // Start polling every 5s
    pollRef.current = setInterval(fetchProgress, 5000);

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimer);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [workflowId, fetchProgress]);

  // Don't render until we have data
  if (!progress || !workflowId) return null;
  // Don't render if workflow not found and no timeline
  if (progress.status === 'not_found' && progress.timeline.length === 0) return null;

  const pct = progress.total_count > 0
    ? Math.round((progress.completed_count / progress.total_count) * 100)
    : 0;

  const showRibbon = progress.status === 'in_progress' || progress.status === 'pending';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4">
      {/* Activity Ribbon (top of screen) */}
      {showRibbon && (
        <ActivityRibbon message={progress.activity_message} pct={pct} />
      )}

      {/* Completed state ribbon */}
      {progress.status === 'completed' && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-4 py-2.5 flex items-center gap-2 rounded-t-xl">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">{progress.activity_message}</span>
          <span className="ml-auto text-xs font-semibold">100%</span>
        </div>
      )}

      {/* Error state ribbon */}
      {progress.status === 'error' && (
        <div className="bg-gradient-to-r from-red-500 to-rose-500 text-white px-4 py-2.5 flex items-center gap-2 rounded-t-xl">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-medium">{progress.activity_message}</span>
        </div>
      )}

      {/* Timeline */}
      {progress.timeline.length > 0 && (
        <MissionTimeline stages={progress.timeline} />
      )}

      {/* Artifact Cards */}
      <ArtifactCards
        available={progress.available_artifacts}
        stillWorking={progress.still_working}
        onArtifactClick={onArtifactClick}
      />

      {/* Operator Diagnostics (admin only) */}
      {isAdmin && (
        <OperatorDiagnostics diags={progress.operator_diagnostics} />
      )}
    </div>
  );
}
