'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Clock, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Eye, Check, X, MessageSquare,
  RefreshCw, Filter, Facebook, Globe, Instagram, Linkedin,
  Wifi, WifiOff, ExternalLink, LayoutGrid, List as ListIcon,
  Sparkles, Zap,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import {
  STATUS_LABELS, PLATFORM_CONFIG, CADENCE_CONFIG, APPROVAL_MODES,
  getStatusLabel, getPlatformLabel, formatScheduleDate,
  type ScheduledPostStatus, type Platform,
} from '@/lib/scheduling-utils';

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  facebook: Facebook,
  google_business: Globe,
  instagram: Instagram,
  linkedin: Linkedin,
};

type TabId = 'queue' | 'calendar' | 'approvals' | 'connections';

interface ScheduledPost {
  id: string;
  caption: string;
  imageUrl: string | null;
  hashtags: string[];
  cta: string | null;
  platforms: string[];
  scheduledFor: string;
  timezone: string;
  status: string;
  approvalRequired: boolean;
  approvedAt: string | null;
  approvedBy: { id: string; email: string } | null;
  lane: string | null;
  sourceType: string | null;
  revisionRequestText: string | null;
  revisionCount: number;
  failureReason: string | null;
  createdAt: string;
}

interface SocialConnection {
  id: string;
  platform: string;
  displayName: string | null;
  profileUrl: string | null;
  permissionsStatus: string;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastPublishedAt: string | null;
  errorMessage: string | null;
}

interface PublishSettingsData {
  postingGoal: string | null;
  approvalMode: string;
  cadence: string;
  defaultChannels: string[];
  onboardingComplete: boolean;
}

export default function ScheduleDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const { activeBusiness } = useActiveBusiness();
  const activeBusinessId = activeBusiness?.id ?? null;
  const activeBusinessName = activeBusiness?.businessName ?? null;

  const [tab, setTab] = useState<TabId>('queue');
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [settings, setSettings] = useState<PublishSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [revisionPostId, setRevisionPostId] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!activeBusinessId) return;
    setLoading(true);
    try {
      const [postsRes, connectionsRes, settingsRes] = await Promise.all([
        fetch(`/api/businesses/${activeBusinessId}/scheduled-posts${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`),
        fetch(`/api/businesses/${activeBusinessId}/social-connections`),
        fetch(`/api/businesses/${activeBusinessId}/posting-preferences`),
      ]);
      const [postsData, connectionsData, settingsData] = await Promise.all([
        postsRes.json(),
        connectionsRes.json(),
        settingsRes.json(),
      ]);
      setPosts(postsData.posts ?? []);
      setConnections(connectionsData.connections ?? []);
      setSettings(settingsData.settings ?? null);
    } catch (err) {
      console.error('[ScheduleDashboard fetch]', err);
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId, statusFilter]);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') { router.push('/'); return; }
    if (sessionStatus === 'authenticated' && activeBusinessId) fetchData();
  }, [sessionStatus, activeBusinessId, fetchData, router]);

  // Actions
  const approvePost = async (postId: string, approveAll = false) => {
    setActionLoading(postId);
    try {
      await fetch(`/api/scheduled-posts/${postId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveAll }),
      });
      await fetchData();
    } catch (err) {
      console.error('[approvePost]', err);
    } finally {
      setActionLoading(null);
    }
  };

  const requestRevision = async (postId: string) => {
    if (!revisionText.trim()) return;
    setActionLoading(postId);
    try {
      await fetch(`/api/scheduled-posts/${postId}/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: revisionText }),
      });
      setRevisionPostId(null);
      setRevisionText('');
      await fetchData();
    } catch (err) {
      console.error('[requestRevision]', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Count by status
  const needsApproval = posts.filter(p => p.status === 'needs_approval').length;
  const scheduled = posts.filter(p => ['approved', 'scheduled'].includes(p.status)).length;
  const published = posts.filter(p => p.status === 'published').length;
  const failed = posts.filter(p => p.status === 'failed').length;

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!activeBusinessId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Select a Business</h2>
        <p className="text-gray-500">Choose a business from your dashboard to view the posting schedule.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Post Schedule</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeBusinessName ? `Managed by your AI marketing team for ${activeBusinessName}` : 'Your automated posting schedule'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settings?.cadence && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
              {CADENCE_CONFIG[settings.cadence as keyof typeof CADENCE_CONFIG]?.label ?? settings.cadence} cadence
            </span>
          )}
          <button
            onClick={fetchData}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-amber-600">{needsApproval}</div>
          <div className="text-xs text-gray-500">Needs Approval</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{scheduled}</div>
          <div className="text-xs text-gray-500">Scheduled</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-emerald-600">{published}</div>
          <div className="text-xs text-gray-500">Published</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-red-600">{failed}</div>
          <div className="text-xs text-gray-500">Needs Attention</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {[
            { id: 'queue' as TabId, label: 'Queue', count: posts.length },
            { id: 'calendar' as TabId, label: 'Calendar' },
            { id: 'approvals' as TabId, label: 'Approvals', count: needsApproval },
            { id: 'connections' as TabId, label: 'Connections', count: connections.length },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === 'queue' && renderQueue()}
      {tab === 'calendar' && renderCalendar()}
      {tab === 'approvals' && renderApprovals()}
      {tab === 'connections' && renderConnections()}
    </div>
  );

  // ─── Queue Tab ─────────────────────────────
  function renderQueue() {
    // Status filter
    const filteredPosts = statusFilter === 'all'
      ? posts
      : posts.filter(p => p.status === statusFilter);

    return (
      <div>
        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {['all', 'needs_approval', 'approved', 'scheduled', 'published', 'failed', 'revision_requested'].map(s => {
            const label = s === 'all' ? 'All' : getStatusLabel(s).label;
            const count = s === 'all' ? posts.length : posts.filter(p => p.status === s).length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {label} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>

        {filteredPosts.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No posts yet</h3>
            <p className="text-sm text-gray-500">Generate posts and schedule them from your results page.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPosts.map(post => renderPostCard(post))}
          </div>
        )}
      </div>
    );
  }

  // ─── Post Card ────────────────────────────
  function renderPostCard(post: ScheduledPost) {
    const statusInfo = getStatusLabel(post.status);
    const isApprovalAction = ['needs_approval', 'revision_requested'].includes(post.status);

    return (
      <div key={post.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
        <div className="flex items-start gap-4">
          {/* Image thumbnail */}
          {post.imageUrl && (
            <img
              src={post.imageUrl}
              alt="Post preview"
              className="w-16 h-16 rounded-lg object-cover shrink-0"
              onError={(e: any) => { e.target.style.display = 'none'; }}
            />
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
              {post.lane && (
                <span className="text-xs text-gray-400 capitalize">{post.lane}</span>
              )}
            </div>
            <p className="text-sm text-gray-800 line-clamp-2 mb-1.5">{post.caption}</p>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatScheduleDate(post.scheduledFor)}
              </span>
              <div className="flex items-center gap-1">
                {post.platforms.map(p => {
                  const Icon = PLATFORM_ICONS[p] ?? Globe;
                  return <Icon key={p} className="w-3.5 h-3.5" />;
                })}
              </div>
            </div>
            {post.revisionRequestText && post.status === 'revision_requested' && (
              <div className="mt-2 text-xs bg-orange-50 text-orange-700 p-2 rounded-lg">
                <span className="font-medium">Revision note:</span> {post.revisionRequestText}
              </div>
            )}
            {post.failureReason && post.status === 'failed' && (
              <div className="mt-2 text-xs bg-red-50 text-red-700 p-2 rounded-lg">
                <span className="font-medium">Error:</span> {post.failureReason}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {isApprovalAction && (
              <>
                <button
                  onClick={() => approvePost(post.id)}
                  disabled={actionLoading === post.id}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading === post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  onClick={() => setRevisionPostId(revisionPostId === post.id ? null : post.id)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Revision
                </button>
              </>
            )}
          </div>
        </div>

        {/* Revision input */}
        <AnimatePresence>
          {revisionPostId === post.id && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-gray-100">
                <textarea
                  value={revisionText}
                  onChange={e => setRevisionText(e.target.value)}
                  placeholder="Tell your AI team what to change…"
                  className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                  rows={2}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setRevisionPostId(null); setRevisionText(''); }}
                    className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => requestRevision(post.id)}
                    disabled={!revisionText.trim() || actionLoading === post.id}
                    className="text-xs px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  >
                    Request Revision
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ─── Calendar Tab ─────────────────────────
  function renderCalendar() {
    // Group posts by date
    const byDate: Record<string, ScheduledPost[]> = {};
    for (const post of posts) {
      const d = new Date(post.scheduledFor);
      const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(post);
    }

    const dateKeys = Object.keys(byDate);

    if (dateKeys.length === 0) {
      return (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No scheduled dates</h3>
          <p className="text-sm text-gray-500">Schedule posts to see them on the calendar.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {dateKeys.map(dateKey => (
          <div key={dateKey}>
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-500" />
              {dateKey}
            </h3>
            <div className="space-y-2 ml-6">
              {byDate[dateKey].map(post => {
                const statusInfo = getStatusLabel(post.status);
                const time = new Date(post.scheduledFor).toLocaleTimeString('en-US', {
                  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
                });
                return (
                  <div key={post.id} className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 p-3">
                    <div className="text-sm font-medium text-gray-900 w-20">{time}</div>
                    {post.imageUrl && (
                      <img src={post.imageUrl} alt="" className="w-8 h-8 rounded object-cover" onError={(e: any) => { e.target.style.display = 'none'; }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{post.caption.slice(0, 60)}{post.caption.length > 60 ? '…' : ''}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <div className="flex gap-1">
                      {post.platforms.map(p => {
                        const Icon = PLATFORM_ICONS[p] ?? Globe;
                        return <Icon key={p} className="w-3.5 h-3.5 text-gray-400" />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── Approvals Tab ────────────────────────
  function renderApprovals() {
    const approvalPosts = posts.filter(p => ['needs_approval', 'revision_requested'].includes(p.status));

    if (approvalPosts.length === 0) {
      return (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">All caught up!</h3>
          <p className="text-sm text-gray-500">No posts need your approval right now.</p>
        </div>
      );
    }

    return (
      <div>
        {/* Approve All button */}
        {approvalPosts.length > 1 && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => approvalPosts[0] && approvePost(approvalPosts[0].id, true)}
              className="flex items-center gap-2 text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve All ({approvalPosts.length})
            </button>
          </div>
        )}
        <div className="space-y-3">
          {approvalPosts.map(post => renderPostCard(post))}
        </div>
      </div>
    );
  }

  // ─── Connections Tab ──────────────────────
  function renderConnections() {
    const allPlatforms = Object.entries(PLATFORM_CONFIG) as [string, typeof PLATFORM_CONFIG[keyof typeof PLATFORM_CONFIG]][];

    return (
      <div className="space-y-3">
        {allPlatforms.map(([key, config]) => {
          const connection = connections.find(c => c.platform === key);
          const Icon = PLATFORM_ICONS[key] ?? Globe;
          const isConnected = connection?.permissionsStatus === 'connected';
          const isPending = connection?.permissionsStatus === 'pending';

          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${config.bgColor}`}>
                  <Icon className={`w-6 h-6 ${config.color}`} />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{config.label}</div>
                  {connection?.displayName && (
                    <div className="text-xs text-gray-500">{connection.displayName}</div>
                  )}
                  {config.comingSoon && (
                    <div className="text-xs text-gray-400">Coming soon</div>
                  )}
                </div>
                <div>
                  {config.comingSoon ? (
                    <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg font-medium">Coming Soon</span>
                  ) : isConnected ? (
                    <span className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg font-medium">
                      <Wifi className="w-3.5 h-3.5" /> Connected
                    </span>
                  ) : isPending ? (
                    <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg font-medium">
                      <Clock className="w-3.5 h-3.5" /> Pending Setup
                    </span>
                  ) : (
                    <button
                      className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                      onClick={() => {
                        // Create placeholder connection
                        fetch(`/api/businesses/${activeBusinessId}/social-connections`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ platform: key }),
                        }).then(() => fetchData());
                      }}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
              {connection?.errorMessage && (
                <div className="mt-2 text-xs bg-red-50 text-red-600 p-2 rounded-lg">
                  {connection.errorMessage}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
}
