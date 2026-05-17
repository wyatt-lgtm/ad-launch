'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Check, Rss, ArrowRight, Sparkles, Zap, AlertCircle,
  Building2, Plus, CheckCircle2, Clock, Newspaper, XCircle,
  MapPin, Globe2, Layers,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import { BusinessPickerGrid, ActiveBusinessBanner } from '@/components/business-picker';

type ContentSourceMode = 'local_only' | 'local_plus_interests' | 'interests_only';

interface Industry {
  key: string;
  label: string;
  description: string;
  icon: string;
  feedCount: number;
  enabled: boolean;
}

// ── Mode option descriptors ───────────────────────────────────────────────
const MODE_OPTIONS: {
  value: ContentSourceMode;
  label: string;
  description: string;
  icon: typeof MapPin;
}[] = [
  {
    value: 'local_only',
    label: 'Local Only',
    description: 'Only local news from your ZIP/trade area plus upcoming events',
    icon: MapPin,
  },
  {
    value: 'local_plus_interests',
    label: 'Local + Interests',
    description: 'Local news plus trending content from your selected interest categories',
    icon: Layers,
  },
  {
    value: 'interests_only',
    label: 'Interests Only',
    description: 'Only national/interest feeds — no local ZIP required',
    icon: Globe2,
  },
];

// ── Generation progress steps ─────────────────────────────────────────────
interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}

const INITIAL_STEPS: ProgressStep[] = [
  { id: 'scout',    label: 'Scouting news & events',         status: 'pending' },
  { id: 'creative', label: 'Sending brief to creative team', status: 'pending' },
  { id: 'queue',    label: 'Queuing post generation',        status: 'pending' },
];

export default function FeedPreferences() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const [showPicker, setShowPicker] = useState(false);

  // Content source mode (business-level)
  const [contentMode, setContentMode] = useState<ContentSourceMode>('local_plus_interests');
  const savedModeRef = useRef<ContentSourceMode>('local_plus_interests');

  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Generation progress state
  const [generating, setGenerating] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>(INITIAL_STEPS);
  const [genResult, setGenResult] = useState<{ message: string; type: 'success' | 'error'; taskCount?: number } | null>(null);
  const lastSavedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  // Load business-level content settings when active business changes
  const loadSettings = useCallback(async () => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId || status !== 'authenticated') return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${bizId}/content-settings`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();

      // Set mode
      const mode = (data.contentSourceMode || 'local_plus_interests') as ContentSourceMode;
      setContentMode(mode);
      savedModeRef.current = mode;

      // Set industries + selected from business preferences
      setIndustries(data.industries ?? []);
      const enabledKeys = new Set<string>(
        (data.selectedInterestCategories ?? []) as string[]
      );
      setSelected(enabledKeys);
      lastSavedRef.current = new Set(enabledKeys);
    } catch {
      setError('Failed to load content settings');
    } finally {
      setLoading(false);
    }
  }, [bizCtx.activeBusiness?.id, status]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggle = (key: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleModeChange = (mode: ContentSourceMode) => {
    setSaved(false);
    setContentMode(mode);
  };

  const needsSave = (): boolean => {
    if (contentMode !== savedModeRef.current) return true;
    if (selected.size !== lastSavedRef.current.size) return true;
    for (const key of selected) {
      if (!lastSavedRef.current.has(key)) return true;
    }
    return false;
  };

  const saveSettings = async (silent = false): Promise<boolean> => {
    if (!bizCtx.activeBusiness?.id) return false;
    if (!silent) { setSaving(true); setError(''); setSaved(false); }
    try {
      const res = await fetch(`/api/businesses/${bizCtx.activeBusiness.id}/content-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSourceMode: contentMode,
          selectedInterestCategories: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      savedModeRef.current = contentMode;
      lastSavedRef.current = new Set(selected);
      return true;
    } catch {
      if (!silent) setError('Failed to save. Please try again.');
      return false;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  // ── Helper to update a single progress step ──────────────────────────────
  const updateStep = (id: string, updates: Partial<ProgressStep>) => {
    setProgressSteps(prev =>
      prev.map(s => s.id === id ? { ...s, ...updates } : s)
    );
  };

  // ── Generate Posts ────────────────────────────────────────────────────────
  const handleGeneratePosts = async () => {
    // In interests-based modes, require at least one category
    if (contentMode !== 'local_only' && selected.size === 0) {
      setError('Select at least one content category to generate posts.');
      return;
    }
    setGenerating(true);
    setGenResult(null);
    setError('');
    setProgressSteps(INITIAL_STEPS.map(s => ({ ...s, status: 'pending' as const })));

    const bizId = bizCtx.activeBusiness?.id;

    try {
      // Auto-save if anything changed
      if (needsSave()) {
        const ok = await saveSettings(true);
        if (!ok) {
          setGenResult({ message: 'Failed to save content settings. Please try again.', type: 'error' });
          setGenerating(false);
          return;
        }
      }

      // Step 1: Clark Kent gathers intelligence (passes businessId for mode)
      updateStep('scout', { status: 'active' });
      const scoutRes = await fetch('/api/rss/clark-kent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: bizId }),
      });
      const scoutData = await scoutRes.json();
      if (!scoutRes.ok) throw new Error(scoutData.error || 'Scout failed');

      const localCount = scoutData.meta?.rssItemCount ?? 0;
      const interestCount = scoutData.meta?.interestItemCount ?? 0;
      const eventCount = scoutData.meta?.eventCount ?? 0;
      const modeLabel = scoutData.meta?.contentSourceMode || contentMode;

      let scoutDetail = '';
      if (modeLabel === 'local_only') {
        scoutDetail = `${localCount} local news items, ${eventCount} events`;
      } else if (modeLabel === 'interests_only') {
        scoutDetail = `${interestCount} interest items (${scoutData.meta?.interestCategoryCount ?? 0} categories), ${eventCount} events`;
      } else {
        scoutDetail = `${localCount} local + ${interestCount} interest items, ${eventCount} events`;
      }
      const geo = [scoutData.meta?.city, scoutData.meta?.state].filter(Boolean).join(', ');
      if (geo) scoutDetail += ` from ${geo}`;
      updateStep('scout', { status: 'done', detail: scoutDetail });

      // Step 2: Send scout brief to Tombstone creative pipeline
      updateStep('creative', { status: 'active' });
      const tombstoneRes = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoutBrief: scoutData.brief, businessId: bizId }),
      });
      const tombstoneData = await tombstoneRes.json();
      if (!tombstoneRes.ok) throw new Error(tombstoneData.error || 'Failed to start creative workflow');
      updateStep('creative', {
        status: 'done',
        detail: 'Creative team engaged — Zig Ziglar → Ogilvy → Don Draper → Andy Warhol',
      });

      // Step 3: Queue confirmation
      updateStep('queue', { status: 'active' });
      await new Promise(r => setTimeout(r, 600));
      const taskCount = tombstoneData.taskCount ?? 0;
      updateStep('queue', {
        status: 'done',
        detail: `${taskCount} tasks queued (${modeLabel} mode)`,
      });

      setGenResult({
        message: `${taskCount} posts queued! Posts with artwork will appear in your Social Post Queue when the creative team finishes.`,
        type: 'success',
        taskCount,
      });
    } catch (e: any) {
      setProgressSteps(prev =>
        prev.map(s => s.status === 'active' ? { ...s, status: 'error' as const, detail: e.message } : s)
      );
      setGenResult({ message: e.message || 'Something went wrong', type: 'error' });
    }
    setGenerating(false);
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (status === 'loading' || loading || bizCtx.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // No businesses — redirect to dashboard
  if (bizCtx.noBusiness) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Found</h2>
        <p className="text-gray-500 mb-6">Analyze a website first so we know which business to create content for.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add a Business
        </button>
      </div>
    );
  }

  // Multiple businesses, none selected — show picker
  if (bizCtx.needsSelection || showPicker) {
    return (
      <BusinessPickerGrid
        businesses={bizCtx.businesses}
        onSelect={(biz) => { bizCtx.setActiveBusiness(biz); setShowPicker(false); }}
      />
    );
  }

  const showInterestGrid = contentMode !== 'local_only';

  // ── If generating, show progress panel ────────────────────────────────────
  if (generating || genResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {bizCtx.activeBusiness && (
          <ActiveBusinessBanner
            activeBusiness={bizCtx.activeBusiness}
            businessCount={bizCtx.businesses.length}
            onSwitch={() => { setShowPicker(true); setGenerating(false); setGenResult(null); }}
          />
        )}

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            {generating ? (
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            ) : genResult?.type === 'success' ? (
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            ) : (
              <AlertCircle className="w-8 h-8 text-red-500" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {generating ? 'Generating Posts...' : genResult?.type === 'success' ? 'Posts Queued!' : 'Generation Failed'}
          </h1>
          <p className="text-gray-500 text-sm">
            {generating
              ? 'Your website analysis is already done — we\'re creating fresh content from your feeds.'
              : genResult?.message}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100 mb-8">
          {progressSteps.map((step) => (
            <div key={step.id} className="px-5 py-4 flex items-start gap-4">
              <div className="mt-0.5">
                {step.status === 'done' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                {step.status === 'active' && <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />}
                {step.status === 'pending' && <Clock className="w-5 h-5 text-gray-300" />}
                {step.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  step.status === 'done' ? 'text-green-800' :
                  step.status === 'active' ? 'text-blue-800' :
                  step.status === 'error' ? 'text-red-800' :
                  'text-gray-400'
                }`}>
                  {step.label}
                </p>
                {step.detail && (
                  <p className={`text-xs mt-0.5 ${
                    step.status === 'done' ? 'text-green-600' :
                    step.status === 'error' ? 'text-red-500' :
                    'text-blue-600'
                  }`}>
                    {step.detail}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {!generating && genResult && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {genResult.type === 'success' && (
              <button
                onClick={() => router.push('/dashboard/social')}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
              >
                <Newspaper className="w-4 h-4" /> Go to Social Post Queue
              </button>
            )}
            <button
              onClick={() => { setGenResult(null); setProgressSteps(INITIAL_STEPS); }}
              className="flex items-center gap-2 px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              <ArrowRight className="w-4 h-4" /> Back to Feeds
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Normal feed selection UI ──────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {bizCtx.activeBusiness && (
        <ActiveBusinessBanner
          activeBusiness={bizCtx.activeBusiness}
          businessCount={bizCtx.businesses.length}
          onSwitch={() => setShowPicker(true)}
        />
      )}

      {/* Header */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Rss className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          Content Sources
        </h1>
        <p className="text-gray-500 max-w-lg mx-auto">
          Choose which content sources power your generated posts — local news, national interest feeds, or both.
        </p>
      </div>

      {/* ── Content Source Mode Selector ─────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Content Source Mode</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODE_OPTIONS.map((opt) => {
            const isActive = contentMode === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => handleModeChange(opt.value)}
                className={`relative text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className={`absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isActive ? 'bg-blue-600' : 'bg-gray-100'
                }`}>
                  {isActive && <Check className="w-3 h-3 text-white" />}
                </div>
                <Icon className={`w-5 h-5 mb-2 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                <h3 className={`text-sm font-semibold ${isActive ? 'text-blue-900' : 'text-gray-800'}`}>{opt.label}</h3>
                <p className="text-xs text-gray-500 mt-1 leading-snug">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Interest Category Grid (hidden in local_only mode) ───────── */}
      {showInterestGrid && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Interest Categories</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {industries.map((ind) => {
              const isActive = selected.has(ind.key);
              return (
                <button
                  key={ind.key}
                  onClick={() => toggle(ind.key)}
                  className={`relative text-left p-5 rounded-xl border-2 transition-all duration-200 group hover:shadow-md ${
                    isActive
                      ? 'border-blue-500 bg-blue-50/60 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-4 right-4 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                      isActive ? 'bg-blue-600 scale-100' : 'bg-gray-100 scale-90 group-hover:scale-100'
                    }`}
                  >
                    {isActive && <Check className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{ind.icon}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base">{ind.label}</h3>
                      <p className="text-sm text-gray-500 mt-0.5 leading-snug">{ind.description}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        {ind.feedCount} active {ind.feedCount === 1 ? 'source' : 'sources'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* When local_only, show a note about interest categories being skipped */}
      {!showInterestGrid && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 text-center">
          <p className="text-sm text-amber-800">
            <MapPin className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            Interest categories are disabled in <strong>Local Only</strong> mode. Switch to <strong>Local + Interests</strong> or <strong>Interests Only</strong> to select categories.
          </p>
        </div>
      )}

      {/* Selection summary + actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-gray-700">
              {contentMode === 'local_only'
                ? 'Local sources only — ready to generate'
                : selected.size === 0
                  ? 'No interest categories selected'
                  : `${selected.size} ${selected.size === 1 ? 'category' : 'categories'} selected`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                <Check className="w-4 h-4" /> Saved!
              </span>
            )}
            {error && <span className="text-sm text-red-500">{error}</span>}
            <button
              onClick={() => saveSettings()}
              disabled={saving || generating}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleGeneratePosts}
              disabled={generating || saving || (contentMode !== 'local_only' && selected.size === 0)}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {generating ? 'Generating Posts...' : 'Generate Posts'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-gray-400">
        {contentMode === 'local_only'
          ? 'Posts will be generated using hyper-local news from your business\'s trade area and upcoming events.'
          : contentMode === 'interests_only'
            ? 'Posts will be generated using national interest feeds and upcoming events — no ZIP code required.'
            : 'Your selected feeds will be mixed with local news, giving your content a national-trending angle alongside hyper-local stories.'}
      </p>
    </div>
  );
}
