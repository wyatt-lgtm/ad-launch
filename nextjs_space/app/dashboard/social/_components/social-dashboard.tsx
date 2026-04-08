'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Newspaper, Send, CheckCircle2, XCircle,
  Edit3, Trash2, Copy, ExternalLink, Hash, Clock,
  Zap, RefreshCw, ChevronDown, Plus, Link2, Unlink,
  Facebook, Instagram, Youtube, MapPin, Eye, LayoutGrid,
  List, AlertCircle, Sparkles
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface SocialPost {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl: string | null;
  rssItemTitle: string | null;
  rssItemLink: string | null;
  sourceType: string | null;
  newsAngle: string | null;
  platforms: string[];
  postType: string;
  status: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  tradeAreaZip: string | null;
  patternType: string | null;
  createdAt: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  profileUrl: string | null;
  displayName: string | null;
  isActive: boolean;
}

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: 'bg-blue-600', hoverColor: 'hover:bg-blue-700', textColor: 'text-blue-600', lightBg: 'bg-blue-50', composerUrl: (text: string, link?: string) => `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(text)}${link ? `&u=${encodeURIComponent(link)}` : ''}` },
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: 'bg-gradient-to-br from-purple-600 to-pink-500', hoverColor: 'hover:opacity-90', textColor: 'text-pink-600', lightBg: 'bg-pink-50', composerUrl: () => 'https://www.instagram.com/' },
  { id: 'youtube', label: 'YouTube', icon: Youtube, color: 'bg-red-600', hoverColor: 'hover:bg-red-700', textColor: 'text-red-600', lightBg: 'bg-red-50', composerUrl: () => 'https://studio.youtube.com/' },
  { id: 'tiktok', label: 'TikTok', icon: () => <span className="text-lg font-bold">TT</span>, color: 'bg-black', hoverColor: 'hover:bg-gray-800', textColor: 'text-black', lightBg: 'bg-gray-50', composerUrl: () => 'https://www.tiktok.com/upload' },
  { id: 'pinterest', label: 'Pinterest', icon: () => <span className="text-lg font-bold">P</span>, color: 'bg-red-700', hoverColor: 'hover:bg-red-800', textColor: 'text-red-700', lightBg: 'bg-red-50', composerUrl: (text: string, link?: string) => `https://pinterest.com/pin/create/button/?description=${encodeURIComponent(text)}${link ? `&url=${encodeURIComponent(link)}` : ''}` },
  { id: 'snapchat', label: 'Snapchat', icon: () => <span className="text-lg font-bold">SC</span>, color: 'bg-yellow-400', hoverColor: 'hover:bg-yellow-500', textColor: 'text-yellow-600', lightBg: 'bg-yellow-50', composerUrl: () => 'https://www.snapchat.com/' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100', icon: Edit3 },
  pending_approval: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-50', icon: Clock },
  approved: { label: 'Approved', color: 'text-green-700', bg: 'bg-green-50', icon: CheckCircle2 },
  published: { label: 'Published', color: 'text-blue-700', bg: 'bg-blue-50', icon: Send },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
  expired: { label: 'Expired', color: 'text-gray-500', bg: 'bg-gray-50', icon: Clock },
};

const POST_TYPE_LABELS: Record<string, string> = {
  weather_tip: '☀️ Weather Tip',
  community_event: '🎉 Community Event',
  trending_news: '🔥 Trending News',
  seasonal: '🍃 Seasonal',
  general: '📰 General',
  promotion: '📣 Promotion',
};

const LANE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  rss: { label: '📡 Local News', color: 'text-blue-700', bg: 'bg-blue-50' },
  website: { label: '🌐 Website', color: 'text-emerald-700', bg: 'bg-emerald-50' },
  holiday: { label: '🎉 Holiday/Event', color: 'text-purple-700', bg: 'bg-purple-50' },
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function SocialDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();

  // State
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scouting, setScouting] = useState(false);
  const [scoutResult, setScoutResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'accounts'>('queue');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [linkingPlatform, setLinkingPlatform] = useState<string | null>(null);
  const [linkHandle, setLinkHandle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [scoutError, setScoutError] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // Fetch data
  const fetchPosts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      const res = await fetch(`/api/social/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
      setTotalPosts(data.total || 0);
    } catch (e) {
      console.error('Failed to fetch posts:', e);
    }
  }, [statusFilter]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/social/accounts');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      Promise.all([fetchPosts(), fetchAccounts()]).then(() => setLoading(false));
    }
  }, [sessionStatus, fetchPosts, fetchAccounts]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const scoutForPosts = async () => {
    setScouting(true);
    setScoutError(null);
    setScoutResult(null);
    try {
      // Step 1: Clark Kent gathers local intelligence (scout only — no post creation)
      const scoutRes = await fetch('/api/rss/clark-kent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const scoutData = await scoutRes.json();
      if (!scoutRes.ok) throw new Error(scoutData.error || 'Scout failed');

      setScoutResult({
        message: `Scout brief gathered: ${scoutData.meta?.rssItemCount ?? 0} local news items, ${scoutData.meta?.eventCount ?? 0} upcoming events. Tombstone creative workflow will generate posts with artwork.`,
        meta: scoutData.meta,
      });

      // Step 2: Send scout brief to Tombstone for creative processing
      // This creates a social mission that Zig Ziglar → Ogilvy → Don → Andy → Claude will process
      const tombstoneRes = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoutBrief: scoutData.brief,
        }),
      });
      const tombstoneData = await tombstoneRes.json();
      if (!tombstoneRes.ok) throw new Error(tombstoneData.error || 'Failed to start creative workflow');

      setScoutResult({
        message: `Scout brief sent to creative team. ${tombstoneData.taskCount ?? 0} tasks queued — posts with artwork will appear when complete.`,
        meta: scoutData.meta,
        socialMissionId: tombstoneData.socialMissionId,
      });
    } catch (e: any) {
      console.error('Scout error:', e);
      setScoutError(e.message);
    }
    setScouting(false);
  };

  const updatePost = async (id: string, action: string, extra?: any) => {
    try {
      await fetch(`/api/social/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      await fetchPosts();
    } catch (e) {
      console.error('Update post error:', e);
    }
  };

  const deletePost = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    try {
      await fetch(`/api/social/posts/${id}`, { method: 'DELETE' });
      await fetchPosts();
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const saveCaption = async (id: string) => {
    await updatePost(id, '', { caption: editCaption });
    setEditingPost(null);
  };

  const copyCaption = (post: SocialPost) => {
    const fullText = post.caption + (post.hashtags.length > 0 ? '\n\n' + post.hashtags.join(' ') : '');
    navigator.clipboard.writeText(fullText);
    setCopiedId(post.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openComposer = (post: SocialPost, platformId: string) => {
    const platform = PLATFORMS.find(p => p.id === platformId);
    if (!platform) return;
    const fullText = post.caption + (post.hashtags.length > 0 ? '\n\n' + post.hashtags.join(' ') : '');
    // Copy to clipboard first
    navigator.clipboard.writeText(fullText).catch(() => {});
    const url = platform.composerUrl(fullText, post.rssItemLink || undefined);
    window.open(url, '_blank');
  };

  const linkAccount = async (platform: string) => {
    if (!linkHandle.trim()) return;
    try {
      await fetch('/api/social/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          handle: linkHandle.trim(),
          profileUrl: linkUrl.trim() || null,
        }),
      });
      await fetchAccounts();
      setLinkingPlatform(null);
      setLinkHandle('');
      setLinkUrl('');
    } catch (e) {
      console.error('Link error:', e);
    }
  };

  const unlinkAccount = async (platform: string) => {
    if (!confirm(`Unlink ${platform}?`)) return;
    try {
      await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      await fetchAccounts();
    } catch (e) {
      console.error('Unlink error:', e);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const linkedCount = accounts.filter(a => a.isActive).length;
  const pendingCount = posts.filter(p => p.status === 'pending_approval').length;
  const approvedCount = posts.filter(p => p.status === 'approved').length;
  const publishedCount = posts.filter(p => p.status === 'published').length;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-blue-600" />
            Social Post Queue
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Clark Kent scouts local news and writes posts for your business.</p>
        </div>
        <button
          onClick={scoutForPosts}
          disabled={scouting}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-sm"
        >
          {scouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {scouting ? 'Generating 9 Posts...' : 'Generate 9 Posts'}
        </button>
      </div>

      {/* Scout result toast */}
      <AnimatePresence>
        {scoutResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3"
          >
            <Sparkles className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-green-800">
                {scoutResult.message || 'Scout brief sent to creative team!'}
              </p>
              {scoutResult.meta && (
                <p className="text-sm text-green-600 mt-0.5">
                  📡 {scoutResult.meta.rssItemCount ?? 0} local news items • 🎉 {scoutResult.meta.eventCount ?? 0} upcoming events • 📍 {[scoutResult.meta.city, scoutResult.meta.state].filter(Boolean).join(', ') || 'Local Area'}
                </p>
              )}
              {scoutResult.socialMissionId && (
                <p className="text-xs text-green-500 mt-1">
                  Creative workflow started — posts with artwork will appear when the team finishes.
                </p>
              )}
            </div>
            <button onClick={() => setScoutResult(null)} className="ml-auto text-green-400 hover:text-green-600">
              <XCircle className="w-4 h-4" />
            </button>
          </motion.div>
        )}
        {scoutError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-red-800">Scout failed</p>
              <p className="text-sm text-red-600 mt-0.5">{scoutError}</p>
            </div>
            <button onClick={() => setScoutError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <XCircle className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Pending', value: pendingCount, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Approved', value: approvedCount, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Published', value: publishedCount, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Linked Accounts', value: linkedCount, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(stat => (
          <div key={stat.label} className={`${stat.bg} rounded-xl p-4 text-center`}>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {(['queue', 'accounts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'queue' ? (
              <span className="flex items-center gap-2"><LayoutGrid className="w-4 h-4" /> Post Queue</span>
            ) : (
              <span className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Accounts</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Post Queue Tab ──────────────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <div>
          {/* Filter bar */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {['', 'pending_approval', 'approved', 'published', 'rejected'].map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {s === '' ? 'All' : STATUS_CONFIG[s]?.label || s}
              </button>
            ))}
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <Newspaper className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No posts yet</h3>
              <p className="text-sm text-gray-400 mb-6">Click &ldquo;Generate 9 Posts&rdquo; to create local news, website, and holiday posts.</p>
              <button
                onClick={scoutForPosts}
                disabled={scouting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {scouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {scouting ? 'Generating 9 Posts...' : 'Generate 9 Posts'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map(post => {
                const statusConf = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft;
                const StatusIcon = statusConf.icon;
                const isEditing = editingPost === post.id;

                return (
                  <motion.div
                    key={post.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
                  >
                    <div className="p-5">
                      {/* Top row: status + source + actions */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusConf.bg} ${statusConf.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusConf.label}
                          </span>
                          {post.patternType && LANE_LABELS[post.patternType] && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${LANE_LABELS[post.patternType].bg} ${LANE_LABELS[post.patternType].color}`}>
                              {LANE_LABELS[post.patternType].label}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            {POST_TYPE_LABELS[post.postType] || post.postType}
                          </span>
                          {post.tradeAreaZip && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                              <MapPin className="w-3 h-3" /> {post.tradeAreaZip}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {post.status === 'pending_approval' && (
                            <>
                              <button
                                onClick={() => updatePost(post.id, 'approve')}
                                className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                                title="Approve"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => updatePost(post.id, 'reject')}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              if (isEditing) { setEditingPost(null); }
                              else { setEditingPost(post.id); setEditCaption(post.caption); }
                            }}
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deletePost(post.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Source headline */}
                      {post.rssItemTitle && (
                        <div className="mb-3 px-3 py-2 bg-gray-50 rounded-lg border-l-4 border-blue-400">
                          <p className="text-xs text-gray-500 font-medium mb-0.5">Source</p>
                          <p className="text-sm text-gray-700 font-medium">{post.rssItemTitle}</p>
                          {post.rssItemLink && (
                            <a href={post.rssItemLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1 mt-1">
                              Original article <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* Caption */}
                      {isEditing ? (
                        <div className="mb-3">
                          <textarea
                            value={editCaption}
                            onChange={e => setEditCaption(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={3}
                          />
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => saveCaption(post.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">Save</button>
                            <button onClick={() => setEditingPost(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-800 leading-relaxed mb-3 whitespace-pre-wrap">{post.caption}</p>
                      )}

                      {/* Post image (from Tombstone creative workflow) */}
                      {post.imageUrl && (
                        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3">
                          <img
                            src={post.imageUrl}
                            alt={post.newsAngle || 'Social post image'}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                      )}

                      {/* Hashtags */}
                      {post.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {post.hashtags.map((tag, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-xs">
                              <Hash className="w-2.5 h-2.5" />{tag.replace('#', '')}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* News angle */}
                      {post.newsAngle && (
                        <p className="text-xs text-gray-400 italic mb-3">
                          <strong className="text-gray-500">Angle:</strong> {post.newsAngle}
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-50">
                        {/* Copy caption */}
                        <button
                          onClick={() => copyCaption(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          {copiedId === post.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedId === post.id ? 'Copied!' : 'Copy Caption'}
                        </button>

                        {/* Platform publish buttons */}
                        {(post.status === 'approved' || post.status === 'published') && post.platforms.map(pid => {
                          const p = PLATFORMS.find(pl => pl.id === pid);
                          if (!p) return null;
                          const Icon = p.icon;
                          return (
                            <button
                              key={pid}
                              onClick={() => {
                                openComposer(post, pid);
                                if (post.status === 'approved') updatePost(post.id, 'publish');
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${p.color} text-white rounded-lg text-xs font-medium ${p.hoverColor} transition-all`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              Post to {p.label}
                            </button>
                          );
                        })}

                        {/* Time */}
                        <span className="ml-auto text-xs text-gray-400">
                          {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Accounts Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'accounts' && (
        <div>
          <p className="text-sm text-gray-500 mb-6">Link your social accounts so Clark Kent can tailor posts to each platform. Posts are published by you — we provide the content and open the composer.</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORMS.map(platform => {
              const linked = accounts.find(a => a.platform === platform.id && a.isActive);
              const Icon = platform.icon;
              const isLinking = linkingPlatform === platform.id;

              return (
                <div
                  key={platform.id}
                  className={`rounded-2xl border-2 p-5 transition-all ${
                    linked ? 'border-green-200 bg-green-50/50' : 'border-gray-100 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${platform.color} rounded-xl flex items-center justify-center text-white`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">{platform.label}</h3>
                        {linked && <p className="text-xs text-gray-500">@{linked.handle}</p>}
                      </div>
                    </div>
                    {linked ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Linked
                      </span>
                    ) : null}
                  </div>

                  {isLinking ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={linkHandle}
                        onChange={e => setLinkHandle(e.target.value)}
                        placeholder="Username or page name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <input
                        type="url"
                        value={linkUrl}
                        onChange={e => setLinkUrl(e.target.value)}
                        placeholder="Profile URL (optional)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => linkAccount(platform.id)} className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                          Save
                        </button>
                        <button onClick={() => { setLinkingPlatform(null); setLinkHandle(''); setLinkUrl(''); }} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : linked ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setLinkingPlatform(platform.id); setLinkHandle(linked.handle); setLinkUrl(linked.profileUrl || ''); }}
                        className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                      <button
                        onClick={() => unlinkAccount(platform.id)}
                        className="px-3 py-2 bg-white border border-red-200 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 flex items-center justify-center gap-1"
                      >
                        <Unlink className="w-3 h-3" /> Unlink
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setLinkingPlatform(platform.id); setLinkHandle(''); setLinkUrl(''); }}
                      className="w-full px-3 py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs font-medium text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Link Account
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}