'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, Send, Clock, CheckCircle2, XCircle, Edit3,
  Hash, CalendarDays, Zap, RefreshCw, ImageIcon, FileText,
  Facebook, Instagram, Linkedin, ChevronRight, AlertCircle,
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

const PUBLISH_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  ready: { label: 'Ready', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100', icon: Edit3 },
  scheduled: { label: 'Scheduled', color: 'text-amber-700', bg: 'bg-amber-50', icon: Clock },
  posted: { label: 'Posted', color: 'text-blue-700', bg: 'bg-blue-50', icon: Send },
  failed: { label: 'Failed', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
};

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

  // Editor state (local only for now)
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editCta, setEditCta] = useState('');
  const [editPlatformCaptions, setEditPlatformCaptions] = useState<Record<string, string>>({});

  // Publish controls state
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [scheduleTime, setScheduleTime] = useState('');

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

  // ── Fetch detail ───────────────────────────────────────────────────────────

  const fetchDetail = useCallback(async (taskId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/content/${taskId}`);
      if (!res.ok) throw new Error('Failed to load content detail');
      const data: ContentDetail = await res.json();
      setDetail(data);

      // Populate editor fields
      setEditCaption(data.base_caption || '');
      setEditHashtags((data.hashtags || []).join(' '));
      setEditCta(data.cta || '');

      // Platform-specific captions from variants
      const pc: Record<string, string> = {};
      if (Array.isArray(data.platform_variants)) {
        for (const v of data.platform_variants) {
          if (v && typeof v === 'object' && v.platform && v.caption) {
            pc[v.platform] = v.caption;
          }
        }
      }
      setEditPlatformCaptions(pc);
    } catch (e: any) {
      console.error('Detail fetch error:', e);
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
          <h1 className="text-2xl font-bold text-gray-900">Publishing Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and schedule generated content for social platforms
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
                            {item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}
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
          ) : !detail ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[500px]">
              <div className="text-center px-8">
                <AlertCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
                <p className="text-sm text-red-600">Failed to load content details</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Image Preview ───────────────────────────────────── */}
              {detail.image_urls && detail.image_urls.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Images</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {detail.image_urls.map((url, i) => (
                      <div key={i} className="w-40 h-40 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden relative">
                        <Image
                          src={url}
                          alt={`Asset ${i + 1}`}
                          fill
                          className="object-cover"
                          sizes="160px"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Caption Editor ──────────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Caption</h3>
                <p className="text-xs text-gray-400 mb-3">Main post caption — edits are local only for now</p>
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
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                            isSelected
                              ? `${p.color} text-white border-transparent ring-2 ${p.ring}`
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                          }`}
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
                    disabled={selectedPlatforms.size === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={selectedPlatforms.size === 0 ? 'Select at least one platform' : 'Post immediately'}
                  >
                    <Zap className="w-4 h-4" />
                    Post Now
                  </button>
                  <button
                    disabled={selectedPlatforms.size === 0 || !scheduleTime}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-gray-700 text-sm font-semibold border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!scheduleTime ? 'Set a schedule time first' : selectedPlatforms.size === 0 ? 'Select at least one platform' : 'Schedule post'}
                  >
                    <Clock className="w-4 h-4" />
                    Schedule
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Publishing controls are placeholders — wiring comes in a future prompt.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
