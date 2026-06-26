'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, Send, Clock, CheckCircle2, XCircle, Edit3,
  Hash, CalendarDays, Zap, RefreshCw, ImageIcon, FileText,
  Facebook, Instagram, Linkedin, ChevronRight, AlertCircle,
  Save, RotateCcw, Link2, Building2, Plus, Settings, Power,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import { BusinessPickerGrid, ActiveBusinessBanner } from '@/components/business-picker';

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  task_id: number;
  summary: string;
  created_at: string;
  status: string;
  preview_text: string;
  first_image_url: string | null;
  publish_status: string;
  campaign_names?: string[];
  caption_preview?: string | null;
}

interface ContentDetail {
  task_id: number;
  summary: string;
  created_at: string;
  status: string;
  base_caption: string | null;
  platform_variants: any[] | null;
  hashtags: string[] | null;
  cta: string | null;
  image_urls: string[];
  raw_output: string | null;
}

interface OriginalContent {
  caption: string;
  hashtags: string;
  cta: string;
  platformCaptions: Record<string, string>;
}

interface GhlSocialAccount {
  id: string;
  name: string;
  platform: string;
  type: string;
  originId: string;
  avatar: string;
  isExpired: boolean;
  isDefault: boolean;
}

interface GhlAccountsStatus {
  connected: boolean;
  reason: string;
  message: string;
}

interface InlineToast {
  type: 'success' | 'error';
  message: string;
}

const PUBLISH_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  ready: { label: 'Ready', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100', icon: Edit3 },
  pending: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-50', icon: Clock },
  scheduled: { label: 'Scheduled', color: 'text-amber-700', bg: 'bg-amber-50', icon: Clock },
  posted: { label: 'Posted', color: 'text-blue-700', bg: 'bg-blue-50', icon: Send },
  failed: { label: 'Failed', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
};

function safeDate(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  } catch {
    return '';
  }
}

/**
 * Extract a meaningful, human-readable title from queue item data.
 * Uses enriched campaign_names first, then falls back to summary parsing.
 */
function extractPostTitle(item: QueueItem): string {
  // Use campaign names if available (from enriched API response)
  if (item.campaign_names && item.campaign_names.length > 0) {
    // Shorten long campaign names
    const name = item.campaign_names[0];
    if (name.length > 40) return name.slice(0, 38) + '…';
    return name;
  }

  const summary = item.summary || '';

  // Try to find holiday/event names from the UPCOMING EVENTS section
  const eventsMatch = summary.match(/UPCOMING EVENTS[\s\S]*?--- END/);
  if (eventsMatch) {
    const eventNames: string[] = [];
    const eventRegex = /[\u2022\u00b7•]\s+(.+?)\s+\(/g;
    let m;
    while ((m = eventRegex.exec(eventsMatch[0])) !== null) {
      eventNames.push(m[1].trim());
    }
    if (eventNames.length > 0) {
      return eventNames.slice(0, 2).join(' & ') + ' Posts';
    }
  }

  // Try to extract the business URL as context
  const urlMatch = summary.match(/for https?:\/\/([^\s/]+)/);
  if (urlMatch) {
    return `Posts for ${urlMatch[1].replace('www.', '')}`;
  }

  // Multi-campaign render
  if (item.preview_text?.includes('Multi-campaign')) {
    const countMatch = item.preview_text.match(/(\d+) images/);
    return `${countMatch?.[1] || '3'}-Image Campaign`;
  }

  // Derive title from caption preview — use first 5 words
  if (item.caption_preview) {
    const words = item.caption_preview.split(/\s+/).slice(0, 5).join(' ');
    return words.length > 35 ? words.slice(0, 33) + '…' : words + '…';
  }

  return 'Social Post';
}

/**
 * Extract a clean preview snippet — prioritizes caption_preview from enriched data.
 */
function extractPreview(item: QueueItem): string {
  // Use enriched caption preview if available
  if (item.caption_preview) {
    return item.caption_preview;
  }

  const previewText = item.preview_text || '';
  const summary = item.summary || '';

  // If preview is technical, generate something better
  if (/^(Render|Multi-campaign|Generate)/i.test(previewText)) {
    if (previewText.includes('Multi-campaign')) {
      const countMatch = previewText.match(/(\d+) images generated/);
      if (countMatch) return `${countMatch[1]} creative images ready to publish`;
    }
    return 'Creative artwork ready to publish';
  }

  return previewText || 'Ready to publish';
}

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: 'bg-blue-600', ring: 'ring-blue-300' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: 'bg-gradient-to-br from-purple-600 to-pink-500', ring: 'ring-pink-300' },
  { id: 'x', label: 'X', icon: () => <span className="text-xs font-black">𝕏</span>, color: 'bg-black', ring: 'ring-gray-400' },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: 'bg-blue-700', ring: 'ring-blue-300' },
];

// ── Frequency Options ───────────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { value: '1x_week', label: '1× per week', desc: 'Once a week' },
  { value: '2x_week', label: '2× per week', desc: 'Twice a week' },
  { value: '3x_week', label: '3× per week', desc: 'Three times a week' },
  { value: '5x_week', label: '5× per week', desc: 'Weekdays' },
  { value: '1x_day', label: '1× daily', desc: 'Once every day' },
  { value: '2x_day', label: '2× daily', desc: 'Twice a day' },
  { value: '3x_day', label: '3× daily', desc: 'Three times a day' },
];

const TIME_OPTIONS = [
  { value: '06:00', label: '6:00 AM' },
  { value: '07:00', label: '7:00 AM' },
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '11:00', label: '11:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '13:00', label: '1:00 PM' },
  { value: '14:00', label: '2:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '16:00', label: '4:00 PM' },
  { value: '17:00', label: '5:00 PM' },
  { value: '18:00', label: '6:00 PM' },
  { value: '19:00', label: '7:00 PM' },
  { value: '20:00', label: '8:00 PM' },
  { value: '21:00', label: '9:00 PM' },
];

// ── Auto-Publish Settings Panel ─────────────────────────────────────────────

function AutoPublishSettingsPanel({
  loading, saving, enabled, frequency, preferredTime, platforms, toast,
  onToggleEnabled, onFrequencyChange, onTimeChange, onTogglePlatform, onSave,
}: {
  loading: boolean;
  saving: boolean;
  enabled: boolean;
  frequency: string;
  preferredTime: string;
  platforms: string[];
  toast: InlineToast | null;
  onToggleEnabled: () => void;
  onFrequencyChange: (f: string) => void;
  onTimeChange: (t: string) => void;
  onTogglePlatform: (p: string) => void;
  onSave: () => void;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span className="ml-2 text-sm text-gray-500">Loading settings…</span>
        </div>
      </div>
    );
  }

  const currentFreq = FREQUENCY_OPTIONS.find(f => f.value === frequency);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
      {/* Toggle + Status */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleEnabled}
            disabled={saving}
            className="flex items-center gap-0 focus:outline-none disabled:opacity-50"
            aria-label={enabled ? 'Disable auto-posting' : 'Enable auto-posting'}
          >
            {enabled
              ? <ToggleRight className="w-10 h-10 text-emerald-500" />
              : <ToggleLeft className="w-10 h-10 text-gray-300" />
            }
          </button>
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Auto-Posting {enabled ? <span className="text-emerald-600">Active</span> : <span className="text-gray-400">Off</span>}
            </h3>
            <p className="text-xs text-gray-500">
              {enabled
                ? `Posting ${currentFreq?.desc?.toLowerCase() || frequency} at ${TIME_OPTIONS.find(t => t.value === preferredTime)?.label || preferredTime}`
                : 'Enable to automatically publish approved posts to your social channels'
              }
            </p>
          </div>
        </div>
        {enabled && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Power className="w-3 h-3" /> Live
          </span>
        )}
      </div>

      {/* Settings grid — only visible when enabled */}
      {enabled && (
        <div className="space-y-5">
          {/* Frequency */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Posting Frequency</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {FREQUENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onFrequencyChange(opt.value)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-all text-center ${
                    frequency === opt.value
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time of Day */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Preferred Time of Day</label>
            <p className="text-[11px] text-gray-400 mb-2">First post of the day will be scheduled near this time. Additional posts are spread evenly throughout the day.</p>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {TIME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onTimeChange(opt.value)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all text-center ${
                    preferredTime === opt.value
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Platforms */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Publish To</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => {
                const Icon = p.icon;
                const isOn = platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => onTogglePlatform(p.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                      isOn
                        ? `${p.color} text-white border-transparent ring-2 ${p.ring} shadow-sm`
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Save button + toast */}
          <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {toast && (
              <span className={`text-sm font-medium ${
                toast.type === 'success' ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {toast.type === 'success' ? '✓' : '✕'} {toast.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function PublishingDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const [showPicker, setShowPicker] = useState(false);

  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Selected item state
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Editor state
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editCta, setEditCta] = useState('');
  const [editPlatformCaptions, setEditPlatformCaptions] = useState<Record<string, string>>({});

  // Original content snapshot (set when detail loads or save succeeds)
  const [originalContent, setOriginalContent] = useState<OriginalContent | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [inlineToast, setInlineToast] = useState<InlineToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dirty detection — true when any editor field differs from original
  const isDirty = useMemo(() => {
    if (!originalContent) return false;
    if (editCaption !== originalContent.caption) return true;
    if (editHashtags !== originalContent.hashtags) return true;
    if (editCta !== originalContent.cta) return true;
    // Compare platform captions
    const origKeys = Object.keys(originalContent.platformCaptions);
    const editKeys = Object.keys(editPlatformCaptions);
    if (origKeys.length !== editKeys.length) return true;
    for (const k of origKeys) {
      if ((editPlatformCaptions[k] ?? '') !== (originalContent.platformCaptions[k] ?? '')) return true;
    }
    // Check for new keys in edit that don't exist in original
    for (const k of editKeys) {
      if (editPlatformCaptions[k] && !originalContent.platformCaptions[k]) return true;
    }
    return false;
  }, [editCaption, editHashtags, editCta, editPlatformCaptions, originalContent]);

  // Show inline toast with auto-dismiss
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setInlineToast({ type, message });
    toastTimer.current = setTimeout(() => setInlineToast(null), 4000);
  }, []);

  // Publish controls state — keyed by unique GHL account ID, not platform
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [scheduleTime, setScheduleTime] = useState('');
  const [publishing, setPublishing] = useState(false);

  // GHL Social Planner accounts (replaces direct linking)
  const [ghlAccounts, setGhlAccounts] = useState<GhlSocialAccount[]>([]);
  const [ghlAccountsLoading, setGhlAccountsLoading] = useState(false);
  const [ghlAccountsStatus, setGhlAccountsStatus] = useState<GhlAccountsStatus | null>(null);

  // Auto-publish settings state
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [frequency, setFrequency] = useState('3x_week');
  const [preferredTime, setPreferredTime] = useState('10:00');
  const [publishPlatforms, setPublishPlatforms] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsToast, setSettingsToast] = useState<InlineToast | null>(null);
  const settingsToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Auth guard
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // ── Fetch queue ────────────────────────────────────────────────────────────

  const activeBusinessId = bizCtx.activeBusiness?.id;

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (activeBusinessId) params.set('businessId', activeBusinessId);
      const res = await fetch(`/api/content/queue?${params}`);
      if (!res.ok) throw new Error('Failed to load content queue');
      const data = await res.json();
      setQueue(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setQueueError(e.message);
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    if (sessionStatus === 'authenticated' && !bizCtx.loading) fetchQueue();
  }, [sessionStatus, bizCtx.loading, fetchQueue]);

  // ── Fetch GHL social accounts ────────────────────────────────────────────────

  const fetchGhlAccounts = useCallback(async () => {
    if (!activeBusinessId) { setGhlAccounts([]); setGhlAccountsStatus(null); return; }
    setGhlAccountsLoading(true);
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/ghl/social-accounts`);
      const data = await res.json();
      setGhlAccounts(data.accounts || []);
      setGhlAccountsStatus({ connected: data.connected, reason: data.reason, message: data.message });
    } catch {
      setGhlAccounts([]);
      setGhlAccountsStatus({ connected: false, reason: 'error', message: 'Failed to load Launch CRM accounts.' });
    } finally {
      setGhlAccountsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    if (sessionStatus === 'authenticated' && activeBusinessId) fetchGhlAccounts();
  }, [sessionStatus, activeBusinessId, fetchGhlAccounts]);

  // ── Fetch auto-publish settings ─────────────────────────────────────────────

  const fetchPublishSettings = useCallback(async () => {
    if (!activeBusinessId) return;
    setSettingsLoading(true);
    try {
      const res = await fetch(`/api/publish/settings?businessId=${activeBusinessId}`);
      if (res.ok) {
        const data = await res.json();
        setAutoPublishEnabled(data.autoPublish ?? false);
        setFrequency(data.frequency ?? '3x_week');
        setPreferredTime(data.preferredTime ?? '10:00');
        setPublishPlatforms(Array.isArray(data.platforms) ? data.platforms : []);
      }
    } catch (e) {
      console.error('[fetchPublishSettings] error:', e);
    } finally {
      setSettingsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    if (sessionStatus === 'authenticated' && activeBusinessId) fetchPublishSettings();
  }, [sessionStatus, activeBusinessId, fetchPublishSettings]);

  const savePublishSettings = useCallback(async (overrides?: Partial<{ autoPublish: boolean; frequency: string; preferredTime: string; platforms: string[] }>) => {
    if (!activeBusinessId || settingsSaving) return;
    setSettingsSaving(true);
    if (settingsToastTimer.current) clearTimeout(settingsToastTimer.current);
    setSettingsToast(null);
    try {
      const payload = {
        businessId: activeBusinessId,
        autoPublish: overrides?.autoPublish ?? autoPublishEnabled,
        frequency: overrides?.frequency ?? frequency,
        preferredTime: overrides?.preferredTime ?? preferredTime,
        platforms: overrides?.platforms ?? publishPlatforms,
      };
      const res = await fetch('/api/publish/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(err.error || 'Save failed');
      }
      const data = await res.json();
      setAutoPublishEnabled(data.autoPublish);
      setFrequency(data.frequency);
      setPreferredTime(data.preferredTime);
      setPublishPlatforms(data.platforms);
      setSettingsToast({ type: 'success', message: 'Publishing settings saved' });
    } catch (e: any) {
      setSettingsToast({ type: 'error', message: e.message || 'Failed to save settings' });
    } finally {
      setSettingsSaving(false);
      settingsToastTimer.current = setTimeout(() => setSettingsToast(null), 4000);
    }
  }, [activeBusinessId, settingsSaving, autoPublishEnabled, frequency, preferredTime, publishPlatforms]);

  const toggleAutoPublish = useCallback(async () => {
    const newValue = !autoPublishEnabled;
    setAutoPublishEnabled(newValue);
    await savePublishSettings({ autoPublish: newValue });
  }, [autoPublishEnabled, savePublishSettings]);

  const togglePublishPlatform = useCallback((platformId: string) => {
    setPublishPlatforms(prev => {
      const next = prev.includes(platformId)
        ? prev.filter(p => p !== platformId)
        : [...prev, platformId];
      return next;
    });
  }, []);

  // ── Fetch detail ───────────────────────────────────────────────────────────

  const fetchDetail = useCallback(async (taskId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/content/${taskId}`);
      if (!res.ok) throw new Error('Failed to load content detail');
      const data: ContentDetail = await res.json();
      setDetail(data);

      // Populate editor fields — fall back to raw_output snippet for caption
      const caption = data.base_caption
        || (data.raw_output ? data.raw_output.slice(0, 300) : '');
      setEditCaption(caption);
      setEditHashtags(Array.isArray(data.hashtags) ? data.hashtags.join(' ') : '');
      setEditCta(data.cta || '');

      // Platform-specific captions from variants (defensive: array or object)
      const pc: Record<string, string> = {};
      if (Array.isArray(data.platform_variants)) {
        for (const v of data.platform_variants) {
          if (v && typeof v === 'object' && v.platform && v.caption) {
            pc[v.platform] = v.caption;
          }
        }
      } else if (data.platform_variants && typeof data.platform_variants === 'object') {
        // Handle dict format: { facebook: "...", instagram: "..." }
        for (const [k, v] of Object.entries(data.platform_variants as any)) {
          if (typeof v === 'string') pc[k] = v;
        }
      }
      setEditPlatformCaptions(pc);

      // Snapshot for dirty detection & reset
      setOriginalContent({ caption, hashtags: Array.isArray(data.hashtags) ? data.hashtags.join(' ') : '', cta: data.cta || '', platformCaptions: { ...pc } });
    } catch (e: any) {
      console.error('Detail fetch error:', e);
      setDetailError(e.message || 'Failed to load content');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectItem = (taskId: number) => {
    setSelectedTaskId(taskId);
    setSelectedAccountIds(new Set());
    setScheduleTime('');
    fetchDetail(taskId);
  };

  // ── Channel toggle (by unique account ID) ────────────────────────────

  const toggleAccountId = (accountId: string) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  // ── Save edits to Tombstone ───────────────────────────────────────────────

  const saveEdits = useCallback(async () => {
    if (!selectedTaskId || !originalContent || saving) return;

    // Build partial payload — only include fields that changed
    const payload: Record<string, any> = {};
    if (editCaption !== originalContent.caption) payload.caption = editCaption;
    if (editCta !== originalContent.cta) payload.cta = editCta;
    if (editHashtags !== originalContent.hashtags) {
      payload.hashtags = editHashtags
        .split(/\s+/)
        .map(h => h.trim())
        .filter(Boolean);
    }
    // Check platform_variants
    const pvChanged = Object.keys(editPlatformCaptions).some(
      k => (editPlatformCaptions[k] ?? '') !== (originalContent.platformCaptions[k] ?? '')
    ) || Object.keys(originalContent.platformCaptions).some(
      k => (editPlatformCaptions[k] ?? '') !== (originalContent.platformCaptions[k] ?? '')
    );
    if (pvChanged) {
      // Send as dict — backend expects { facebook: "...", instagram: "..." }
      const pv: Record<string, string> = {};
      for (const [k, v] of Object.entries(editPlatformCaptions)) {
        if (v) pv[k] = v;
      }
      payload.platform_variants = pv;
    }

    if (Object.keys(payload).length === 0) {
      console.warn('[saveEdits] payload empty — nothing to save');
      return;
    }

    const saveUrl = `/api/content/${selectedTaskId}`;

    setSaving(true);
    setInlineToast(null);

    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resBody = await res.json().catch(() => ({ error: 'Unparseable response' }));

      if (!res.ok) {
        throw new Error(resBody.error || `Save failed (${res.status})`);
      }
      // Success — update original snapshot to match current edits
      setOriginalContent({
        caption: editCaption,
        hashtags: editHashtags,
        cta: editCta,
        platformCaptions: { ...editPlatformCaptions },
      });
      showToast('success', `Draft saved (${resBody.storage_status || 'ok'})`);
    } catch (e: any) {
      console.error('[saveEdits] error:', e);
      showToast('error', e.message || 'Failed to save edits');
    } finally {
      setSaving(false);
    }
  }, [selectedTaskId, originalContent, saving, editCaption, editHashtags, editCta, editPlatformCaptions, showToast]);

  // ── Reset edits to original ─────────────────────────────────────────────

  const resetEdits = useCallback(() => {
    if (!originalContent) return;
    setEditCaption(originalContent.caption);
    setEditHashtags(originalContent.hashtags);
    setEditCta(originalContent.cta);
    setEditPlatformCaptions({ ...originalContent.platformCaptions });
    setInlineToast(null);
  }, [originalContent]);

  // ── Publish content to selected platforms ──────────────────────────────────

  const publishContent = useCallback(async (mode: 'now' | 'schedule') => {
    if (!selectedTaskId || publishing) return;
    if (selectedAccountIds.size === 0) {
      showToast('error', 'Select at least one channel');
      return;
    }
    if (mode === 'schedule' && !scheduleTime) {
      showToast('error', 'Set a schedule time first');
      return;
    }

    // Build content from current editor state (not stale original)
    const hashtags = editHashtags
      .split(/\s+/)
      .map(h => h.trim())
      .filter(Boolean);

    const pv: Record<string, string> = {};
    for (const [k, v] of Object.entries(editPlatformCaptions)) {
      if (v) pv[k] = v;
    }

    const payload: Record<string, any> = {
      accountIds: Array.from(selectedAccountIds),
      content: {
        caption: editCaption || null,
        platform_variants: Object.keys(pv).length > 0 ? pv : null,
        hashtags: hashtags.length > 0 ? hashtags : null,
        cta: editCta || null,
      },
    };
    if (mode === 'schedule') {
      payload.scheduled_time = scheduleTime;
    }

    const publishUrl = `/api/publish/${selectedTaskId}`;

    setPublishing(true);
    setInlineToast(null);

    try {
      const res = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resBody = await res.json().catch(() => ({ error: 'Unparseable response' }));

      if (!res.ok) {
        throw new Error(resBody.error || `Publish failed (${res.status})`);
      }

      const channelCount = payload.accountIds.length;
      const statusLabel = mode === 'schedule' ? 'scheduled' : 'queued';
      showToast('success', `${channelCount} channel(s) ${statusLabel} successfully`);

      // Update local queue item status
      setQueue(prev => prev.map(item =>
        item.task_id === selectedTaskId
          ? { ...item, publish_status: mode === 'schedule' ? 'scheduled' : 'pending' }
          : item
      ));

      // Clear channel selection + schedule after success
      setSelectedAccountIds(new Set());
      setScheduleTime('');

      // Refresh queue in background to pick up accurate server state
      fetchQueue();
    } catch (e: any) {
      console.error('[publishContent] error:', e);
      showToast('error', e.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [selectedTaskId, publishing, selectedAccountIds, scheduleTime, editCaption, editHashtags, editCta, editPlatformCaptions, showToast, fetchQueue]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const StatusBadge = ({ publishStatus }: { publishStatus: string }) => {
    const cfg = PUBLISH_STATUS_CONFIG[publishStatus] || PUBLISH_STATUS_CONFIG.ready;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
        <Icon className="w-3 h-3" />
        {cfg.label}
      </span>
    );
  };

  // ── Loading / auth states ──────────────────────────────────────────────────

  if (sessionStatus === 'loading' || bizCtx.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (sessionStatus !== 'authenticated') return null;

  // No businesses at all
  if (bizCtx.noBusiness) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Found</h2>
        <p className="text-gray-500 mb-6">Analyze a website first so we know which business to show content for.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> Add a Business
        </button>
      </div>
    );
  }

  // Multiple businesses and none selected
  if (bizCtx.needsSelection || showPicker) {
    return (
      <BusinessPickerGrid
        businesses={bizCtx.businesses}
        onSelect={(biz) => { bizCtx.setActiveBusiness(biz); setShowPicker(false); }}
      />
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Active business banner */}
      {bizCtx.activeBusiness && (
        <ActiveBusinessBanner
          activeBusiness={bizCtx.activeBusiness}
          businessCount={bizCtx.businesses.length}
          onSwitch={() => setShowPicker(true)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Publish Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review, edit, and auto-publish your social posts via Launch CRM
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showSettings
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            Auto-Publish Settings
          </button>
          <button
            onClick={fetchQueue}
            disabled={queueLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Auto-Publish Settings Panel */}
      {showSettings && (
        <AutoPublishSettingsPanel
          loading={settingsLoading}
          saving={settingsSaving}
          enabled={autoPublishEnabled}
          frequency={frequency}
          preferredTime={preferredTime}
          platforms={publishPlatforms}
          toast={settingsToast}
          onToggleEnabled={toggleAutoPublish}
          onFrequencyChange={(f) => setFrequency(f)}
          onTimeChange={(t) => setPreferredTime(t)}
          onTogglePlatform={togglePublishPlatform}
          onSave={() => savePublishSettings()}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left: Content Queue ──────────────────────────────────────── */}
        <div className="lg:col-span-4 xl:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Content Queue</h2>
                <span className="text-xs text-gray-400">{queue.length} items</span>
              </div>
              {autoPublishEnabled && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-emerald-600 font-medium">
                    Auto-posting {FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label || frequency}
                  </span>
                </div>
              )}
            </div>

            {queueLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : queueError ? (
              <div className="p-4 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-red-600">{queueError}</p>
                <button onClick={fetchQueue} className="mt-2 text-xs text-blue-600 underline">Retry</button>
              </div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No publish-ready content yet</p>
                <p className="text-xs text-gray-400 mt-1">Generate ads to see them here</p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-gray-50">
                {queue.map(item => (
                  <button
                    key={item.task_id}
                    onClick={() => selectItem(item.task_id)}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50/50 transition-colors ${
                      selectedTaskId === item.task_id
                        ? 'bg-blue-50 border-l-2 border-blue-600'
                        : 'border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex flex-col gap-2">
                      {/* Image preview — full width, natural aspect ratio */}
                      {item.first_image_url ? (
                        <div className="w-full aspect-[4/5] rounded-lg bg-gray-100 overflow-hidden relative">
                          <Image
                            src={item.first_image_url}
                            alt={extractPostTitle(item)}
                            fill
                            className="object-contain"
                            sizes="240px"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-full aspect-video rounded-lg bg-gray-100 flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-gray-300" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {extractPostTitle(item)}
                          </p>
                          <ChevronRight className={`w-4 h-4 flex-shrink-0 ${
                            selectedTaskId === item.task_id ? 'text-blue-500' : 'text-gray-300'
                          }`} />
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                          {extractPreview(item)}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusBadge publishStatus={item.publish_status} />
                          <span className="text-[10px] text-gray-400">
                            {safeDate(item.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Editor + Publish Controls ─────────────────────────── */}
        <div className="lg:col-span-8 xl:col-span-9">
          {!selectedTaskId ? (
            /* Empty state */
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[500px]">
              <div className="text-center px-8">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700">Select a post</h3>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">
                  Choose an item from the content queue to preview, edit, and schedule for publishing.
                </p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[500px]">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : detailError || !detail ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[500px]">
              <div className="text-center px-8">
                <AlertCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
                <p className="text-sm text-red-600">{detailError || 'Failed to load content details'}</p>
                {selectedTaskId && (
                  <button
                    onClick={() => fetchDetail(selectedTaskId)}
                    className="mt-3 text-xs text-blue-600 underline hover:text-blue-700"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Image Preview — full post preview ─────────────────── */}
              {Array.isArray(detail.image_urls) && detail.image_urls.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Images</h3>
                  <div className={`grid gap-4 ${detail.image_urls.length === 1 ? 'grid-cols-1 max-w-md' : detail.image_urls.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
                    {detail.image_urls.map((url, i) => (
                      <div key={i} className="rounded-xl bg-gray-50 border border-gray-100 overflow-hidden">
                        <div className="relative aspect-[4/5] bg-gray-100">
                          <Image
                            src={url}
                            alt={detail.summary?.slice(0, 50) || `Asset ${i + 1}`}
                            fill
                            className="object-contain"
                            sizes="(max-width: 768px) 100vw, 400px"
                            onError={(e) => {
                              const el = e.target as HTMLImageElement;
                              el.style.display = 'none';
                              el.parentElement?.querySelector('[data-img-fallback]')?.removeAttribute('hidden');
                            }}
                          />
                          <div data-img-fallback hidden className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-gray-300" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Inline Toast ────────────────────────────────────── */}
              {inlineToast && (
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  inlineToast.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {inlineToast.type === 'success'
                    ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    : <XCircle className="w-4 h-4 flex-shrink-0" />
                  }
                  {inlineToast.message}
                  <button onClick={() => setInlineToast(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
                </div>
              )}

              {/* ── Caption Editor ──────────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-700">Caption</h3>
                  {isDirty && (
                    <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Unsaved changes</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-3">Main post caption</p>
                <textarea
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
                  placeholder="Enter post caption..."
                />

                {/* Hashtags */}
                <div className="mt-4">
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-1">
                    <Hash className="w-3.5 h-3.5" /> Hashtags
                  </label>
                  <input
                    value={editHashtags}
                    onChange={(e) => setEditHashtags(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    placeholder="#example #hashtags"
                  />
                </div>

                {/* CTA */}
                <div className="mt-4">
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">Call to Action</label>
                  <input
                    value={editCta}
                    onChange={(e) => setEditCta(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    placeholder="e.g. Book your table today"
                  />
                </div>

                {/* Save / Reset buttons */}
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
                  <button
                    onClick={saveEdits}
                    disabled={!isDirty || saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? 'Saving…' : 'Save Edits'}
                  </button>
                  <button
                    onClick={resetEdits}
                    disabled={!isDirty || saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-gray-600 text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </button>
                </div>
              </div>

              {/* ── Platform Captions ──────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Platform-Specific Captions</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PLATFORMS.map(p => {
                    const Icon = p.icon;
                    return (
                      <div key={p.id}>
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-1">
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-white ${p.color}`}>
                            <Icon className="w-3 h-3" />
                          </span>
                          {p.label}
                        </label>
                        <textarea
                          value={editPlatformCaptions[p.id] || ''}
                          onChange={(e) =>
                            setEditPlatformCaptions(prev => ({ ...prev, [p.id]: e.target.value }))
                          }
                          rows={2}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
                          placeholder={`Custom caption for ${p.label}...`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Publishing Controls (Launch CRM) ─────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Publish</h3>

                {/* Channel selection via Launch CRM */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Publishing Channel</label>
                  {ghlAccountsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                      <Loader2 className="w-4 h-4 animate-spin" /> Checking Launch CRM social accounts…
                    </div>
                  ) : !ghlAccountsStatus?.connected ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-amber-700">Auto-publishing requires Launch CRM.</p>
                      <p className="text-xs text-amber-600 mt-0.5">Connect Launch CRM to publish through its Social Planner, or download the post package and publish manually.</p>
                    </div>
                  ) : ghlAccountsStatus.reason === 'lookup_failed' ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-red-700">Could not load social accounts from Launch CRM.</p>
                      <p className="text-xs text-red-600 mt-0.5">Verify the Launch CRM connection and try again.</p>
                      <button onClick={fetchGhlAccounts} className="text-xs font-medium text-blue-600 hover:text-blue-800 mt-2">Retry →</button>
                    </div>
                  ) : ghlAccounts.length === 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-amber-700">No social accounts connected inside Launch CRM Social Planner.</p>
                      <p className="text-xs text-amber-600 mt-0.5">Connect your social accounts in Launch CRM, then refresh.</p>
                      <button onClick={fetchGhlAccounts} className="text-xs font-medium text-blue-600 hover:text-blue-800 mt-2">Refresh Launch CRM Accounts →</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-emerald-700 font-medium">Connected through Launch CRM:</p>
                      {ghlAccounts.map(acct => {
                        const platformLabel = acct.platform.charAt(0).toUpperCase() + acct.platform.slice(1).replace('_', ' ');
                        const selected = selectedAccountIds.has(acct.id);
                        return (
                          <button
                            key={acct.id}
                            onClick={() => toggleAccountId(acct.id)}
                            disabled={publishing}
                            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border text-left transition-all ${
                              selected ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 bg-white hover:bg-gray-50'
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${
                              acct.platform === 'facebook' ? 'bg-blue-600' : acct.platform === 'instagram' ? 'bg-gradient-to-br from-purple-600 to-pink-500' : acct.platform === 'linkedin' ? 'bg-blue-700' : acct.platform === 'tiktok' ? 'bg-black' : acct.platform === 'google_business' ? 'bg-green-600' : 'bg-gray-500'
                            }`}>
                              {(() => { const PIcon = PLATFORMS.find(p => p.id === acct.platform)?.icon; return PIcon ? <PIcon className="w-4 h-4" /> : <Link2 className="w-4 h-4" />; })()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{platformLabel} — {acct.name}</p>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                            }`}>
                              {selected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Schedule datetime */}
                <div className="mb-5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                    <CalendarDays className="w-3.5 h-3.5" /> Schedule Time (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full sm:w-72 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => publishContent('now')}
                    disabled={selectedAccountIds.size === 0 || publishing || ghlAccounts.length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={selectedAccountIds.size === 0 ? 'Select at least one channel' : 'Post immediately'}
                  >
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {publishing ? 'Publishing…' : 'Post Now'}
                  </button>
                  <button
                    onClick={() => publishContent('schedule')}
                    disabled={selectedAccountIds.size === 0 || !scheduleTime || publishing || ghlAccounts.length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-gray-700 text-sm font-semibold border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!scheduleTime ? 'Set a schedule time first' : selectedAccountIds.size === 0 ? 'Select at least one channel' : 'Schedule post'}
                  >
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                    Schedule
                  </button>
                </div>
                {isDirty && (
                  <p className="text-xs text-amber-600 mt-3">
                    ⚠ You have unsaved caption edits. Publishing will use the current editor content.
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Publishing is handled through Launch CRM Social Planner.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}