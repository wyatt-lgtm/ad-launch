'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Sparkles, Clock, ChevronDown, ChevronUp, Info,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────────

interface StageTiming {
  createdToClaimedMs: number | null;
  claimedToHeartbeatMs: number | null;
  activeProcessingMs: number | null;
  totalLifecycleMs: number | null;
  heartbeatAgeMs: number | null;
}

interface Stage {
  label: string;
  icon: string;
  description: string;
  status: 'waiting' | 'active' | 'complete' | 'error';
  order: number;
  taskId: number | null;
  workflowId: string | null;
  department: string | null;
  agentName: string | null;
  retryCount: number;
  timing: StageTiming;
  warnings: string[];
  createdAt: string | null;
  claimedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
}

interface WorkflowTiming {
  firstTaskCreatedAt: string | null;
  firstTaskClaimedAt: string | null;
  lastTaskCompletedAt: string | null;
  totalWorkflowTimeMs: number | null;
  elapsedSinceFirstTaskMs: number | null;
}

interface LagWarning {
  taskId: number;
  step: string;
  warning: string;
}

interface ProgressData {
  status: string;
  progress: number;
  message: string;
  stages: Stage[];
  hasError: boolean;
  failedStep: { label: string; taskId: number | null; workflowId: string | null; error?: string } | null;
  workflowIds: string[];
  generationRunId: string | null;
  generationRunStatus?: string | null;
  workflowTiming: WorkflowTiming;
  lagWarnings: LagWarning[];
  stageCount: { total: number; completed: number; active: number; failed: number };
  timing?: {
    clickedAt?: string | null;
    apiReceivedAt?: string | null;
    runCreatedAt?: string | null;
    workflowCreateStartedAt?: string | null;
    workflowCreatedAt?: string | null;
    failedAt?: string | null;
  };
}

interface GenerationProgressProps {
  workflowIds: string[];
  flowLabel: string;
  generationRunId: string | null;
  clickedAt: string | null;
  onComplete: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

function formatTimingLabel(ms: number | null): string {
  if (ms === null) return '—';
  return formatDuration(ms);
}

// ── Pre-workflow phase labels shown before any Tombstone tasks exist ─────────
const PRE_WORKFLOW_LABELS: Record<string, string> = {
  creating_workflow: 'Creating Tombstone workflow…',
  workflow_creation_failed: 'Workflow creation failed',
  workflow_running: 'Workflow created — waiting for tasks…',
  workflow_created: 'Workflow created — waiting for tasks…',
};

// ── Component ─────────────────────────────────────────────────────────────────────

export default function GenerationProgress({
  workflowIds,
  flowLabel,
  generationRunId,
  clickedAt,
  onComplete,
  onRetry,
  onDismiss,
}: GenerationProgressProps) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const completeFired = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTime = useRef(clickedAt ? new Date(clickedAt).getTime() : Date.now());

  // Elapsed time ticker
  useEffect(() => {
    setElapsedMs(Date.now() - startTime.current);
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime.current);
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const pollProgress = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      // Send workflowIds only if we have them
      if (workflowIds.length > 0) {
        params.set('workflowIds', workflowIds.join(','));
      }
      if (generationRunId) params.set('generationRunId', generationRunId);

      // Need at least one identifier
      if (workflowIds.length === 0 && !generationRunId) return;

      const res = await fetch(`/api/social/progress?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to check progress');
      }
      const result: ProgressData = await res.json();
      setData(result);
      setError(null);
      setPollCount(c => c + 1);

      if (result.status === 'completed' && !completeFired.current) {
        completeFired.current = true;
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setTimeout(() => onComplete(), 1500);
      }
    } catch (e: any) {
      console.warn('Progress poll error:', e.message);
      setPollCount(c => c + 1);
    }
  }, [workflowIds, generationRunId, onComplete]);

  useEffect(() => {
    pollProgress();
    intervalRef.current = setInterval(pollProgress, 6000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [pollProgress]);

  useEffect(() => {
    if (
      (data?.status === 'completed' || data?.status === 'error' || pollCount > 80) &&
      intervalRef.current
    ) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [data?.status, pollCount]);

  // Derive display values
  const progress = data?.progress ?? 0;
  const stages = data?.stages ?? [];
  const isComplete = data?.status === 'completed';
  const isError = data?.status === 'error' || data?.hasError;
  const isWorking = !isComplete && !isError;
  const sc = data?.stageCount;
  const lagWarnings = data?.lagWarnings ?? [];
  const failedStep = data?.failedStep;
  const genRunStatus = data?.generationRunStatus;

  // Determine if we’re in pre-workflow phase
  const isPreWorkflow = stages.length === 0 && isWorking;
  const preWorkflowLabel = genRunStatus ? (PRE_WORKFLOW_LABELS[genRunStatus] || null) : null;

  const activeStage = stages.find(s => s.status === 'active');
  const message = data?.message || (isPreWorkflow ? 'Creating generation run…' : 'Connecting to the creative team…');

  const barColor = isError ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-600';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isWorking && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
          {isComplete && <CheckCircle2 className="w-4 h-4 text-green-600" />}
          {isError && <AlertTriangle className="w-4 h-4 text-red-500" />}
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              {isComplete
                ? 'Post Ready!'
                : isError
                ? 'Generation Failed'
                : `Creating Post — ${flowLabel}`}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isComplete
                ? 'Your polished post has been added to the queue below.'
                : isError
                ? 'Something went wrong, but you can try again.'
                : isPreWorkflow
                ? 'Setting up the creative pipeline…'
                : 'Our creative team is working on your post…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-gray-400 font-mono">
            <Clock className="w-3 h-3" />
            {formatDuration(elapsedMs)}
          </div>
          <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-600">
              {isComplete ? 'Complete' : isError ? 'Error' : `${progress}%`}
            </span>
            <span className="text-xs text-gray-400">
              {sc && sc.total > 0 ? `${sc.completed}/${sc.total} steps` : isPreWorkflow ? 'Initializing…' : '…'}
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${barColor}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(progress, isPreWorkflow ? 3 : 0)}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Current step message */}
        <AnimatePresence mode="wait">
          <motion.div
            key={message}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className={`p-3 rounded-lg mb-4 ${
              isError ? 'bg-red-50 border border-red-200'
              : isComplete ? 'bg-green-50 border border-green-200'
              : 'bg-blue-50 border border-blue-100'
            }`}
          >
            <p className={`text-sm font-medium ${
              isError ? 'text-red-700' : isComplete ? 'text-green-700' : 'text-blue-700'
            }`}>
              {message}
            </p>
            {/* Active step task/workflow ID */}
            {activeStage && (
              <p className="text-[10px] text-gray-400 font-mono mt-1">
                {activeStage.taskId && `Task #${activeStage.taskId}`}
                {activeStage.workflowId && ` · WF ${activeStage.workflowId}`}
                {activeStage.agentName && ` · ${activeStage.agentName}`}
                {activeStage.timing?.activeProcessingMs != null && ` · ${formatDuration(activeStage.timing.activeProcessingMs)}`}
              </p>
            )}
            {/* Pre-workflow: show generation run ID */}
            {isPreWorkflow && generationRunId && (
              <p className="text-[10px] text-gray-400 font-mono mt-1">
                Generation Run: {generationRunId}
                {genRunStatus && ` · Status: ${genRunStatus}`}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Failure details */}
        {isError && failedStep && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p className="text-sm font-medium text-red-800">Failed at: {failedStep.label}</p>
            {failedStep.error && (
              <p className="text-xs text-red-600 mt-1">{failedStep.error}</p>
            )}
            <p className="text-[10px] text-red-500 font-mono mt-1">
              {failedStep.taskId && `Task #${failedStep.taskId} · `}
              {failedStep.workflowId && `WF ${failedStep.workflowId} · `}
              {generationRunId && `Run ${generationRunId}`}
            </p>
            {data?.workflowTiming?.elapsedSinceFirstTaskMs != null && (
              <p className="text-[10px] text-red-400 mt-1">
                Elapsed before failure: {formatTimingLabel(data.workflowTiming.elapsedSinceFirstTaskMs)}
              </p>
            )}
          </div>
        )}

        {/* Lag warnings */}
        {lagWarnings.length > 0 && (
          <div className="mb-4 space-y-1">
            {lagWarnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-700">
                  {w.step}: {w.warning} (Task #{w.taskId})
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Pre-workflow state indicator */}
        {isPreWorkflow && preWorkflowLabel && stages.length === 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100">
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-blue-800 font-medium">
                  ⚙️ {preWorkflowLabel}
                </p>
              </div>
              <span className="text-xs text-blue-500 font-medium">Working…</span>
            </div>
          </div>
        )}

        {/* Stage list */}
        {stages.length > 0 && (
          <div className="space-y-1.5">
            {stages.map((stage, i) => (
              <div
                key={`${stage.label}-${stage.taskId ?? i}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  stage.status === 'active' ? 'bg-blue-50 border border-blue-100'
                  : stage.status === 'complete' ? 'bg-gray-50'
                  : stage.status === 'error' ? 'bg-red-50 border border-red-100'
                  : 'bg-white'
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {stage.status === 'complete' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {stage.status === 'active' && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                  {stage.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                  {stage.status === 'waiting' && <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-tight ${
                    stage.status === 'active' ? 'text-blue-800 font-medium'
                    : stage.status === 'complete' ? 'text-gray-600'
                    : stage.status === 'error' ? 'text-red-700 font-medium'
                    : 'text-gray-400'
                  }`}>
                    <span className="mr-1.5">{stage.icon}</span>
                    {stage.label}
                  </p>
                  {stage.status === 'active' && stage.description && (
                    <p className="text-xs text-blue-600 mt-0.5 ml-6">{stage.description}</p>
                  )}
                </div>

                {/* Timing badge */}
                <div className="text-right shrink-0">
                  {stage.status === 'complete' && stage.timing?.totalLifecycleMs != null && (
                    <span className="text-[10px] text-gray-400 font-mono">
                      {formatDuration(stage.timing.totalLifecycleMs)}
                    </span>
                  )}
                  {stage.status === 'active' && stage.timing?.activeProcessingMs != null && (
                    <span className="text-[10px] text-blue-400 font-mono">
                      {formatDuration(stage.timing.activeProcessingMs)}…
                    </span>
                  )}
                  {stage.status === 'complete' && !stage.timing?.totalLifecycleMs && (
                    <span className="text-xs text-green-500 font-medium">Done</span>
                  )}
                  {stage.status === 'active' && stage.timing?.activeProcessingMs == null && (
                    <span className="text-xs text-blue-500 font-medium">Working…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state while first poll loads and no pre-workflow phase */}
        {stages.length === 0 && isWorking && !preWorkflowLabel && (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            <p className="text-sm text-gray-500">Connecting to the creative team…</p>
          </div>
        )}

        {/* Expandable details panel */}
        <button
          onClick={() => setShowDetails(v => !v)}
          className="flex items-center gap-1 mt-3 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showDetails ? 'Hide' : 'Show'} Workflow Details
        </button>

        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 p-3 bg-gray-50 rounded-lg text-[10px] font-mono text-gray-500 space-y-1">
                {generationRunId && <p>Generation Run: {generationRunId}</p>}
                {genRunStatus && <p>Run Status: {genRunStatus}</p>}
                {data?.workflowIds?.length ? <p>Workflow IDs: {data.workflowIds.join(', ')}</p> : <p>Workflow IDs: none yet</p>}
                {clickedAt && <p>Clicked: {new Date(clickedAt).toLocaleTimeString()}</p>}
                <p>Total Elapsed: {formatDuration(elapsedMs)}</p>
                {data?.timing?.apiReceivedAt && (
                  <p>API Received: {new Date(data.timing.apiReceivedAt).toLocaleTimeString()}</p>
                )}
                {data?.timing?.workflowCreateStartedAt && (
                  <p>Workflow Create Started: {new Date(data.timing.workflowCreateStartedAt).toLocaleTimeString()}</p>
                )}
                {data?.timing?.workflowCreatedAt && (
                  <p>Workflow Created: {new Date(data.timing.workflowCreatedAt).toLocaleTimeString()}</p>
                )}
                {data?.workflowTiming?.totalWorkflowTimeMs != null && (
                  <p>Workflow Execution: {formatDuration(data.workflowTiming.totalWorkflowTimeMs)}</p>
                )}
                {data?.workflowTiming?.firstTaskCreatedAt && (
                  <p>First Task: {new Date(data.workflowTiming.firstTaskCreatedAt).toLocaleTimeString()}</p>
                )}
                {data?.workflowTiming?.firstTaskClaimedAt && (
                  <p>First Claim: {new Date(data.workflowTiming.firstTaskClaimedAt).toLocaleTimeString()}</p>
                )}
                {data?.workflowTiming?.lastTaskCompletedAt && (
                  <p>Last Complete: {new Date(data.workflowTiming.lastTaskCompletedAt).toLocaleTimeString()}</p>
                )}
                {data?.timing?.failedAt && (
                  <p className="text-red-500">Failed At: {new Date(data.timing.failedAt).toLocaleTimeString()}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      {(isError || isComplete) && (
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          {isError && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          )}
          {isComplete && (
            <button
              onClick={onDismiss}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              View Post
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
