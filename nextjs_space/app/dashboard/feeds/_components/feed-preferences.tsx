'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Check, Rss, ArrowRight, Sparkles,
  Building2, Plus,
  MapPin, Globe2, Layers, Mail, Clock, ChevronDown, ChevronUp,
  XCircle, ExternalLink,
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

  // Scout Stories state
  const [scouting, setScouting] = useState(false);
  const lastSavedRef = useRef<Set<string>>(new Set());

  // Story picker state (scout results shown on THIS page)
  interface StoryCard {
    id: string;
    title: string;
    source: string;
    sourceType: 'local' | 'industry' | 'national';
    section: 'local' | 'industry' | 'event';
    pubDate: string;
    summary: string;
    relevance: string;
    link: string;
    category?: string;
  }
  const [storyCards, setStoryCards] = useState<StoryCard[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set());
  const [scoutBriefData, setScoutBriefData] = useState<any>(null);
  const [showStoryPicker, setShowStoryPicker] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [scoutResult, setScoutResult] = useState<{ message: string; meta?: any } | null>(null);
  const [creating, setCreating] = useState(false);
  const MAX_STORIES = 3;

  // Daily Scout Email settings
  const [showScoutEmail, setShowScoutEmail] = useState(false);
  const [scoutEmailEnabled, setScoutEmailEnabled] = useState(false);
  const [scoutRecipient, setScoutRecipient] = useState('');
  const [scoutSendTime, setScoutSendTime] = useState('14:00');
  const [scoutIncludeLocal, setScoutIncludeLocal] = useState(true);
  const [scoutIncludeIndustry, setScoutIncludeIndustry] = useState(true);
  const [scoutIncludeNational, setScoutIncludeNational] = useState(true);
  const [scoutMaxStories, setScoutMaxStories] = useState(10);
  const [scoutEmailSaving, setScoutEmailSaving] = useState(false);
  const [scoutEmailSaved, setScoutEmailSaved] = useState(false);
  const [scoutEmailError, setScoutEmailError] = useState('');
  const [scoutEmailLoaded, setScoutEmailLoaded] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  // Load business-level content settings when active business changes
  const loadSettings = useCallback(async () => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId || status !== 'authenticated') {
      setLoading(false);
      return;
    }
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

  // Load scout email settings when business changes
  const loadScoutEmailSettings = useCallback(async () => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId || status !== 'authenticated') return;
    try {
      const res = await fetch(`/api/businesses/${bizId}/scout-email-settings`);
      if (!res.ok) return;
      const data = await res.json();
      const s = data.settings;
      setScoutEmailEnabled(s.enabled ?? false);
      setScoutRecipient(s.recipientEmail ?? '');
      setScoutSendTime(s.sendTimeUtc ?? '14:00');
      setScoutIncludeLocal(s.includeLocal ?? true);
      setScoutIncludeIndustry(s.includeIndustry ?? true);
      setScoutIncludeNational(s.includeNational ?? true);
      setScoutMaxStories(s.maxStories ?? 10);
      setScoutEmailLoaded(true);
    } catch {}
  }, [bizCtx.activeBusiness?.id, status]);

  useEffect(() => {
    loadScoutEmailSettings();
  }, [loadScoutEmailSettings]);

  const saveScoutEmailSettings = async () => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId) return;
    setScoutEmailSaving(true);
    setScoutEmailError('');
    setScoutEmailSaved(false);
    try {
      const res = await fetch(`/api/businesses/${bizId}/scout-email-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: scoutEmailEnabled,
          recipientEmail: scoutRecipient,
          sendTimeUtc: scoutSendTime,
          includeLocal: scoutIncludeLocal,
          includeIndustry: scoutIncludeIndustry,
          includeNational: scoutIncludeNational,
          maxStories: scoutMaxStories,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save');
      }
      setScoutEmailSaved(true);
    } catch (e: any) {
      setScoutEmailError(e.message || 'Failed to save');
    } finally {
      setScoutEmailSaving(false);
    }
  };

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

  // ── Scout Stories → call Clark Kent API and show picker on THIS page
  const handleScoutStories = async () => {
    if (contentMode !== 'local_only' && selected.size === 0) {
      setError('Select at least one content category before scouting stories.');
      return;
    }
    setScouting(true);
    setError('');
    setScoutResult(null);
    setShowStoryPicker(false);
    setStoryCards([]);
    setSelectedStoryIds(new Set());
    setSelectionError(null);

    try {
      // Auto-save if anything changed
      if (needsSave()) {
        const ok = await saveSettings(true);
        if (!ok) {
          setError('Failed to save content settings. Please try again.');
          setScouting(false);
          return;
        }
      }

      // Call Clark Kent scout API directly
      const activeBusinessId = bizCtx.activeBusiness?.id;
      const scoutBody: Record<string, any> = { contentSourceMode: contentMode };
      if (activeBusinessId) scoutBody.businessId = activeBusinessId;

      console.log('[FeedScout] Request:', JSON.stringify(scoutBody));
      const scoutRes = await fetch('/api/rss/clark-kent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoutBody),
      });
      const scoutData = await scoutRes.json();
      console.log('[FeedScout] Response meta:', JSON.stringify(scoutData.meta));
      if (!scoutRes.ok) throw new Error(scoutData.error || 'Scout failed');

      setScoutBriefData(scoutData.brief);
      const brief = scoutData.brief;
      const meta = scoutData.meta;
      const cards: StoryCard[] = [];
      const tradeCity = brief?.tradeArea?.city || '';
      const includesLocal = contentMode !== 'interests_only';
      const includesInterests = contentMode !== 'local_only';

      // Local RSS stories
      if (includesLocal && brief?.rssBrief?.headlines?.length > 0) {
        for (const h of brief.rssBrief.headlines.slice(0, 8)) {
          cards.push({
            id: h.id || `local-${h.title?.slice(0, 20)}`,
            title: h.title,
            source: h.source,
            sourceType: 'local',
            section: 'local',
            pubDate: h.pubDate || '',
            summary: `${h.sourceType === 'weather' ? 'Weather alert' : 'Local news'} from ${h.source}`,
            relevance: tradeCity ? `Relevant to your ${tradeCity} trade area` : 'Local trade area news',
            link: h.link || '',
          });
        }
      }

      // Industry/interest stories
      if (includesInterests && brief?.interestBrief?.categories?.length > 0) {
        for (const cat of brief.interestBrief.categories) {
          for (const h of (cat.headlines || []).slice(0, 3)) {
            cards.push({
              id: h.id || `${cat.industry}-${h.title?.slice(0, 20)}`,
              title: h.title,
              source: h.source,
              sourceType: 'industry',
              section: 'industry',
              pubDate: h.pubDate || '',
              summary: `Industry news in ${cat.label}`,
              relevance: `Matches your selected interest: ${cat.label}`,
              link: h.link || '',
              category: cat.label,
            });
          }
        }
      }

      // Upcoming events
      if (brief?.upcomingEvents?.length > 0) {
        for (const e of brief.upcomingEvents.slice(0, 4)) {
          cards.push({
            id: e.id || `event-${e.name?.slice(0, 20)}`,
            title: e.name,
            source: 'Holiday Calendar',
            sourceType: 'national',
            section: 'event',
            pubDate: e.date || '',
            summary: e.ideas || 'Upcoming holiday or event',
            relevance: 'Seasonal content opportunity for engagement',
            link: '',
          });
        }
      }

      console.log(`[FeedScout] Cards built: ${cards.length} total`);
      setStoryCards(cards);
      setShowStoryPicker(true);

      if (cards.length > 0) {
        const sectionNames = [...new Set(cards.map(c => c.section))];
        setScoutResult({
          message: `Found ${cards.length} stories across ${sectionNames.length} ${sectionNames.length === 1 ? 'category' : 'categories'}. Select up to ${MAX_STORIES} to turn into posts.`,
          meta,
        });
      } else {
        setScoutResult({
          message: 'No stories found for the selected scouting mode. Try a different mode or check your content settings.',
          meta,
        });
      }
    } catch (e: any) {
      console.error('Scout error:', e);
      setError(e.message || 'Something went wrong. Please try again.');
    }
    setScouting(false);
  };

  const toggleStory = (id: string) => {
    setSelectionError(null);
    setSelectedStoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_STORIES) {
          setSelectionError(`You can select up to ${MAX_STORIES} stories. Deselect one first.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  // Create Posts from selected stories → navigate to Social Queue
  const handleCreatePosts = () => {
    if (!scoutBriefData || selectedStoryIds.size === 0) return;
    // Store the brief + selected IDs in sessionStorage so Social Queue can pick them up
    const payload = {
      brief: scoutBriefData,
      selectedIds: Array.from(selectedStoryIds),
      contentSourceMode: contentMode,
    };
    try {
      sessionStorage.setItem('feedScoutPayload', JSON.stringify(payload));
    } catch {}
    // Navigate to Social Queue with create flag
    router.push('/dashboard/social?fromFeeds=1');
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
              disabled={saving || scouting}
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
              onClick={handleScoutStories}
              disabled={scouting || saving || (contentMode !== 'local_only' && selected.size === 0)}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {scouting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {scouting ? 'Scouting...' : 'Scout Stories'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Story Picker (shown after scouting) ──────────────────────── */}
      {showStoryPicker && (() => {
        const localCards = storyCards.filter(c => c.section === 'local');
        const industryCards = storyCards.filter(c => c.section === 'industry');
        const eventCards = storyCards.filter(c => c.section === 'event');
        const includesLocal = contentMode !== 'interests_only';
        const includesInterests = contentMode !== 'local_only';
        const sections = [
          ...(includesLocal ? [{ key: 'local', label: '📍 Local Stories', cards: localCards }] : []),
          ...(includesInterests ? [{ key: 'industry', label: '🏢 Industry Stories', cards: industryCards }] : []),
          { key: 'event', label: '🎉 Upcoming Events', cards: eventCards },
        ];

        return (
          <div className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Pick Your Stories</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {scoutResult?.message || `Select up to ${MAX_STORIES} stories to turn into social posts`}
                </p>
              </div>
              <button
                onClick={() => { setShowStoryPicker(false); setStoryCards([]); setSelectionError(null); setScoutResult(null); }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {sections.map(sec => (
                <div key={sec.key} className="px-5 py-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">{sec.label}</p>
                  {sec.cards.length === 0 && (
                    <p className="text-xs text-gray-400 italic py-2">No stories found in this category.</p>
                  )}
                  <div className="space-y-2">
                    {sec.cards.map(card => {
                      const isSelected = selectedStoryIds.has(card.id);
                      const typeBadgeMap: Record<string, { bg: string; text: string }> = {
                        local: { bg: 'bg-green-100', text: 'text-green-700' },
                        industry: { bg: 'bg-purple-100', text: 'text-purple-700' },
                        national: { bg: 'bg-gray-200', text: 'text-gray-600' },
                      };
                      const typeBadge = typeBadgeMap[card.sourceType] || typeBadgeMap.national;
                      return (
                        <button
                          key={card.id}
                          onClick={() => toggleStory(card.id)}
                          className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-all ${
                            isSelected
                              ? 'border-blue-300 bg-blue-50 shadow-sm'
                              : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                          }`}
                        >
                          <div className={`mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center ${
                            isSelected ? 'bg-blue-600 text-white' : 'border-2 border-gray-300'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm leading-snug ${isSelected ? 'text-gray-900 font-medium' : 'text-gray-700'}`}>
                              {card.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                              {card.source && <span className="text-xs text-gray-500">{card.source}</span>}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${typeBadge.bg} ${typeBadge.text}`}>
                                {card.sourceType}
                              </span>
                              {card.category && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{card.category}</span>
                              )}
                              {card.pubDate && <span className="text-xs text-gray-400">{card.pubDate.split('T')[0]}</span>}
                            </div>
                            {card.summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{card.summary}</p>}
                            {card.relevance && <p className="text-xs text-blue-600 mt-0.5 italic">{card.relevance}</p>}
                            {card.link && (
                              <a href={card.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1">
                                Source <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
              {selectionError && <p className="text-xs text-red-600 mb-2 font-medium">{selectionError}</p>}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {selectedStoryIds.size} of {MAX_STORIES} max selected
                  {selectedStoryIds.size === 0 && <span className="text-amber-600 ml-1">— select at least 1 story</span>}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowStoryPicker(false); setStoryCards([]); setSelectionError(null); setScoutResult(null); }}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
                  >Cancel</button>
                  <button
                    onClick={handleCreatePosts}
                    disabled={selectedStoryIds.size === 0 || creating}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {creating ? 'Creating...' : `Create ${selectedStoryIds.size} Post${selectedStoryIds.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <p className="text-center text-xs text-gray-400 mb-8">
        {contentMode === 'local_only'
          ? 'Posts will be generated using hyper-local news from your business\'s trade area and upcoming events.'
          : contentMode === 'interests_only'
            ? 'Posts will be generated using national interest feeds and upcoming events — no ZIP code required.'
            : 'Your selected feeds will be mixed with local news, giving your content a national-trending angle alongside hyper-local stories.'}
      </p>

      {/* ── Daily Scout Report Email Settings ──────────────────────────── */}
      {bizCtx.activeBusiness && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <button
            onClick={() => setShowScoutEmail(!showScoutEmail)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-blue-600" />
              <div className="text-left">
                <h3 className="text-sm font-semibold text-gray-800">Daily Scout Report Email</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {scoutEmailEnabled ? 'Enabled — receiving daily story recommendations' : 'Get story recommendations delivered to your inbox'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {scoutEmailEnabled && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">ON</span>
              )}
              {showScoutEmail ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>

          {showScoutEmail && (
            <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
              {/* Enable toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={scoutEmailEnabled}
                    onChange={(e) => { setScoutEmailEnabled(e.target.checked); setScoutEmailSaved(false); }}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${
                    scoutEmailEnabled ? 'bg-blue-600' : 'bg-gray-300'
                  }`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform mt-1 ${
                      scoutEmailEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`} />
                  </div>
                </div>
                <span className="text-sm font-medium text-gray-700">Enable Daily Scout Report</span>
              </label>

              {/* Recipient email */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recipient email</label>
                <input
                  type="email"
                  value={scoutRecipient}
                  onChange={(e) => { setScoutRecipient(e.target.value); setScoutEmailSaved(false); }}
                  placeholder="you@business.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Send time */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Preferred send time (UTC)
                </label>
                <input
                  type="time"
                  value={scoutSendTime}
                  onChange={(e) => { setScoutSendTime(e.target.value); setScoutEmailSaved(false); }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Story sections to include */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Include in report</label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: '📍 Local Stories', checked: scoutIncludeLocal, setter: setScoutIncludeLocal },
                    { label: '🏢 Industry Stories', checked: scoutIncludeIndustry, setter: setScoutIncludeIndustry },
                    { label: '🎉 National & Events', checked: scoutIncludeNational, setter: setScoutIncludeNational },
                  ].map(opt => (
                    <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={opt.checked}
                        onChange={(e) => { opt.setter(e.target.checked); setScoutEmailSaved(false); }}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Max stories */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Max stories per report</label>
                <select
                  value={scoutMaxStories}
                  onChange={(e) => { setScoutMaxStories(Number(e.target.value)); setScoutEmailSaved(false); }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {[5, 10, 15, 20, 25].map(n => (
                    <option key={n} value={n}>{n} stories</option>
                  ))}
                </select>
              </div>

              {/* Save button */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={saveScoutEmailSettings}
                  disabled={scoutEmailSaving}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {scoutEmailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {scoutEmailSaving ? 'Saving...' : 'Save Email Settings'}
                </button>
                {scoutEmailSaved && (
                  <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                    <Check className="w-4 h-4" /> Saved!
                  </span>
                )}
                {scoutEmailError && (
                  <span className="text-sm text-red-500">{scoutEmailError}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}