'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Newspaper, Send, CheckCircle2, XCircle,
  Edit3, Trash2, Copy, ExternalLink, Hash, Clock,
  Zap, RefreshCw, ChevronDown, ChevronUp, Plus, Link2, Unlink,
  Facebook, Instagram, Youtube, MapPin, Eye, LayoutGrid,
  List, AlertCircle, Sparkles, Building2, Download, Check, Square, CheckSquare,
  PenLine, Image as ImageIcon
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import { BusinessPickerGrid, ActiveBusinessBanner } from '@/components/business-picker';
import GenerationProgress from './generation-progress';

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
  downloaded: { label: 'Downloaded', color: 'text-indigo-700', bg: 'bg-indigo-50', icon: Download },
  manually_posted: { label: 'Posted', color: 'text-blue-700', bg: 'bg-blue-50', icon: Send },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
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
  const searchParams = useSearchParams();
  const autoScout = searchParams.get('scout') === '1';
  const bizCtx = useActiveBusiness();
  const [showPicker, setShowPicker] = useState(false);

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
  const [polling, setPolling] = useState(false);
  const [pollStatus, setPollStatus] = useState<string | null>(null);

  // Scouting mode
  type ScoutMode = 'local_only' | 'local_plus_interests' | 'interests_only';
  const [scoutMode, setScoutMode] = useState<ScoutMode>('local_plus_interests');
  const [missingLocation, setMissingLocation] = useState(false);

  // Create From My Own Post state
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftPlatform, setDraftPlatform] = useState('');
  const [draftTone, setDraftTone] = useState('');
  const [draftCta, setDraftCta] = useState('');
  const [draftOffer, setDraftOffer] = useState('');
  const [draftArtDirection, setDraftArtDirection] = useState('');
  const [draftGenerateArt, setDraftGenerateArt] = useState(true);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showDraftAdvanced, setShowDraftAdvanced] = useState(false);

  // Generation progress tracking (shared by both Scout Stories + My Own Post)
  const [activeWorkflowIds, setActiveWorkflowIds] = useState<string[]>([]);
  const [activeFlowLabel, setActiveFlowLabel] = useState<string>('Scout Stories');
  // Stash last submission params for retry
  const lastScoutBriefRef = useRef<any>(null);
  const lastDraftParamsRef = useRef<any>(null);

  // Story picker state
  interface StoryCard {
    id: string;
    title: string;
    source: string;
    sourceType: 'local' | 'industry' | 'national'; // unified source_type
    section: 'local' | 'industry' | 'event'; // grouping for display
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
  const MAX_STORIES = 3;

  // Auth guard
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // Fetch data — filter by active business when available
  const activeBusinessId = bizCtx.activeBusiness?.id;
  const fetchPosts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (activeBusinessId) params.set('businessId', activeBusinessId);
      params.set('limit', '50');
      const res = await fetch(`/api/social/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
      setTotalPosts(data.total || 0);
    } catch (e) {
      console.error('Failed to fetch posts:', e);
    }
  }, [statusFilter, activeBusinessId]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/social/accounts');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    }
  }, []);

  // Poll Tombstone for pending missions and import completed posts
  const pollMissions = useCallback(async (silent = false) => {
    if (!silent) setPolling(true);
    try {
      const res = await fetch('/api/social/missions/poll', { method: 'POST' });
      const data = await res.json();
      console.log('[social] Poll result:', data);

      if (data.imported > 0) {
        setPollStatus(`✅ Imported ${data.imported} new post${data.imported > 1 ? 's' : ''}!`);
        await fetchPosts(); // Refresh the list
      } else if (data.status === 'generating' || data.status === 'processing') {
        setPollStatus('⏳ Posts are still being generated by the creative team...');
      } else if (data.status === 'all_imported' || data.status === 'no_missions') {
        // Nothing to do — don't show a message
        setPollStatus(null);
      } else if (data.status === 'error') {
        setPollStatus('⚠️ Error polling creative workflow. Try again later.');
      } else {
        setPollStatus(null);
      }
      return data;
    } catch (e) {
      console.error('Poll error:', e);
      return null;
    } finally {
      if (!silent) setPolling(false);
    }
  }, [fetchPosts]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      Promise.all([fetchPosts(), fetchAccounts()])
        .then(async () => {
          setLoading(false);
          // Auto-poll for any pending missions on page load
          await pollMissions(true);
        });
    }
  }, [sessionStatus, fetchPosts, fetchAccounts, pollMissions]);

  // ── Actions ──────────────────────────────────────────────────────────────

  // Phase 1: Scout stories and show the picker
  const scoutForPosts = async () => {
    setScouting(true);
    setScoutError(null);
    setScoutResult(null);
    setShowStoryPicker(false);
    setSelectionError(null);
    setMissingLocation(false);
    try {
      const scoutBody: Record<string, any> = {
        contentSourceMode: scoutMode,
      };
      // Pass businessId if available so Clark Kent uses the right business
      if (activeBusinessId) scoutBody.businessId = activeBusinessId;

      const scoutRes = await fetch('/api/rss/clark-kent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoutBody),
      });
      const scoutData = await scoutRes.json();
      if (!scoutRes.ok) throw new Error(scoutData.error || 'Scout failed');

      // Save full brief for phase 2
      setScoutBriefData(scoutData.brief);
      const brief = scoutData.brief;
      const meta = scoutData.meta;
      const cards: StoryCard[] = [];
      const tradeCity = brief?.tradeArea?.city || '';
      const includesLocal = scoutMode !== 'interests_only';
      const includesInterests = scoutMode !== 'local_only';
      const hasLocation = meta?.hasLocation ?? !!(brief?.tradeArea?.zip || brief?.tradeArea?.city);

      // Track if location is missing when local was requested
      if (includesLocal && !hasLocation) {
        setMissingLocation(true);
      }

      // ── Local RSS stories (only when mode includes local) ──
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

      // ── Industry/interest stories (only when mode includes interests) ──
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

      // ── Upcoming events (always shown — classified as national) ──
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

      // Always show the picker — even if cards are empty (so user sees missing-location message)
      setSelectedStoryIds(new Set());
      setStoryCards(cards);
      setShowStoryPicker(true);

      if (cards.length > 0) {
        const sectionNames = [...new Set(cards.map(c => c.section))];
        setScoutResult({
          message: `Clark Kent found ${cards.length} stories across ${sectionNames.length} ${sectionNames.length === 1 ? 'category' : 'categories'}. Select up to ${MAX_STORIES} to turn into posts.`,
          meta,
        });
      } else if (includesLocal && !hasLocation) {
        // Local-only mode with no location
        setScoutResult({
          message: 'No location found on your business profile. Complete your profile to discover local stories.',
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
      setScoutError(e.message);
    }
    setScouting(false);
  };

  // Auto-trigger scouting when arriving from Content Sources with ?scout=1
  const autoScoutFired = useRef(false);
  useEffect(() => {
    if (autoScout && !loading && !autoScoutFired.current && sessionStatus === 'authenticated' && bizCtx.activeBusiness) {
      autoScoutFired.current = true;
      // Clear the query param so refresh doesn't re-trigger
      router.replace('/dashboard/social', { scroll: false });
      scoutForPosts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScout, loading, sessionStatus, bizCtx.activeBusiness]);

  // Phase 2: Build filtered summary and send to Tombstone
  const generateFromSelected = async () => {
    if (!scoutBriefData || selectedStoryIds.size === 0) return;
    setScouting(true);
    setScoutError(null);
    setShowStoryPicker(false);

    try {
      // Build individual stories array — one per selected headline
      // Each becomes its own Tombstone workflow → its own rendered post
      const stories: { headline: string; source?: string; category?: string; type: string; link?: string }[] = [];

      // Interest feed headlines
      if (scoutBriefData.interestBrief?.categories?.length > 0) {
        for (const cat of scoutBriefData.interestBrief.categories) {
          for (const h of (cat.headlines || [])) {
            const hid = h.id || `${cat.industry}-${h.title?.slice(0, 20)}`;
            if (selectedStoryIds.has(hid)) {
              stories.push({
                headline: h.title,
                source: h.source,
                category: cat.label,
                type: 'interest',
                link: h.link,
              });
            }
          }
        }
      }

      // Local RSS headlines
      if (scoutBriefData.rssBrief?.headlines?.length > 0) {
        for (const h of scoutBriefData.rssBrief.headlines) {
          const hid = h.id || `local-${h.title?.slice(0, 20)}`;
          if (selectedStoryIds.has(hid)) {
            stories.push({
              headline: h.title,
              source: h.source,
              category: 'Local News',
              type: 'local_news',
              link: h.link,
            });
          }
        }
      }

      // Upcoming events
      if (scoutBriefData.upcomingEvents?.length > 0) {
        for (const e of scoutBriefData.upcomingEvents) {
          const eid = e.id || `event-${e.name?.slice(0, 20)}`;
          if (selectedStoryIds.has(eid)) {
            stories.push({
              headline: e.name,
              source: e.ideas || `${e.date}`,
              category: 'Events',
              type: 'event',
            });
          }
        }
      }

      if (stories.length === 0) {
        setScoutError('No matching stories found for selected items.');
        setScouting(false);
        return;
      }

      // Final guard: clamp to MAX_STORIES
      const clampedStories = stories.slice(0, MAX_STORIES);

      const brief = {
        ...scoutBriefData,
        stories: clampedStories,
        scoutSummary: `Generating ${clampedStories.length} individual post${clampedStories.length !== 1 ? 's' : ''} from selected stories.`,
      };

      await sendToTombstone(brief, null);
    } catch (e: any) {
      console.error('Generate error:', e);
      setScoutError(e.message);
    }
    setScouting(false);
  };

  // Shared: send brief to Tombstone and show real progress
  const sendToTombstone = async (brief: any, meta: any) => {
    // Stash for retry
    lastScoutBriefRef.current = { brief, meta };

    const tombstoneRes = await fetch('/api/social/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoutBrief: brief }),
    });
    const tombstoneData = await tombstoneRes.json();
    if (!tombstoneRes.ok) throw new Error(tombstoneData.error || 'Failed to start creative workflow');

    const wfIds: string[] = tombstoneData.workflowIds || [];
    if (wfIds.length > 0) {
      setActiveWorkflowIds(wfIds);
      setActiveFlowLabel('Scout Stories');
    }

    setScoutResult(null);
  };

  // ── Create From My Own Post ─────────────────────────────────────────────
  const submitDraft = async () => {
    if (!draftText.trim()) {
      setDraftError('Please enter your draft post text.');
      return;
    }
    setDraftSubmitting(true);
    setDraftError(null);

    const params = {
      draftText: draftText.trim(),
      platform: draftPlatform || undefined,
      tone: draftTone || undefined,
      cta: draftCta || undefined,
      offer: draftOffer || undefined,
      artDirection: draftArtDirection || undefined,
      generateArt: draftGenerateArt,
      businessId: activeBusinessId || undefined,
    };
    lastDraftParamsRef.current = params;

    try {
      const res = await fetch('/api/social/create-from-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit draft');

      const wfIds: string[] = data.workflowIds || [];
      if (wfIds.length > 0) {
        setActiveWorkflowIds(wfIds);
        setActiveFlowLabel('My Own Post');
      }

      // Close form
      setShowDraftForm(false);
      setScoutResult(null);

      // Reset form fields
      setDraftText('');
      setDraftPlatform('');
      setDraftTone('');
      setDraftCta('');
      setDraftOffer('');
      setDraftArtDirection('');
      setDraftGenerateArt(true);
      setShowDraftAdvanced(false);
    } catch (e: any) {
      console.error('Draft submit error:', e);
      setDraftError(e.message);
    } finally {
      setDraftSubmitting(false);
    }
  };

  // Retry handlers for GenerationProgress
  const retryGeneration = async () => {
    setActiveWorkflowIds([]);
    if (activeFlowLabel === 'My Own Post' && lastDraftParamsRef.current) {
      setDraftSubmitting(true);
      setDraftError(null);
      try {
        const res = await fetch('/api/social/create-from-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastDraftParamsRef.current),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Retry failed');
        if (data.workflowIds?.length > 0) {
          setActiveWorkflowIds(data.workflowIds);
        }
      } catch (e: any) {
        setDraftError(e.message);
      } finally {
        setDraftSubmitting(false);
      }
    } else if (lastScoutBriefRef.current) {
      setScouting(true);
      setScoutError(null);
      try {
        await sendToTombstone(lastScoutBriefRef.current.brief, lastScoutBriefRef.current.meta);
      } catch (e: any) {
        setScoutError(e.message);
      }
      setScouting(false);
    }
  };

  const handleProgressComplete = async () => {
    setActiveWorkflowIds([]);
    // Import completed posts
    await pollMissions(false);
    await fetchPosts();
  };

  const handleProgressDismiss = () => {
    setActiveWorkflowIds([]);
  };

  // Toggle a story selection — enforce MAX_STORIES limit
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

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const downloadImage = async (post: SocialPost) => {
    if (!post.imageUrl) return;
    setDownloadingId(post.id);
    const slug = (post.caption || 'post').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/, '');
    try {
      const imgRes = await fetch(post.imageUrl);
      if (imgRes.ok) {
        const imgBlob = await imgRes.blob();
        const ext = imgBlob.type.includes('png') ? 'png' : imgBlob.type.includes('webp') ? 'webp' : 'jpg';
        const imgUrl = URL.createObjectURL(imgBlob);
        const imgLink = document.createElement('a');
        imgLink.href = imgUrl;
        imgLink.download = `${slug}.${ext}`;
        document.body.appendChild(imgLink);
        imgLink.click();
        document.body.removeChild(imgLink);
        URL.revokeObjectURL(imgUrl);
      }
    } catch (e) {
      console.warn('Image download failed:', e);
    }
    setDownloadingId(null);
  };

  const downloadPostPackage = async (post: SocialPost) => {
    setDownloadingId(post.id);
    const slug = (post.caption || 'post').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/, '');
    const imgFilename = post.imageUrl ? `${slug}.jpg` : null;

    // Build comprehensive posting package
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════╗');
    lines.push('║        SOCIAL POST PACKAGE               ║');
    lines.push('╚══════════════════════════════════════════╝');
    lines.push('');
    lines.push('━━━ POST COPY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(post.caption || '');
    if (post.hashtags.length > 0) {
      lines.push('');
      lines.push('━━━ HASHTAGS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(post.hashtags.join(' '));
    }
    if (post.rssItemTitle || post.rssItemLink) {
      lines.push('');
      lines.push('━━━ SOURCE INFO ━━━━━━━━━━━━━━━━━━━━━━━━━━');
      if (post.rssItemTitle) lines.push(`Headline: ${post.rssItemTitle}`);
      if (post.rssItemLink) lines.push(`Link: ${post.rssItemLink}`);
    }
    if (imgFilename) {
      lines.push('');
      lines.push('━━━ IMAGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`Filename: ${imgFilename}`);
      lines.push('(Image downloaded separately alongside this file)');
    }
    lines.push('');
    lines.push('━━━ PLATFORMS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(post.platforms.length > 0 ? post.platforms.join(', ') : 'No specific platform selected');
    lines.push('');
    lines.push('━━━ POSTING INSTRUCTIONS ━━━━━━━━━━━━━━━━━━');
    lines.push('1. Copy the POST COPY text above');
    lines.push('2. Open your social media platform of choice');
    lines.push('3. Create a new post and paste the caption');
    lines.push('4. Upload the image file (if included)');
    lines.push('5. Add the HASHTAGS to your post');
    lines.push('6. Review and publish!');
    if (post.rssItemLink) {
      lines.push('');
      lines.push('TIP: You can include the source link in your post');
      lines.push('to add credibility and drive traffic to the original story.');
    }
    lines.push('');
    lines.push('━━━ DETAILS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (post.postType && post.postType !== 'general') lines.push(`Type: ${post.postType}`);
    if (post.newsAngle) lines.push(`Angle: ${post.newsAngle}`);
    lines.push(`Generated: ${new Date(post.createdAt).toLocaleString()}`);

    // Download text file
    const textBlob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const textUrl = URL.createObjectURL(textBlob);
    const textLink = document.createElement('a');
    textLink.href = textUrl;
    textLink.download = `${slug}_package.txt`;
    document.body.appendChild(textLink);
    textLink.click();
    document.body.removeChild(textLink);
    URL.revokeObjectURL(textUrl);

    // Download image if available
    if (post.imageUrl) {
      try {
        const imgRes = await fetch(post.imageUrl);
        if (imgRes.ok) {
          const imgBlob = await imgRes.blob();
          const ext = imgBlob.type.includes('png') ? 'png' : imgBlob.type.includes('webp') ? 'webp' : 'jpg';
          const imgUrl = URL.createObjectURL(imgBlob);
          const imgLink = document.createElement('a');
          imgLink.href = imgUrl;
          imgLink.download = `${slug}.${ext}`;
          document.body.appendChild(imgLink);
          imgLink.click();
          document.body.removeChild(imgLink);
          URL.revokeObjectURL(imgUrl);
        }
      } catch (e) {
        console.warn('Image download failed:', e);
      }
    }

    // Mark as downloaded
    if (post.status === 'approved' || post.status === 'draft' || post.status === 'pending_approval') {
      await updatePost(post.id, 'mark_downloaded');
    }
    setDownloadingId(null);
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

  if (sessionStatus === 'loading' || loading || bizCtx.loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // No businesses at all — send to dashboard to add one
  if (bizCtx.noBusiness) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Found</h2>
        <p className="text-gray-500 mb-6">Analyze a website first so we know which business to create posts for.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add a Business
        </button>
      </div>
    );
  }

  // Multiple businesses and none selected — show picker
  if (bizCtx.needsSelection || showPicker) {
    return (
      <BusinessPickerGrid
        businesses={bizCtx.businesses}
        onSelect={(biz) => { bizCtx.setActiveBusiness(biz); setShowPicker(false); }}
      />
    );
  }

  const linkedCount = accounts.filter(a => a.isActive).length;
  const pendingCount = posts.filter(p => p.status === 'pending_approval').length;
  const approvedCount = posts.filter(p => p.status === 'approved').length;
  const postedCount = posts.filter(p => p.status === 'manually_posted').length;
  const downloadedCount = posts.filter(p => p.status === 'downloaded').length;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      {/* Active business banner */}
      {bizCtx.activeBusiness && (
        <ActiveBusinessBanner
          activeBusiness={bizCtx.activeBusiness}
          businessCount={bizCtx.businesses.length}
          onSwitch={() => setShowPicker(true)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-blue-600" />
            Social Post Queue
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Clark Kent scouts local news and writes posts for your business.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scoutForPosts}
            disabled={scouting || showStoryPicker || draftSubmitting}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-sm"
          >
            {scouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {scouting ? 'Scouting...' : 'Scout Stories'}
          </button>
          <button
            onClick={() => setShowDraftForm(v => !v)}
            disabled={scouting || draftSubmitting}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm ${
              showDraftForm
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'bg-white text-purple-700 border border-purple-200 hover:bg-purple-50'
            } disabled:opacity-60`}
          >
            <PenLine className="w-4 h-4" />
            My Own Post
          </button>
        </div>
      </div>

      {/* Scout mode selector */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 mr-1">Scout mode:</span>
        {([
          { value: 'local_only' as ScoutMode, label: '📍 Local Only', desc: 'Local news from your trade area' },
          { value: 'local_plus_interests' as ScoutMode, label: '📍+🏢 Local + Categories', desc: 'Local news plus your selected industries' },
          { value: 'interests_only' as ScoutMode, label: '🏢 Categories Only', desc: 'Industry news from your selected categories' },
        ]).map(mode => (
          <button
            key={mode.value}
            onClick={() => setScoutMode(mode.value)}
            disabled={scouting}
            title={mode.desc}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              scoutMode === mode.value
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            } disabled:opacity-60`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* ── Create From My Own Post Form ─────────────────────────── */}
      <AnimatePresence>
        {showDraftForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-white border border-purple-200 rounded-2xl shadow-sm overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-purple-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-purple-600" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Create From My Own Post</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Type or paste your draft — we&apos;ll polish the copy and create artwork</p>
                </div>
              </div>
              <button
                onClick={() => setShowDraftForm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Draft text — required */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Your Draft Post <span className="text-red-500">*</span></label>
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  placeholder="Type or paste your post draft here…"
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <p className="text-xs text-gray-400 mt-1">{draftText.length} characters</p>
              </div>

              {/* Platform + Tone row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Platform <span className="text-gray-400">(optional)</span></label>
                  <select
                    value={draftPlatform}
                    onChange={e => setDraftPlatform(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                  >
                    <option value="">Any / All</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="twitter">Twitter / X</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Tone <span className="text-gray-400">(optional)</span></label>
                  <select
                    value={draftTone}
                    onChange={e => setDraftTone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                  >
                    <option value="">Auto-detect</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="friendly">Friendly</option>
                    <option value="witty">Witty</option>
                    <option value="inspirational">Inspirational</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Generate art checkbox */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftGenerateArt}
                  onChange={e => setDraftGenerateArt(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <ImageIcon className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-700">Generate final art / image</span>
              </label>

              {/* Advanced options toggle */}
              <button
                type="button"
                onClick={() => setShowDraftAdvanced(v => !v)}
                className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800 transition-colors"
              >
                {showDraftAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showDraftAdvanced ? 'Hide' : 'Show'} advanced options
              </button>

              <AnimatePresence>
                {showDraftAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Call-to-Action <span className="text-gray-400">(optional)</span></label>
                      <input
                        type="text"
                        value={draftCta}
                        onChange={e => setDraftCta(e.target.value)}
                        placeholder='e.g. "Book your free consultation today"'
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Offer / Promotion <span className="text-gray-400">(optional)</span></label>
                      <input
                        type="text"
                        value={draftOffer}
                        onChange={e => setDraftOffer(e.target.value)}
                        placeholder='e.g. "20% off this weekend only"'
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Image / Art Direction <span className="text-gray-400">(optional)</span></label>
                      <input
                        type="text"
                        value={draftArtDirection}
                        onChange={e => setDraftArtDirection(e.target.value)}
                        placeholder='e.g. "Bright summer colors, beach theme, show our logo"'
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error */}
              {draftError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{draftError}</p>
                </div>
              )}


            </div>

            {/* Footer / submit */}
            <div className="px-5 py-4 border-t border-purple-100 bg-purple-50/50 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                1 polished post will be created{draftGenerateArt ? ' with artwork' : ''}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDraftForm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDraft}
                  disabled={draftSubmitting || !draftText.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-60"
                >
                  {draftSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {draftSubmitting ? 'Submitting…' : 'Polish & Create'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Generation Progress (real Tombstone task tracking) ─────── */}
      <AnimatePresence>
        {activeWorkflowIds.length > 0 && (
          <GenerationProgress
            key={activeWorkflowIds.join(',')}
            workflowIds={activeWorkflowIds}
            flowLabel={activeFlowLabel}
            onComplete={handleProgressComplete}
            onRetry={retryGeneration}
            onDismiss={handleProgressDismiss}
          />
        )}
      </AnimatePresence>

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

      {/* ── Story Picker ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showStoryPicker && (() => {
          const localCards = storyCards.filter(c => c.section === 'local');
          const industryCards = storyCards.filter(c => c.section === 'industry');
          const eventCards = storyCards.filter(c => c.section === 'event');
          const includesLocal = scoutMode !== 'interests_only';
          const includesInterests = scoutMode !== 'local_only';
          const sections = [
            ...(includesLocal ? [{ key: 'local', label: '📍 Local Stories', cards: localCards }] : []),
            ...(includesInterests ? [{ key: 'industry', label: '🏢 Industry Stories', cards: industryCards }] : []),
            { key: 'event', label: '🎉 Upcoming Events', cards: eventCards },
          ];

          return (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Pick Your Stories</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Select up to {MAX_STORIES} stories to turn into social posts</p>
                </div>
                <button
                  onClick={() => { setShowStoryPicker(false); setStoryCards([]); setSelectionError(null); }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {sections.map(sec => (
                  <div key={sec.key} className="px-5 py-4">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">{sec.label}</p>

                    {/* Missing location message for Local section */}
                    {sec.key === 'local' && missingLocation && sec.cards.length === 0 && (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
                        <MapPin className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                        Complete your business profile location to discover local stories.
                      </div>
                    )}

                    {/* Empty state for sections with cards expected but none found */}
                    {sec.cards.length === 0 && !(sec.key === 'local' && missingLocation) && (
                      <p className="text-xs text-gray-400 italic py-2">No stories found in this category.</p>
                    )}

                    <div className="space-y-2">
                      {sec.cards.map(card => {
                        const isSelected = selectedStoryIds.has(card.id);
                        const typeBadgeMap: Record<string, { bg: string; text: string }> = { local: { bg: 'bg-green-100', text: 'text-green-700' }, industry: { bg: 'bg-purple-100', text: 'text-purple-700' }, national: { bg: 'bg-gray-200', text: 'text-gray-600' } };
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
                                {card.source && (
                                  <span className="text-xs text-gray-500">{card.source}</span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${typeBadge.bg} ${typeBadge.text}`}>
                                  {card.sourceType}
                                </span>
                                {card.category && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                    {card.category}
                                  </span>
                                )}
                                {card.pubDate && (
                                  <span className="text-xs text-gray-400">{card.pubDate.split('T')[0]}</span>
                                )}
                              </div>
                              {card.summary && (
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{card.summary}</p>
                              )}
                              {card.relevance && (
                                <p className="text-xs text-blue-600 mt-0.5 italic">{card.relevance}</p>
                              )}
                              {card.link && (
                                <a
                                  href={card.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1"
                                >
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
                {selectionError && (
                  <p className="text-xs text-red-600 mb-2 font-medium">{selectionError}</p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {selectedStoryIds.size} of {MAX_STORIES} max selected
                    {selectedStoryIds.size === 0 && (
                      <span className="text-amber-600 ml-1">— select at least 1 story</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowStoryPicker(false); setStoryCards([]); setSelectionError(null); }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={generateFromSelected}
                      disabled={selectedStoryIds.size === 0 || scouting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                    >
                      {scouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Create {selectedStoryIds.size} Post{selectedStoryIds.size !== 1 ? 's' : ''}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Poll status banner */}
      <AnimatePresence>
        {pollStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              {polling ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
              ) : (
                <RefreshCw className="w-5 h-5 text-blue-600 shrink-0" />
              )}
              <p className="text-sm font-medium text-blue-800">{pollStatus}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => pollMissions(false)}
                disabled={polling}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {polling ? 'Checking...' : 'Check for Posts'}
              </button>
              <button onClick={() => setPollStatus(null)} className="text-blue-400 hover:text-blue-600">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Pending', value: pendingCount, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Approved', value: approvedCount, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Downloaded', value: downloadedCount, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Posted', value: postedCount, color: 'text-blue-600', bg: 'bg-blue-50' },
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
            {['', 'pending_approval', 'approved', 'downloaded', 'manually_posted', 'rejected'].map(s => (
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
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Main empty state */}
              <div className="text-center py-12 px-6">
                <Newspaper className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-600 mb-2">No social posts yet</h3>
                <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
                  Click &ldquo;Scout Stories&rdquo; to discover local and industry news, or click &ldquo;My Own Post&rdquo; to polish your own draft with professional copy editing and artwork.
                </p>
                <div className="flex items-center justify-center">
                  <button
                    onClick={scoutForPosts}
                    disabled={scouting || showStoryPicker}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {scouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {scouting ? 'Scouting Stories...' : 'Scout Stories'}
                  </button>
                </div>
              </div>

              {/* Link to existing ad assets on Dashboard */}
              <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
                <p className="text-xs text-gray-500 text-center mb-3">
                  <strong>Looking for your ad images?</strong> Your generated ad creatives (Website, News, Holiday) are on the Dashboard under each business.
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> View Dashboard &amp; Assets
                  </button>
                  <button
                    onClick={async () => {
                      setPolling(true);
                      await pollMissions(false);
                      await fetchPosts();
                      setPolling(false);
                    }}
                    disabled={polling}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-60"
                  >
                    {polling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {polling ? 'Checking...' : 'Check for Posts'}
                  </button>
                </div>
              </div>
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
                        <div className="relative w-full max-w-md mx-auto aspect-[2/3] bg-gray-100 rounded-lg overflow-hidden mb-3">
                          <div className="absolute inset-0 flex items-center justify-center text-gray-400 img-loading-indicator">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="w-6 h-6 animate-spin" />
                              <span className="text-xs">Loading image…</span>
                            </div>
                          </div>
                          <img
                            src={post.imageUrl}
                            alt={post.newsAngle || 'Social post image'}
                            className="relative w-full h-full object-contain z-10"
                            onLoad={(e) => {
                              const indicator = (e.target as HTMLImageElement).parentElement?.querySelector('.img-loading-indicator');
                              if (indicator) (indicator as HTMLElement).style.display = 'none';
                            }}
                            onError={(e) => {
                              const indicator = (e.target as HTMLImageElement).parentElement?.querySelector('.img-loading-indicator');
                              if (indicator) (indicator as HTMLElement).innerHTML = '<span class="text-xs text-gray-400">Image unavailable</span>';
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
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
                        {/* Copy Post Text */}
                        <button
                          onClick={() => copyCaption(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          {copiedId === post.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedId === post.id ? 'Copied!' : 'Copy Post Text'}
                        </button>

                        {/* Download Image (only when image exists) */}
                        {post.imageUrl && (
                          <button
                            onClick={() => downloadImage(post)}
                            disabled={downloadingId === post.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
                          >
                            {downloadingId === post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                            Download Image
                          </button>
                        )}

                        {/* Download Package */}
                        <button
                          onClick={() => downloadPostPackage(post)}
                          disabled={downloadingId === post.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                          {downloadingId === post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Download Package
                        </button>

                        {/* Mark as Manually Posted — for approved/downloaded posts */}
                        {(post.status === 'approved' || post.status === 'downloaded') && (
                          <button
                            onClick={() => updatePost(post.id, 'mark_manually_posted')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-lg text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Mark as Posted
                          </button>
                        )}

                        {/* Save as Draft — for pending posts */}
                        {post.status === 'pending_approval' && (
                          <button
                            onClick={() => updatePost(post.id, 'save_draft')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Save as Draft
                          </button>
                        )}

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
          <p className="text-sm text-gray-500 mb-6">Link your social accounts so posts can be tailored to each platform. Download the post package and manually publish to your accounts — auto-publishing is on the roadmap!</p>

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