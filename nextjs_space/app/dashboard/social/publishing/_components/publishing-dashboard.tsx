'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, Send, Clock, CheckCircle2, XCircle, Edit3,
  Hash, CalendarDays, Zap, RefreshCw, ImageIcon, FileText,
  Facebook, Instagram, Linkedin, ChevronRight, AlertCircle,
  Save, RotateCcw, Link2,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  task_id: number;
  summary: string;
  created_at: string;
  status: string;
  preview_text: string;
  first_image_url: string | null;
  publish_status: string;
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

interface SocialAccountItem {
  id: number;
  platform: string;
  account_name: string;
  connection_status: string;
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

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: 'bg-blue-600', ring: 'ring-blue-300' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: 'bg-gradient-to-br from-purple-600 to-pink-500', ring: 'ring-pink-300' },
  { id: 'x', label: 'X', icon: () => <span className="text-xs font-black">𝕏</span>, color: 'bg-black', ring: 'ring-gray-400' },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: 'bg-blue-700', ring: 'ring-blue-300' },
];

// ── Main Component ───────────────────────────────────────────────────────────

export default function PublishingDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();

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

  // Publish controls state
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [scheduleTime, setScheduleTime] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Connected accounts state
  const [connectedAccounts, setConnectedAccounts] = useState<SocialAccountItem[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Auth guard
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // ── Fetch queue ────────────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetch('/api/content/queue?limit=50');
      if (!res.ok) throw new Error('Failed to load content queue');
      const data = await res.json();
      setQueue(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setQueueError(e.message);
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'authenticated') fetchQueue();
  }, [sessionStatus, fetchQueue]);

  // ── Fetch connected accounts ────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch('/api/publish/accounts');
      if (res.ok) {
        const data = await res.json();
        setConnectedAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      } else {
        setConnectedAccounts([]);
      }
    } catch {
      setConnectedAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'authenticated') fetchAccounts();
  }, [sessionStatus, fetchAccounts]);

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
    setSelectedPlatforms(new Set());
    setScheduleTime('');
    fetchDetail(taskId);
  };

  // ── Platform toggle ────────────────────────────────────────────────────────

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(platformId)) next.delete(platformId);
      else next.add(platformId);
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
    console.log('[saveEdits] PUT', saveUrl, JSON.stringify(payload).slice(0, 300));

    setSaving(true);
    setInlineToast(null);

    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resBody = await res.json().catch(() => ({ error: 'Unparseable response' }));
      console.log('[saveEdits] response', res.status, JSON.stringify(resBody).slice(0, 300));

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
    if (selectedPlatforms.size === 0) {
      showToast('error', 'Select at least one platform');
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
      platforms: Array.from(selectedPlatforms),
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
    console.log('[publishContent]', mode, publishUrl, JSON.stringify(payload).slice(0, 400));

    setPublishing(true);
    setInlineToast(null);

    try {
      const res = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resBody = await res.json().catch(() => ({ error: 'Unparseable response' }));
      console.log('[publishContent] response', res.status, JSON.stringify(resBody).slice(0, 400));

      if (!res.ok) {
        throw new Error(resBody.error || `Publish failed (${res.status})`);
      }

      const platformCount = payload.platforms.length;
      const statusLabel = mode === 'schedule' ? 'scheduled' : 'queued';
      showToast('success', `${platformCount} platform(s) ${statusLabel} successfully`);

      // Update local queue item status
      setQueue(prev => prev.map(item =>
        item.task_id === selectedTaskId
          ? { ...item, publish_status: mode === 'schedule' ? 'scheduled' : 'pending' }
          : item
      ));

      // Clear platform selection + schedule after success
      setSelectedPlatforms(new Set());
      setScheduleTime('');

      // Refresh queue in background to pick up accurate server state
      fetchQueue();
    } catch (e: any) {
      console.error('[publishContent] error:', e);
      showToast('error', e.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [selectedTaskId, publishing, selectedPlatforms, scheduleTime, editCaption, editHashtags, editCta, editPlatformCaptions, showToast, fetchQueue]);

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

  if (sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (sessionStatus !== 'authenticated') return null;

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tombstone Publish Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review, edit, and schedule Tombstone-generated posts for social platforms
          </p>
        </div>
        <button
          onClick={fetchQueue}
          disabled={queueLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left: Content Queue ──────────────────────────────────────── */}
        <div className="lg:col-span-4 xl:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Content Queue</h2>
              <span className="text-xs text-gray-400">{queue.length} items</span>
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
                    <div className="flex gap-3">
                      {/* Thumbnail */}
                      <div className="w-14 h-14 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden relative">
                        {item.first_image_url ? (
                          <Image
                            src={item.first_image_url}
                            alt={item.summary || 'Content thumbnail'}
                            fill
                            className="object-cover"
                            sizes="56px"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-5 h-5 text-gray-300" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {item.summary || `Task #${item.task_id}`}
                        </p>
                        <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                          {item.preview_text || 'No preview available'}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusBadge publishStatus={item.publish_status} />
                          <span className="text-[10px] text-gray-400">
                            {safeDate(item.created_at)}
                          </span>
                        </div>
                      </div>

                      <ChevronRight className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-1 ${
                        selectedTaskId === item.task_id ? 'text-blue-500' : ''
                      }`} />
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
              {/* ── Image Preview ───────────────────────────────────── */}
              {Array.isArray(detail.image_urls) && detail.image_urls.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Images</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {detail.image_urls.map((url, i) => (
                      <div key={i} className="w-40 h-40 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden relative group">
                        <Image
                          src={url}
                          alt={detail.summary || `Asset ${i + 1}`}
                          fill
                          className="object-cover"
                          sizes="160px"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement;
                            el.style.display = 'none';
                            // Show fallback sibling
                            el.parentElement?.querySelector('[data-img-fallback]')?.removeAttribute('hidden');
                          }}
                        />
                        <div data-img-fallback hidden className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-gray-300" />
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

              {/* ── Publishing Controls ────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Publish</h3>

                {/* Platform multi-select */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Select Platforms</label>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map(p => {
                      const Icon = p.icon;
                      const isSelected = selectedPlatforms.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => togglePlatform(p.id)}
                          disabled={publishing}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                            isSelected
                              ? `${p.color} text-white border-transparent ring-2 ${p.ring}`
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <Icon className="w-4 h-4" />
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
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
                    disabled={selectedPlatforms.size === 0 || publishing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={selectedPlatforms.size === 0 ? 'Select at least one platform' : 'Post immediately'}
                  >
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {publishing ? 'Publishing…' : 'Post Now'}
                  </button>
                  <button
                    onClick={() => publishContent('schedule')}
                    disabled={selectedPlatforms.size === 0 || !scheduleTime || publishing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-gray-700 text-sm font-semibold border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!scheduleTime ? 'Set a schedule time first' : selectedPlatforms.size === 0 ? 'Select at least one platform' : 'Schedule post'}
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
                  Posts are queued for publishing — actual delivery depends on connected social accounts.
                </p>
              </div>

              {/* ── Connected Accounts (placeholder) ─────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <Link2 className="w-4 h-4" /> Connected Accounts
                  </h3>
                  <span className="text-[10px] text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                    Coming soon
                  </span>
                </div>

                {accountsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : connectedAccounts.length === 0 ? (
                  <div className="py-6 text-center">
                    <Link2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No connected accounts yet</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Social account connections will be available in a future update.
                    </p>
                    <button
                      disabled
                      className="mt-3 px-4 py-1.5 text-xs font-medium text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
                    >
                      Connect Account
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {connectedAccounts.map(acct => {
                      const platformCfg = PLATFORMS.find(p => p.id === acct.platform);
                      const Icon = platformCfg?.icon ?? Link2;
                      const colorClass = platformCfg?.color ?? 'bg-gray-500';
                      return (
                        <div
                          key={acct.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-gray-50/50"
                        >
                          <span className={`w-7 h-7 rounded-md flex items-center justify-center text-white ${colorClass}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {acct.account_name}
                            </p>
                            <p className="text-[10px] text-gray-400">{acct.platform}</p>
                          </div>
                          <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {acct.connection_status}
                          </span>
                        </div>
                      );
                    })}
                    <button
                      disabled
                      className="w-full mt-2 px-4 py-1.5 text-xs font-medium text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
                    >
                      Manage Accounts
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
