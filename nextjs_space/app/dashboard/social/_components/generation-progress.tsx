'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Sparkles, Eye, ArrowRight,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Stage {
  label: string;
  description: string;
  status: 'waiting' | 'active' | 'complete' | 'error';
}

interface ProgressData {
  status: string;      // 'processing' | 'generating' | 'completed' | 'error'
  progress: number;    // 0-100
  message: string;
  stages: Stage[];
  hasError: boolean;
}

interface GenerationProgressProps {
  workflowIds: string[];
  flowLabel: string;          // "Scout Stories" or "My Own Post"
  onComplete: () => void;     // called when generation finishes
  onRetry: () => void;        // called when user clicks retry
  onDismiss: () => void;      // called when user closes the panel
}

// ── Friendly agent messages shown between stages ─────────────────────────────
const AGENT_MESSAGES = [
  '🔍 Our team is reviewing your business brand…',
  '📝 Crafting the marketing strategy…',
  '✏️ Writing sharp, engaging copy…',
  '🎨 Designing the visual direction…',
  '🖼️ Rendering your final artwork…',
  '✨ Putting the finishing touches on your post…',
];

const STAGE_ICONS: Record<string, string> = {
  'Business Analysis': '🔍',
  'Marketing Strategy': '📝',
  'Ad Copywriting': '✏️',
  'Visual Direction': '🎨',
  'Image Generation': '🖼️',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function GenerationProgress({
  workflowIds,
  flowLabel,
  onComplete,
  onRetry,
  onDismiss,
}: GenerationProgressProps) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const completeFired = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollProgress = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/social/progress?workflowIds=${encodeURIComponent(workflowIds.join(','))}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to check progress');
      }
      const result: ProgressData = await res.json();
      setData(result);
      setError(null);
      setPollCount(c => c + 1);

      // Fire onComplete once when done
      if (result.status === 'completed' && !completeFired.current) {
        completeFired.current = true;
        // Small delay so user sees 100% before transition
        setTimeout(() => onComplete(), 1500);
      }
    } catch (e: any) {
      console.warn('Progress poll error:', e.message);
      // Don't overwrite existing data on transient network errors
      setPollCount(c => c + 1);
    }
  }, [workflowIds, onComplete]);

  useEffect(() => {
    // Initial poll immediately
    pollProgress();

    // Then poll every 8 seconds
    intervalRef.current = setInterval(pollProgress, 8000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollProgress]);

  // Stop polling after completion or too many attempts
  useEffect(() => {
    if (
      (data?.status === 'completed' || data?.status === 'error' || pollCount > 60) &&
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

  // Pick the right agent message based on active stage index
  const activeIdx = stages.findIndex(s => s.status === 'active');
  const completedCount = stages.filter(s => s.status === 'complete').length;
  const agentMessage =
    data?.message ||
    (activeIdx >= 0 ? AGENT_MESSAGES[Math.min(activeIdx, AGENT_MESSAGES.length - 1)] : AGENT_MESSAGES[0]);

  // Color scheme
  const accentColor = isError ? 'purple' : 'blue'; // keep purple for error to match My Own Post
  const barColor = isError
    ? 'bg-red-500'
    : isComplete
    ? 'bg-green-500'
    : 'bg-blue-600';

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
                : 'Our creative team is working on your post…'}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      <div className="px-5 py-4">
        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-600">
              {isComplete ? 'Complete' : isError ? 'Error' : `${progress}%`}
            </span>
            <span className="text-xs text-gray-400">
              {completedCount}/{stages.length || '?'} stages
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${barColor}`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Agent message */}
        <AnimatePresence mode="wait">
          <motion.div
            key={agentMessage}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className={`p-3 rounded-lg mb-4 ${
              isError
                ? 'bg-red-50 border border-red-200'
                : isComplete
                ? 'bg-green-50 border border-green-200'
                : 'bg-blue-50 border border-blue-100'
            }`}
          >
            <p className={`text-sm font-medium ${
              isError ? 'text-red-700' : isComplete ? 'text-green-700' : 'text-blue-700'
            }`}>
              {agentMessage}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Stage list */}
        {stages.length > 0 && (
          <div className="space-y-1.5">
            {stages.map((stage, i) => {
              const icon = STAGE_ICONS[stage.label] || '⚙️';
              return (
                <div
                  key={`${stage.label}-${i}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                    stage.status === 'active'
                      ? 'bg-blue-50 border border-blue-100'
                      : stage.status === 'complete'
                      ? 'bg-gray-50'
                      : stage.status === 'error'
                      ? 'bg-red-50 border border-red-100'
                      : 'bg-white'
                  }`}
                >
                  {/* Status indicator */}
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    {stage.status === 'complete' && (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    )}
                    {stage.status === 'active' && (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    )}
                    {stage.status === 'error' && (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    {stage.status === 'waiting' && (
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                    )}
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${
                      stage.status === 'active'
                        ? 'text-blue-800 font-medium'
                        : stage.status === 'complete'
                        ? 'text-gray-600'
                        : stage.status === 'error'
                        ? 'text-red-700 font-medium'
                        : 'text-gray-400'
                    }`}>
                      <span className="mr-1.5">{icon}</span>
                      {stage.label}
                    </p>
                    {stage.status === 'active' && stage.description && (
                      <p className="text-xs text-blue-600 mt-0.5 ml-6">{stage.description}</p>
                    )}
                  </div>

                  {/* Checkmark or arrow */}
                  {stage.status === 'complete' && (
                    <span className="text-xs text-green-500 font-medium">Done</span>
                  )}
                  {stage.status === 'active' && (
                    <span className="text-xs text-blue-500 font-medium">Working…</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state while first poll loads */}
        {stages.length === 0 && isWorking && (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            <p className="text-sm text-gray-500">Connecting to the creative team…</p>
          </div>
        )}
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
