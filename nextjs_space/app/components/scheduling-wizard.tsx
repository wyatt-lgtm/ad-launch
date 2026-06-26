'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronLeft, Check, Calendar, Target,
  ShieldCheck, Clock, Sparkles, Loader2, AlertCircle,
  Facebook, Globe, Instagram, Linkedin, X,
} from 'lucide-react';
import {
  POSTING_GOALS, APPROVAL_MODES, CADENCE_CONFIG, PLATFORM_CONFIG,
  generateRecommendedSchedule, formatScheduleDate,
  type PostingGoal, type ApprovalMode, type Cadence, type ScheduledPostInput,
  type GeneratedScheduleItem,
} from '@/lib/scheduling-utils';

// ─── Types ──────────────────────────────────────────────

interface SchedulingWizardProps {
  businessId: string;
  businessName: string;
  businessType?: string;
  posts: Array<{
    id: string;
    caption: string;
    imageUrl?: string | null;
    hashtags?: string[];
    cta?: string | null;
    lane?: string | null;
    sourceType?: string | null;
  }>;
  onComplete: (result: { scheduledCount: number }) => void;
  onCancel: () => void;
}

type WizardStep = 'channels' | 'goal' | 'approval' | 'cadence' | 'review';

const STEPS: WizardStep[] = ['channels', 'goal', 'approval', 'cadence', 'review'];
const STEP_LABELS: Record<WizardStep, string> = {
  channels: 'Connect Channels',
  goal: 'Posting Goal',
  approval: 'Approval Mode',
  cadence: 'Cadence',
  review: 'Review Schedule',
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  facebook: Facebook,
  google_business: Globe,
  instagram: Instagram,
  linkedin: Linkedin,
};

// ─── Component ──────────────────────────────────────────

export default function SchedulingWizard({
  businessId,
  businessName,
  businessType,
  posts,
  onComplete,
  onCancel,
}: SchedulingWizardProps) {
  const [step, setStep] = useState<WizardStep>('channels');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['facebook', 'google_business']);
  const [goal, setGoal] = useState<PostingGoal | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('auto_after_approval');
  const [cadence, setCadence] = useState<Cadence>('standard');
  const [schedule, setSchedule] = useState<GeneratedScheduleItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const currentStepIndex = STEPS.indexOf(step);

  // Generate preview schedule when cadence changes
  useEffect(() => {
    const postInputs: ScheduledPostInput[] = posts.map(p => ({
      socialPostId: p.id,
      caption: p.caption,
      imageUrl: p.imageUrl ?? undefined,
      hashtags: p.hashtags ?? [],
      cta: p.cta ?? undefined,
      platforms: selectedPlatforms,
      lane: p.lane ?? undefined,
      sourceType: p.sourceType ?? undefined,
    }));
    const generated = generateRecommendedSchedule(postInputs, cadence);
    setSchedule(generated);
  }, [cadence, posts, selectedPlatforms]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const canProceed = () => {
    switch (step) {
      case 'channels': return selectedPlatforms.length > 0;
      case 'goal': return goal !== null;
      case 'approval': return true;
      case 'cadence': return cadence !== 'custom' || true; // custom handled separately
      case 'review': return schedule.length > 0;
      default: return false;
    }
  };

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError('');
    try {
      // Save posting preferences
      await fetch(`/api/businesses/${businessId}/posting-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingGoal: goal,
          approvalMode,
          cadence,
          defaultChannels: selectedPlatforms,
          onboardingComplete: true,
        }),
      });

      // Schedule the posts
      const res = await fetch(`/api/businesses/${businessId}/schedule-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postIds: posts.map(p => p.id),
          cadence,
          approvalMode,
          platforms: selectedPlatforms,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule posts');

      onComplete({ scheduledCount: data.count ?? posts.length });
    } catch (err: any) {
      console.error('[SchedulingWizard]', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [businessId, goal, approvalMode, cadence, selectedPlatforms, posts, onComplete]);

  // ─── Step Renderers ──────────────────────────────────

  const renderChannels = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-gray-900">Where should we post?</h3>
        <p className="text-sm text-gray-500 mt-1">Select the channels your AI marketing team will publish to.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.entries(PLATFORM_CONFIG) as [string, typeof PLATFORM_CONFIG[keyof typeof PLATFORM_CONFIG]][]).map(([key, config]) => {
          const Icon = PLATFORM_ICONS[key] ?? Globe;
          const selected = selectedPlatforms.includes(key);
          return (
            <button
              key={key}
              onClick={() => !config.comingSoon && togglePlatform(key)}
              disabled={config.comingSoon}
              className={`relative flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                config.comingSoon
                  ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                  : selected
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.bgColor}`}>
                <Icon className={`w-5 h-5 ${config.color}`} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900 text-sm">{config.label}</div>
                {config.recommended && (
                  <span className="text-xs text-blue-600 font-medium">Recommended</span>
                )}
                {config.comingSoon && (
                  <span className="text-xs text-gray-400 font-medium">Coming soon</span>
                )}
              </div>
              {selected && !config.comingSoon && (
                <Check className="w-5 h-5 text-blue-600" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderGoal = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-gray-900">What's your #1 posting goal?</h3>
        <p className="text-sm text-gray-500 mt-1">This helps your AI team optimize post timing and content.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.entries(POSTING_GOALS) as [PostingGoal, typeof POSTING_GOALS[PostingGoal]][]).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setGoal(key)}
            className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
              goal === key
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex-1">
              <div className="font-medium text-gray-900 text-sm">{config.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{config.description}</div>
            </div>
            {goal === key && <Check className="w-5 h-5 text-blue-600 mt-0.5" />}
          </button>
        ))}
      </div>
    </div>
  );

  const renderApproval = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-gray-900">How much control do you want?</h3>
        <p className="text-sm text-gray-500 mt-1">Choose how your AI team handles post approvals.</p>
      </div>
      <div className="space-y-3">
        {(Object.entries(APPROVAL_MODES) as [ApprovalMode, typeof APPROVAL_MODES[ApprovalMode]][]).map(([key, config]) => (
          <button
            key={key}
            onClick={() => !config.disabled && setApprovalMode(key)}
            disabled={config.disabled}
            className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
              config.disabled
                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                : approvalMode === key
                  ? 'border-blue-500 bg-blue-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <ShieldCheck className={`w-5 h-5 mt-0.5 ${
              approvalMode === key ? 'text-blue-600' : 'text-gray-400'
            }`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 text-sm">{config.label}</span>
                {config.recommended && (
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">RECOMMENDED</span>
                )}
                {config.disabled && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-semibold">COMING SOON</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{config.description}</div>
            </div>
            {approvalMode === key && !config.disabled && (
              <Check className="w-5 h-5 text-blue-600 mt-0.5" />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const renderCadence = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-gray-900">How often should we post?</h3>
        <p className="text-sm text-gray-500 mt-1">We'll spread your posts across the week for maximum reach.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(CADENCE_CONFIG) as [Cadence, typeof CADENCE_CONFIG[Cadence]][]).filter(([k]) => k !== 'custom').map(([key, config]) => (
          <button
            key={key}
            onClick={() => setCadence(key)}
            className={`p-4 rounded-xl border-2 transition-all text-center ${
              cadence === key
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-gray-900">{config.postsPerWeek}</div>
            <div className="text-xs text-gray-500">posts/week</div>
            <div className="font-medium text-sm text-gray-900 mt-2">{config.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{config.description}</div>
            {key === 'standard' && (
              <span className="inline-block text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold mt-2">RECOMMENDED</span>
            )}
          </button>
        ))}
      </div>
      {/* Schedule preview */}
      {schedule.length > 0 && (
        <div className="mt-6 bg-gray-50 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Preview: Your first {schedule.length} post{schedule.length > 1 ? 's' : ''}
          </h4>
          <div className="space-y-2">
            {schedule.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </div>
                <span className="text-gray-700">{item.dayLabel} at {item.timeLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderReview = () => (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <Sparkles className="w-8 h-8 text-blue-600 mx-auto mb-2" />
        <h3 className="text-lg font-bold text-gray-900">Your AI marketing schedule is ready</h3>
        <p className="text-sm text-gray-500 mt-1">
          Your AI team created {posts.length} post{posts.length > 1 ? 's' : ''} for <span className="font-medium text-gray-700">{businessName}</span>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{selectedPlatforms.length}</div>
          <div className="text-xs text-gray-500">Channels</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{goal ? POSTING_GOALS[goal].label.split(' ')[0] : '—'}</div>
          <div className="text-xs text-gray-500">Goal</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{CADENCE_CONFIG[cadence]?.postsPerWeek ?? 0}/wk</div>
          <div className="text-xs text-gray-500">Cadence</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{APPROVAL_MODES[approvalMode]?.label.split(' ')[0]}</div>
          <div className="text-xs text-gray-500">Approval</div>
        </div>
      </div>

      {/* Schedule timeline */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Recommended 2-Week Schedule</h4>
        <div className="space-y-3">
          {schedule.map((item, i) => {
            const post = posts[i];
            return (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">
                  {i + 1}
                </div>
                {post?.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt="Post preview"
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                    onError={(e: any) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{item.dayLabel} at {item.timeLabel}</div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">
                    {post?.caption?.slice(0, 80)}{(post?.caption?.length ?? 0) > 80 ? '…' : ''}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {selectedPlatforms.map(p => {
                      const Icon = PLATFORM_ICONS[p] ?? Globe;
                      return <Icon key={p} className="w-3.5 h-3.5 text-gray-400" />;
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );

  const STEP_RENDERERS: Record<WizardStep, () => React.ReactNode> = {
    channels: renderChannels,
    goal: renderGoal,
    approval: renderApproval,
    cadence: renderCadence,
    review: renderReview,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Schedule Your Posts</h2>
              <p className="text-xs text-gray-500">Step {currentStepIndex + 1} of {STEPS.length}: {STEP_LABELS[step]}</p>
            </div>
            <button onClick={onCancel} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1 mt-3">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= currentStepIndex ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {STEP_RENDERERS[step]()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={currentStepIndex === 0 ? onCancel : goBack}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {currentStepIndex === 0 ? 'Cancel' : 'Back'}
          </button>

          {step === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Scheduling…</>
              ) : (
                <><Check className="w-4 h-4" /> Approve Schedule</>
              )}
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="flex items-center gap-1 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
