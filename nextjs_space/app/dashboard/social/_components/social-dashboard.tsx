'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Newspaper, Send, CheckCircle2, XCircle,
  Edit3, Trash2, Copy, ExternalLink, Hash, Clock,
  Zap, RefreshCw, ChevronDown, ChevronUp, Plus, Link2,
  Facebook, Instagram, Youtube, MapPin, Eye, LayoutGrid,
  List, AlertCircle, Sparkles, Building2, Download, Check, Square, CheckSquare,
  PenLine, Image as ImageIcon, Coins, Lock, Lightbulb, AlertTriangle, Layers,
  CalendarPlus, Globe, Linkedin, UserCircle
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import { BusinessPickerGrid, ActiveBusinessBanner } from '@/components/business-picker';
import GenerationProgress from './generation-progress';
import CarouselViewer from './carousel-viewer';
import CarouselCreator from './carousel-creator';

/**
 * Build a proxy URL for an image key (R2 artifact path or legacy full URL).
 * Uses /api/social/image-proxy which resolves, fetches, and caches the image server-side.
 */
function proxyImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  // Non-R2 full URLs (S3, external) — pass through to proxy which handles them
  return `/api/social/image-proxy?key=${encodeURIComponent(imageUrl)}`;
}

/** Small component that displays images through the proxy */
function ResolvedImage({ imageUrl, alt, className }: { imageUrl: string; alt: string; className?: string }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error) {
    return <span className="text-xs text-gray-400">Image unavailable</span>;
  }

  return (
    <>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 z-0">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs">Loading image…</span>
          </div>
        </div>
      )}
      <img
        src={proxyImageUrl(imageUrl)}
        alt={alt}
        className={className || 'relative w-full h-full object-contain z-10'}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
    </>
  );
}

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
  tombstoneTaskId: string | null;
  workflowId: string | null;
  sourceName: string | null;
  sourceArticleTitle: string | null;
  sourceArticleUrl: string | null;
  cta: string | null;
  generationRunId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  totalGenerationTimeMs: number | null;
  businessId: string | null;
  businessName: string | null;
  businessWebsiteUrl: string | null;
  // Carousel fields
  carouselData: any | null;
  carouselSlides: any[] | null;
  carouselImageUrls: string[] | null;
  sourceAttribution: string | null;
  // GHL Social Planner fields
  ghlPostId: string | null;
  ghlSocialAccountName: string | null;
  ghlSocialOriginId: string | null;
  ghlStatus: string | null;
  publishTraceId: string | null;
  lastPublishAttemptAt: string | null;
  publishResponseSummary: string | null;
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
  generation_failed: { label: 'Generation Failed', color: 'text-red-700', bg: 'bg-red-50', icon: AlertTriangle },
  generation_incomplete: { label: 'Incomplete', color: 'text-orange-700', bg: 'bg-orange-50', icon: AlertTriangle },
  manually_posted: { label: 'Posted', color: 'text-blue-700', bg: 'bg-blue-50', icon: Send },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
  publishing: { label: 'Publishing...', color: 'text-blue-700', bg: 'bg-blue-50', icon: Loader2 },
  published_by_ghl: { label: 'Published', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  published_unverified: { label: 'Published (Unverified)', color: 'text-teal-700', bg: 'bg-teal-50', icon: CheckCircle2 },
  scheduled_in_ghl: { label: 'Scheduled in CRM', color: 'text-purple-700', bg: 'bg-purple-50', icon: Clock },
  failed_to_publish: { label: 'Publish Failed', color: 'text-red-700', bg: 'bg-red-50', icon: AlertTriangle },
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

// ── Create Post Dropdown ─────────────────────────────────────────────────────
function CreatePostDropdown({
  onScout, onDraft, onWeeklyTip, onCarousel,
  disabled, showDraftForm, showWeeklyTipForm, scouting, generating, activeBusinessId,
}: {
  onScout: () => void;
  onDraft: () => void;
  onWeeklyTip: () => void;
  onCarousel: () => void;
  disabled: boolean;
  showDraftForm: boolean;
  showWeeklyTipForm: boolean;
  scouting: boolean;
  generating: boolean;
  activeBusinessId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = scouting ? 'Scouting...' : generating ? 'Creating...' : 'Create Post';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-sm"
      >
        {(scouting || generating) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        {label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 w-56 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-50">
          <button
            onClick={() => { setOpen(false); onScout(); }}
            disabled={disabled}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 text-gray-700 disabled:opacity-40"
          >
            <Zap className="w-4 h-4 text-blue-600" /> Scout Story
          </button>
          <button
            onClick={() => { setOpen(false); onDraft(); }}
            disabled={disabled}
            className={`flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-40 ${
              showDraftForm ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
            }`}
          >
            <PenLine className="w-4 h-4 text-purple-600" /> My Own Post
          </button>
          <button
            onClick={() => { setOpen(false); onWeeklyTip(); }}
            disabled={disabled}
            className={`flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-40 ${
              showWeeklyTipForm ? 'text-amber-700 bg-amber-50' : 'text-gray-700'
            }`}
          >
            <Lightbulb className="w-4 h-4 text-amber-600" /> Weekly Tip
          </button>
          <button
            onClick={() => { setOpen(false); onCarousel(); }}
            disabled={!activeBusinessId}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 text-gray-700 disabled:opacity-40"
          >
            <Layers className="w-4 h-4 text-indigo-600" /> Article Carousel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function SocialDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoScout = searchParams.get('scout') === '1';
  const fromFeeds = searchParams.get('fromFeeds') === '1';
  const actionParam = searchParams.get('action');
  const bizCtx = useActiveBusiness();
  const [showPicker, setShowPicker] = useState(false);

  // State
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scouting, setScouting] = useState(false);
  const [scoutResult, setScoutResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'accounts'>('queue');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // GHL Social Planner accounts (replaces direct linking)
  const [ghlAccounts, setGhlAccounts] = useState<Array<{ id: string; name: string; platform: string; type: string; originId: string; avatar: string; isExpired: boolean; isDefault: boolean }>>([]);
  const [ghlAccountsLoading, setGhlAccountsLoading] = useState(false);
  const [ghlAccountsStatus, setGhlAccountsStatus] = useState<{ connected: boolean; reason: string; message: string } | null>(null);
  // GHL Publishing User state
  const [ghlPublishingUser, setGhlPublishingUser] = useState<{ id: string; name: string | null; email: string | null; verifiedAt: string | null } | null>(null);
  const [ghlPublishingUserLoading, setGhlPublishingUserLoading] = useState(false);
  const [showPublishingUserForm, setShowPublishingUserForm] = useState(false);
  const [pubUserIdInput, setPubUserIdInput] = useState('');
  const [pubUserNameInput, setPubUserNameInput] = useState('');
  const [pubUserEmailInput, setPubUserEmailInput] = useState('');
  const [pubUserSaving, setPubUserSaving] = useState(false);
  const [pubUserLookupStatus, setPubUserLookupStatus] = useState<string | null>(null);
  const [pubUserAvailable, setPubUserAvailable] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<{ imported: number; skipped: number; errors: number; checkedAt: string } | null>(null);

  // Credit balance for gating
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  // Scouting mode — default synced from business's contentSourceMode
  type ScoutMode = 'local_only' | 'local_plus_interests' | 'interests_only';
  const [scoutMode, setScoutMode] = useState<ScoutMode>('local_plus_interests');
  const [missingLocation, setMissingLocation] = useState(false);

  // Interest categories state
  type IndustryInfo = { key: string; label: string; description: string; icon: string; feedCount: number; enabled: boolean };
  const [industries, setIndustries] = useState<IndustryInfo[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [contentSettingsLoaded, setContentSettingsLoaded] = useState(false);
  const [savingContentSettings, setSavingContentSettings] = useState(false);
  const [contentSettingsSaved, setContentSettingsSaved] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(true);
  const contentSettingsLoadedBizRef = useRef<string | null>(null);

  // Load content settings (mode + categories) when business changes
  useEffect(() => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId || contentSettingsLoadedBizRef.current === bizId) return;
    contentSettingsLoadedBizRef.current = bizId;
    setContentSettingsLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/businesses/${bizId}/content-settings`);
        if (!res.ok) return;
        const data = await res.json();
        const validModes: ScoutMode[] = ['local_only', 'local_plus_interests', 'interests_only'];
        const mode = validModes.includes(data.contentSourceMode) ? data.contentSourceMode : 'local_plus_interests';
        setScoutMode(mode);
        setIndustries(data.industries ?? []);
        const enabled = new Set<string>((data.selectedInterestCategories ?? []) as string[]);
        setSelectedCategories(enabled);
      } catch (e) {
        console.error('[ContentSettings] Failed to load:', e);
      } finally {
        setContentSettingsLoaded(true);
      }
    })();
  }, [bizCtx.activeBusiness?.id]);

  // Save content settings (mode + categories)
  const saveContentSettings = useCallback(async (mode: ScoutMode, cats: Set<string>) => {
    const bizId = bizCtx.activeBusiness?.id;
    if (!bizId) return;
    setSavingContentSettings(true);
    setContentSettingsSaved(false);
    try {
      const res = await fetch(`/api/businesses/${bizId}/content-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSourceMode: mode,
          selectedInterestCategories: Array.from(cats),
        }),
      });
      if (res.ok) {
        setContentSettingsSaved(true);
        setTimeout(() => setContentSettingsSaved(false), 2000);
      }
    } catch (e) {
      console.error('[ContentSettings] Save failed:', e);
    } finally {
      setSavingContentSettings(false);
    }
  }, [bizCtx.activeBusiness?.id]);

  // Handle scout mode change — update local + save
  const handleScoutModeChange = useCallback((mode: ScoutMode) => {
    setScoutMode(mode);
    saveContentSettings(mode, selectedCategories);
  }, [selectedCategories, saveContentSettings]);

  // Handle category toggle — update local + save
  const handleCategoryToggle = useCallback((key: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveContentSettings(scoutMode, next);
      return next;
    });
  }, [scoutMode, saveContentSettings]);

  // Weekly Tip state
  const [showWeeklyTipForm, setShowWeeklyTipForm] = useState(false);
  const [showCarouselCreator, setShowCarouselCreator] = useState(false);
  const [wtTopic, setWtTopic] = useState('');
  const [wtCategory, setWtCategory] = useState('');
  const [wtAudience, setWtAudience] = useState('All customers');
  const [wtTone, setWtTone] = useState('Friendly & conversational');
  const [wtCta, setWtCta] = useState('');
  const [wtCustomTopic, setWtCustomTopic] = useState('');
  const [wtGenerateArt, setWtGenerateArt] = useState(true);
  const [wtSubmitting, setWtSubmitting] = useState(false);
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtSuggestions, setWtSuggestions] = useState<Array<{topic: string; category: string; why_it_fits?: string; suggested_business_tie_in?: string}>>([]);
  const [wtLoadingSuggestions, setWtLoadingSuggestions] = useState(false);
  const lastWeeklyTipParamsRef = useRef<any>(null);

  // Create From My Own Post state
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftArticleUrl, setDraftArticleUrl] = useState('');
  const [draftForceCarousel, setDraftForceCarousel] = useState(false);
  const [draftPlatform, setDraftPlatform] = useState('');
  const [draftTone, setDraftTone] = useState('');
  const [draftCta, setDraftCta] = useState('');
  const [draftOffer, setDraftOffer] = useState('');
  const [draftArtDirection, setDraftArtDirection] = useState('');
  const [draftGenerateArt, setDraftGenerateArt] = useState(true);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showDraftAdvanced, setShowDraftAdvanced] = useState(false);

  // Post Now / Schedule Post modal state
  const [postNowTarget, setPostNowTarget] = useState<SocialPost | null>(null);
  const [postNowAccountIds, setPostNowAccountIds] = useState<string[]>([]);
  const [postNowLoading, setPostNowLoading] = useState(false);
  const [postNowError, setPostNowError] = useState<string | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<SocialPost | null>(null);
  const [scheduleAccountIds, setScheduleAccountIds] = useState<string[]>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [scheduleTimezone, setScheduleTimezone] = useState('America/Denver');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Landing page per-post override
  const [landingPageConfig, setLandingPageConfig] = useState<{ url: string; enabled: boolean; ctaText: string } | null>(null);
  const [postNowIncludeLanding, setPostNowIncludeLanding] = useState(false);
  const [scheduleIncludeLanding, setScheduleIncludeLanding] = useState(false);
  // Landing page edit panel (Social Posts page)
  const [slpEditOpen, setSlpEditOpen] = useState(false);
  const [slpEditUrl, setSlpEditUrl] = useState('');
  const [slpEditEnabled, setSlpEditEnabled] = useState(false);
  const [slpEditCtaText, setSlpEditCtaText] = useState('Learn more here:');
  const [slpEditSaving, setSlpEditSaving] = useState(false);
  const [slpEditError, setSlpEditError] = useState<string | null>(null);
  const [slpEditUrlError, setSlpEditUrlError] = useState<string | null>(null);
  const [slpEditApplyTo, setSlpEditApplyTo] = useState<'future' | 'drafts' | 'scheduled'>('future');

  const [actionToast, setActionToast] = useState<string | null>(null);

  // Generation progress tracking (shared by both Scout Stories + My Own Post)
  const [activeWorkflowIds, setActiveWorkflowIds] = useState<string[]>([]);
  const [activeFlowLabel, setActiveFlowLabel] = useState<string>('Scout Stories');
  const [generating, setGenerating] = useState(false); // True when story-to-post pipeline is running
  const [activeGenerationRunId, setActiveGenerationRunId] = useState<string | null>(null);
  const [generationClickedAt, setGenerationClickedAt] = useState<string | null>(null);
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
  const activeBizName = bizCtx.activeBusiness?.businessName || 'Business';

  // Load credit balance
  useEffect(() => {
    if (!activeBusinessId) return;
    fetch(`/api/credits/balance?businessId=${activeBusinessId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCreditBalance(d.balance ?? 0); })
      .catch(() => {});
  }, [activeBusinessId]);

  // Clear stale data immediately when business changes
  const prevBizRef = useRef(activeBusinessId);
  useEffect(() => {
    if (prevBizRef.current !== activeBusinessId) {
      console.log('[SocialPosts] business changed, clearing stale posts', { from: prevBizRef.current, to: activeBusinessId });
      setPosts([]);
      setTotalPosts(0);
      prevBizRef.current = activeBusinessId;
    }
  }, [activeBusinessId]);

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
      console.log('[SocialPosts] loaded posts', { selected_business_id: activeBusinessId, post_count: data.posts?.length ?? 0 });
    } catch (e) {
      console.error('Failed to fetch posts:', e);
    }
  }, [statusFilter, activeBusinessId]);



  // Surface the polished "Your Post Assets" preview cards into the Post Queue
  // for the active business. Idempotent — safe to call on every load.
  const importPreviewPosts = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const res = await fetch('/api/social/import-preview-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: activeBusinessId }),
      });
      const data = await res.json();
      console.log('[SocialPosts] imported preview post assets', data);
    } catch (e) {
      console.error('Failed to import preview posts:', e);
    }
  }, [activeBusinessId]);

  // Poll Tombstone for pending missions and import completed posts
  const pollMissions = useCallback(async (silent = false) => {
    if (!silent) setPolling(true);
    try {
      const body: Record<string, any> = {};
      if (activeBusinessId) body.businessId = activeBusinessId;
      const res = await fetch('/api/social/missions/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log('[social] Poll result:', data);

      // Build sync result summary
      const importedCount = data.imported ?? 0;
      const skippedCount = data.skipped ?? (data.totalPosts ?? 0);
      const errorCount = data.importedIncomplete ?? 0;
      setLastSyncResult({
        imported: importedCount,
        skipped: skippedCount,
        errors: errorCount,
        checkedAt: new Date().toISOString(),
      });

      // Surface render failure info if present
      const failureInfo = data.renderFailureCount > 0
        ? (() => {
            const repairs = (data.renderFailures || []).filter((f: any) => f.repair_status === 'in_progress' || f.repair_status === 'repaired');
            if (repairs.length > 0) return ` (${repairs.length} render${repairs.length > 1 ? 's' : ''} being repaired)`;
            const blocks = (data.renderFailures || []).filter((f: any) => f.failure_type === 'moderation_block');
            if (blocks.length > 0) return ` (${blocks.length} blocked by content policy — repair in progress)`;
            return '';
          })()
        : '';

      if (data.imported > 0) {
        const incMsg = data.importedIncomplete > 0 ? ` (${data.importedIncomplete} incomplete/failed)` : '';
        setPollStatus(`✅ Imported ${data.importedComplete ?? data.imported} new post${(data.importedComplete ?? data.imported) > 1 ? 's' : ''}${incMsg}${failureInfo}!`);
        await fetchPosts(); // Refresh the list
      } else if (data.status === 'generating' || data.status === 'processing') {
        setPollStatus(`⏳ Posts are still being generated by the creative team...${failureInfo}`);
      } else if (data.status === 'all_imported') {
        setPollStatus(`✅ Sync complete: ${skippedCount} already existed, 0 new.${failureInfo ? ' ' + failureInfo.trim() : ''}`);
      } else if (data.status === 'no_missions' || data.status === 'no_content') {
        setPollStatus(data.message || 'No new posts found.');
      } else if (data.status === 'error') {
        setPollStatus('⚠️ Error polling creative workflow. Try again later.');
      } else {
        setPollStatus(failureInfo ? `⚠️ ${failureInfo.trim()}` : null);
      }
      return data;
    } catch (e) {
      console.error('Poll error:', e);
      setLastSyncResult({ imported: 0, skipped: 0, errors: 1, checkedAt: new Date().toISOString() });
      return null;
    } finally {
      if (!silent) setPolling(false);
    }
  }, [fetchPosts, activeBusinessId]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      // Import the polished preview post assets first so they appear in the queue.
      importPreviewPosts()
        .then(() => Promise.all([fetchPosts()]))
        .then(async () => {
          setLoading(false);
          // Auto-poll for any pending missions on page load
          await pollMissions(true);
        });
    }
  }, [sessionStatus, fetchPosts, pollMissions, importPreviewPosts]);

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

      console.log('[Scout] Request:', JSON.stringify(scoutBody));
      const scoutRes = await fetch('/api/rss/clark-kent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoutBody),
      });
      const scoutData = await scoutRes.json();
      console.log('[Scout] Response meta:', JSON.stringify(scoutData.meta));
      console.log('[Scout] Interest brief categories:', scoutData.brief?.interestBrief?.categories?.length ?? 'null');
      console.log('[Scout] Interest brief items:', scoutData.brief?.interestBrief?.summary?.totalItems ?? 'null');
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

      const industryCount = cards.filter(c => c.section === 'industry').length;
      const localCount = cards.filter(c => c.section === 'local').length;
      const eventCount = cards.filter(c => c.section === 'event').length;
      console.log(`[Scout] Cards built: ${cards.length} total (local=${localCount}, industry=${industryCount}, events=${eventCount})`);

      if (cards.length > 0) {
        const sectionNames = [...new Set(cards.map(c => c.section))];
        let message = `Clark Kent found ${cards.length} stories across ${sectionNames.length} ${sectionNames.length === 1 ? 'category' : 'categories'}. Select up to ${MAX_STORIES} to turn into posts.`;
        // Warn if interests were expected but none found
        if (includesInterests && industryCount === 0 && meta?.interestItemCount === 0) {
          message += ' (No industry stories found — check your Content Sources settings.)';
        }
        setScoutResult({ message, meta });
      } else if (includesLocal && !hasLocation) {
        setScoutResult({
          message: 'No location found on your business profile. Complete your profile to discover local stories.',
          meta,
        });
      } else {
        const debugHint = meta ? ` [mode=${meta.contentSourceMode}, biz=${meta.businessId || 'none'}, interests=${meta.includeInterests}, interestItems=${meta.interestItemCount ?? '?'}]` : '';
        console.warn('[Scout] No stories found.', debugHint);
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

  // Auto-trigger scouting when arriving from Content Sources with ?scout=1 OR top nav ?action=scout
  const autoScoutFired = useRef(false);
  useEffect(() => {
    const shouldScout = autoScout || actionParam === 'scout';
    if (shouldScout && !loading && !autoScoutFired.current && sessionStatus === 'authenticated' && bizCtx.activeBusiness) {
      autoScoutFired.current = true;
      router.replace('/dashboard/social', { scroll: false });
      scoutForPosts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScout, actionParam, loading, sessionStatus, bizCtx.activeBusiness]);

  // Auto-activate panels from top nav ?action= params (tip, draft, carousel)
  const actionFired = useRef(false);
  useEffect(() => {
    if (!actionParam || loading || actionFired.current || sessionStatus !== 'authenticated' || !bizCtx.activeBusiness) return;
    if (actionParam === 'scout') return; // handled above
    actionFired.current = true;
    router.replace('/dashboard/social', { scroll: false });
    if (actionParam === 'tip') {
      setShowWeeklyTipForm(true);
      setShowDraftForm(false);
    } else if (actionParam === 'draft') {
      setShowDraftForm(true);
      setShowWeeklyTipForm(false);
    } else if (actionParam === 'carousel') {
      setShowCarouselCreator(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam, loading, sessionStatus, bizCtx.activeBusiness]);

  // Auto-trigger generation when arriving from Content Feeds with ?fromFeeds=1
  const fromFeedsFired = useRef(false);
  useEffect(() => {
    if (fromFeeds && !loading && !fromFeedsFired.current && sessionStatus === 'authenticated' && bizCtx.activeBusiness) {
      fromFeedsFired.current = true;
      router.replace('/dashboard/social', { scroll: false });
      try {
        const raw = sessionStorage.getItem('feedScoutPayload');
        if (raw) {
          sessionStorage.removeItem('feedScoutPayload');
          const payload = JSON.parse(raw);
          const { brief, selectedIds, contentSourceMode } = payload;
          if (brief && selectedIds?.length > 0) {
            // Set brief data and trigger generation directly
            setScoutBriefData(brief);
            const selectedSet = new Set<string>(selectedIds);
            setSelectedStoryIds(selectedSet);
            // Build stories array from selected IDs (same logic as generateFromSelected)
            const stories: { headline: string; source?: string; category?: string; type: string; link?: string }[] = [];
            if (brief.interestBrief?.categories?.length > 0) {
              for (const cat of brief.interestBrief.categories) {
                for (const h of (cat.headlines || [])) {
                  const hid = h.id || `${cat.industry}-${h.title?.slice(0, 20)}`;
                  if (selectedSet.has(hid)) {
                    stories.push({ headline: h.title, source: h.source, category: cat.label, type: 'interest', link: h.link });
                  }
                }
              }
            }
            if (brief.rssBrief?.headlines?.length > 0) {
              for (const h of brief.rssBrief.headlines) {
                const hid = h.id || `local-${h.title?.slice(0, 20)}`;
                if (selectedSet.has(hid)) {
                  stories.push({ headline: h.title, source: h.source, category: 'Local News', type: 'local_news', link: h.link });
                }
              }
            }
            if (brief.upcomingEvents?.length > 0) {
              for (const e of brief.upcomingEvents) {
                const eid = e.id || `event-${e.name?.slice(0, 20)}`;
                if (selectedSet.has(eid)) {
                  stories.push({ headline: e.name, source: e.ideas || `${e.date}`, category: 'Events', type: 'event' });
                }
              }
            }
            if (stories.length > 0) {
              const clampedStories = stories.slice(0, 3);
              const enrichedBrief = {
                ...brief,
                stories: clampedStories,
                scoutSummary: `Generating ${clampedStories.length} individual post${clampedStories.length !== 1 ? 's' : ''} from selected stories.`,
              };
              setGenerating(true);
              setGenerationClickedAt(new Date().toISOString());
              sendToTombstone(enrichedBrief, null, new Date().toISOString())
                .catch(err => {
                  console.error('[FromFeeds] Generation error:', err);
                  setScoutError(err.message);
                })
                .finally(() => setGenerating(false));
            }
          }
        }
      } catch (e) {
        console.error('[FromFeeds] Failed to parse feed scout payload:', e);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromFeeds, loading, sessionStatus, bizCtx.activeBusiness]);

  // Phase 2: Build filtered summary and send to Tombstone
  const generateFromSelected = async () => {
    if (!scoutBriefData || selectedStoryIds.size === 0) return;
    const clickedAt = new Date().toISOString();
    setGenerating(true);
    setGenerationClickedAt(clickedAt);
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

      await sendToTombstone(brief, null, clickedAt);
    } catch (e: any) {
      console.error('Generate error:', e);
      setScoutError(e.message);
    }
    setGenerating(false);
  };

  // Shared: send brief to Tombstone and show real progress
  const sendToTombstone = async (brief: any, meta: any, clickedAt?: string) => {
    // Stash for retry
    lastScoutBriefRef.current = { brief, meta };

    const tombstoneRes = await fetch('/api/social/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scoutBrief: brief,
        businessId: activeBusinessId || undefined,
        clickedAt,
      }),
    });
    const tombstoneData = await tombstoneRes.json();

    // Always capture generationRunId — even on failures the run record exists
    const runId: string | null = tombstoneData.generationRunId || null;
    if (runId) setActiveGenerationRunId(runId);

    if (!tombstoneRes.ok) {
      // If we have a generationRunId, show the progress UI so the failure is visible
      if (runId) {
        setActiveWorkflowIds(tombstoneData.workflowIds || []);
        setActiveFlowLabel('Scout Stories');
      }
      throw new Error(tombstoneData.error || 'Failed to start creative workflow');
    }

    // HARD GUARD: Verify we got real workflow data
    const wfIds: string[] = tombstoneData.workflowIds || [];
    const taskCount: number = tombstoneData.taskCount || 0;

    if (wfIds.length === 0 || taskCount === 0) {
      console.error('[sendToTombstone] API returned success but no workflows/tasks', tombstoneData);
      // Show progress UI with whatever we have — it will show the failure from the generation run
      setActiveWorkflowIds(wfIds);
      setActiveFlowLabel('Scout Stories');
      throw new Error(
        `Post generation did not create a visible workflow. Check generation run #${runId || 'unknown'}.`
      );
    }

    setActiveWorkflowIds(wfIds);
    setActiveFlowLabel('Scout Stories');
    setScoutResult(null);

    console.log(`[sendToTombstone] SUCCESS runId=${runId} workflows=${wfIds.length} tasks=${taskCount}`);
  };

  // ── Weekly Tip ─────────────────────────────────────────────────────────
  const loadWeeklyTipSuggestions = useCallback(async (cat?: string) => {
    if (!activeBusinessId) return;
    setWtLoadingSuggestions(true);
    try {
      const q = cat ? `?category=${encodeURIComponent(cat)}` : '';
      const res = await fetch(`/api/businesses/${activeBusinessId}/weekly-tip-suggestions${q}`);
      if (res.ok) {
        const data = await res.json();
        setWtSuggestions(data.suggestions || []);
      }
    } catch (e) {
      console.error('Failed to load tip suggestions', e);
    } finally {
      setWtLoadingSuggestions(false);
    }
  }, [activeBusinessId]);

  // Load suggestions when form opens or category changes
  useEffect(() => {
    if (showWeeklyTipForm && activeBusinessId) {
      loadWeeklyTipSuggestions(wtCategory || undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeeklyTipForm, wtCategory, activeBusinessId]);

  const submitWeeklyTip = async () => {
    const effectiveTopic = wtCustomTopic.trim() || wtTopic;
    if (!effectiveTopic) {
      setWtError('Please select or enter a topic.');
      return;
    }
    if (!wtCategory) {
      setWtError('Please select a category.');
      return;
    }
    setWtSubmitting(true);
    setWtError(null);

    const params = {
      businessId: activeBusinessId,
      topic: effectiveTopic,
      category: wtCategory,
      audience: wtAudience,
      tone: wtTone,
      cta: wtCta || undefined,
      customTopic: wtCustomTopic.trim() || undefined,
      generateArt: wtGenerateArt,
    };
    lastWeeklyTipParamsRef.current = params;

    try {
      const res = await fetch('/api/social/create-weekly-tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create weekly tip');

      const wfIds: string[] = data.workflowIds || [];
      if (wfIds.length > 0) {
        setActiveWorkflowIds(wfIds);
        setActiveFlowLabel('Weekly Tip');
      }

      // Close & reset form
      setShowWeeklyTipForm(false);
      setScoutResult(null);
      setWtTopic('');
      setWtCategory('');
      setWtCustomTopic('');
      setWtCta('');
      setWtGenerateArt(true);
    } catch (e: any) {
      console.error('Weekly tip submit error:', e);
      setWtError(e.message);
    } finally {
      setWtSubmitting(false);
    }
  };

  // ── Create From My Own Post ─────────────────────────────────────────────
  const submitDraft = async () => {
    if (!draftText.trim() && !draftArticleUrl.trim()) {
      setDraftError('Please enter your draft post text or an article URL.');
      return;
    }
    setDraftSubmitting(true);
    setDraftError(null);

    const params: any = {
      draftText: draftText.trim() || undefined,
      articleUrl: draftArticleUrl.trim() || undefined,
      forceCarousel: draftForceCarousel || undefined,
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

      // If immediate result (article/carousel path — no Tombstone polling needed)
      if (data.immediate && data.postId) {
        // Refresh the post list to show the new post
        fetchPosts();
      }

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
      setDraftArticleUrl('');
      setDraftForceCarousel(false);
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
    if (activeFlowLabel === 'Weekly Tip' && lastWeeklyTipParamsRef.current) {
      setWtSubmitting(true);
      setWtError(null);
      try {
        const res = await fetch('/api/social/create-weekly-tip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastWeeklyTipParamsRef.current),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Retry failed');
        if (data.workflowIds?.length > 0) {
          setActiveWorkflowIds(data.workflowIds);
        }
      } catch (e: any) {
        setWtError(e.message);
      } finally {
        setWtSubmitting(false);
      }
    } else if (activeFlowLabel === 'My Own Post' && lastDraftParamsRef.current) {
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

  // Retry import for a failed/incomplete post — re-polls Tombstone and refreshes
  const retryImportForPost = async (postId: string) => {
    try {
      // Delete the failed shell record first
      await fetch(`/api/social/posts/${postId}`, { method: 'DELETE' });
      // Re-poll to attempt import again
      await pollMissions(false);
      await fetchPosts();
    } catch (e: any) {
      console.error('[retryImportForPost] Error:', e);
    }
  };

  const handleProgressComplete = async () => {
    // Import completed posts from Tombstone
    // Retry with delays — the Tombstone content queue may not be updated immediately after the workflow completes
    let pollResult = await pollMissions(false);
    // Use importedForActiveRun (posts matching the active GenerationRun's workflows) instead of total imported
    let importedForRun = pollResult?.importedForActiveRun ?? pollResult?.imported ?? 0;
    let totalImported = pollResult?.imported ?? 0;

    if (importedForRun === 0) {
      const MAX_RETRIES = 8;
      const RETRY_DELAY_MS = 4_000;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[handleProgressComplete] Poll returned 0 run-specific imports (${totalImported} total), retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        pollResult = await pollMissions(false);
        importedForRun = pollResult?.importedForActiveRun ?? pollResult?.imported ?? 0;
        totalImported = pollResult?.imported ?? 0;
        if (importedForRun > 0) {
          console.log(`[handleProgressComplete] Retry ${attempt} succeeded: imported ${importedForRun} post(s) for active run`);
          break;
        }
        // If total imports happened but not for this run, the run's render may still be processing
        if (totalImported > 0 && importedForRun === 0) {
          console.log(`[handleProgressComplete] Retry ${attempt}: ${totalImported} other posts imported, but 0 for active run — render may still be processing`);
        }
      }
    }

    // Refresh the post list
    await fetchPosts();

    // Post-import verification: check if imported post is visible in current queue
    if (importedForRun > 0 && activeBusinessId) {
      try {
        const verifyParams = new URLSearchParams();
        verifyParams.set('businessId', activeBusinessId);
        verifyParams.set('limit', '10');
        if (statusFilter) verifyParams.set('status', statusFilter);
        const verifyRes = await fetch(`/api/social/posts?${verifyParams}`);
        const verifyData = await verifyRes.json();
        const freshPosts: SocialPost[] = verifyData.posts || [];

        // Check if any recently created post (within last 5 min) exists
        const now = Date.now();
        const recentPosts = freshPosts.filter(p => {
          const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
          return now - created < 300_000;
        });

        if (recentPosts.length === 0) {
          // Imported but not visible — check without status filter to diagnose
          const allParams = new URLSearchParams();
          allParams.set('businessId', activeBusinessId);
          allParams.set('limit', '10');
          const allRes = await fetch(`/api/social/posts?${allParams}`);
          const allData = await allRes.json();
          const allFresh = (allData.posts || []).filter((p: SocialPost) => {
            const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
            return now - created < 300_000;
          });

          if (allFresh.length > 0) {
            const hidden = allFresh[0];
            const hiddenStatus = hidden.status || 'unknown';
            console.warn(`[handleProgressComplete] Post imported but hidden by filter. Status: ${hiddenStatus}`);
            setScoutError(
              `Post imported (${hiddenStatus}) but hidden by the "${statusFilter || 'All'}" filter. Clearing filter to show it.`
            );
            setStatusFilter('');
            await fetchPosts();
          } else {
            // Post was imported under a different business
            console.warn(`[handleProgressComplete] Imported ${importedForRun} post(s) but none visible for business ${activeBusinessId}`);
            setScoutError(
              `${importedForRun} post(s) imported but created under a different business. Switch to the business you generated for to see them.`
            );
          }
        }
      } catch (verifyErr) {
        console.error('[handleProgressComplete] Verification failed:', verifyErr);
      }
    } else if (importedForRun === 0 && activeGenerationRunId) {
      // Provide specific reason instead of vague message
      const pollStatus = pollResult?.status || 'unknown';
      const totalSkipped = pollResult?.skipped ?? 0;
      const diagnostics = pollResult?.diagnostics || [];
      let reason = '';
      if (pollStatus === 'no_content') {
        reason = 'The creative team finished processing but no render output was found in the content queue. The render may still be uploading — try Sync again in a minute.';
      } else if (pollStatus === 'no_captions') {
        reason = 'Render tasks were found but caption data is not yet available. Try Sync again shortly.';
      } else if (pollStatus === 'all_imported') {
        reason = `All ${totalSkipped} existing posts were already imported. The new post may not have appeared in the content queue yet — try Sync again in a minute.`;
      } else if (totalImported > 0 && importedForRun === 0) {
        reason = `${totalImported} post(s) from other workflows were imported, but this run's render has not appeared yet. Try Sync again in a minute.`;
      } else if (diagnostics.length > 0) {
        const reasons = diagnostics.map((d: any) => d.importError || d.status).join('; ');
        reason = `Generation produced output but import failed: ${reasons}`;
      } else {
        reason = 'The render may still be processing. Try clicking Sync from Tombstone in a minute.';
      }
      console.warn(`[handleProgressComplete] Run #${activeGenerationRunId}: importedForRun=0, totalImported=${totalImported}, status=${pollStatus}`);
      setScoutError(`Post generation completed but import pending. ${reason}`);
    }

    setActiveWorkflowIds([]);
    setGenerating(false);
    setActiveGenerationRunId(null);
    setGenerationClickedAt(null);
  };

  const handleProgressDismiss = () => {
    setActiveWorkflowIds([]);
    setGenerating(false);
    setActiveGenerationRunId(null);
    setGenerationClickedAt(null);
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

  // ── Fetch social landing page config for active business ──
  useEffect(() => {
    if (!activeBusinessId) { setLandingPageConfig(null); return; }
    fetch(`/api/businesses/${activeBusinessId}/social-landing-page`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setLandingPageConfig({
            url: data.defaultSocialLandingPageUrl || '',
            enabled: data.defaultSocialLandingPageEnabled || false,
            ctaText: data.defaultSocialCtaText || 'Learn more here:',
          });
        } else {
          setLandingPageConfig(null);
        }
      })
      .catch(() => setLandingPageConfig(null));
  }, [activeBusinessId]);

  // Populate SLP edit form when opened
  useEffect(() => {
    if (slpEditOpen && landingPageConfig) {
      setSlpEditUrl(landingPageConfig.url || '');
      setSlpEditEnabled(landingPageConfig.enabled);
      setSlpEditCtaText(landingPageConfig.ctaText || 'Learn more here:');
      setSlpEditSaving(false);
      setSlpEditError(null);
      setSlpEditUrlError(null);
      setSlpEditApplyTo('future');
    } else if (slpEditOpen && !landingPageConfig) {
      setSlpEditUrl('');
      setSlpEditEnabled(true);
      setSlpEditCtaText('Learn more here:');
      setSlpEditSaving(false);
      setSlpEditError(null);
      setSlpEditUrlError(null);
      setSlpEditApplyTo('future');
    }
  }, [slpEditOpen, landingPageConfig]);

  const validateSlpEditUrl = (value: string): boolean => {
    if (!value.trim()) { setSlpEditUrlError(null); return true; }
    if (!/^https?:\/\//i.test(value.trim())) {
      setSlpEditUrlError('URL must start with https:// or http://');
      return false;
    }
    try {
      const parsed = new URL(value.trim());
      if (!parsed.hostname || !parsed.hostname.includes('.')) throw new Error();
      if (/[\s<>{}|\\^`]/.test(value.trim())) throw new Error();
    } catch {
      setSlpEditUrlError('Please enter a valid landing page URL.');
      return false;
    }
    setSlpEditUrlError(null);
    return true;
  };

  const handleSlpEditSave = async () => {
    if (!activeBusinessId) return;
    if (!validateSlpEditUrl(slpEditUrl)) return;
    setSlpEditSaving(true);
    setSlpEditError(null);
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/social-landing-page`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: slpEditUrl.trim(),
          enabled: slpEditEnabled,
          ctaText: slpEditCtaText.trim(),
          applyTo: slpEditApplyTo,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setLandingPageConfig({
          url: data.defaultSocialLandingPageUrl || '',
          enabled: data.defaultSocialLandingPageEnabled || false,
          ctaText: data.defaultSocialCtaText || 'Learn more here:',
        });
        setSlpEditOpen(false);
        const msg = data.appliedCount > 0
          ? `Settings saved. Updated ${data.appliedCount} existing post${data.appliedCount !== 1 ? 's' : ''}.`
          : 'Social post settings saved!';
        setActionToast(msg);
        setTimeout(() => setActionToast(null), 5000);
      } else {
        setSlpEditError(data.error || 'Failed to save settings.');
        if (data.field === 'url') setSlpEditUrlError(data.error);
      }
    } catch {
      setSlpEditError('Network error. Please try again.');
    }
    setSlpEditSaving(false);
  };

  // ── Fetch social connections for active business ──
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

  useEffect(() => { fetchGhlAccounts(); }, [fetchGhlAccounts]);

  // ── Fetch GHL publishing user ──
  const fetchGhlPublishingUser = useCallback(async () => {
    if (!activeBusinessId) return;
    setGhlPublishingUserLoading(true);
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/ghl/publishing-user`);
      const data = await res.json();
      setGhlPublishingUser(data.savedUser || null);
      setPubUserLookupStatus(data.lookupStatus || null);
      setPubUserAvailable(data.availableUsers || []);
      if (data.savedUser) {
        setPubUserIdInput(data.savedUser.id);
        setPubUserNameInput(data.savedUser.name || '');
        setPubUserEmailInput(data.savedUser.email || '');
      }
    } catch {
      // Silently fail — user can still manually enter
    } finally {
      setGhlPublishingUserLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    if (ghlAccountsStatus?.connected) fetchGhlPublishingUser();
  }, [ghlAccountsStatus?.connected, fetchGhlPublishingUser]);

  const saveGhlPublishingUser = async (userId: string, userName?: string, userEmail?: string) => {
    if (!activeBusinessId || !userId.trim()) return;
    setPubUserSaving(true);
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/ghl/publishing-user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ghlUserId: userId, ghlUserName: userName, ghlUserEmail: userEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setGhlPublishingUser(data.savedUser);
        setShowPublishingUserForm(false);
      }
    } catch { /* handled */ }
    setPubUserSaving(false);
  };

  // ── Post eligibility check ──
  const isPostEligible = (post: SocialPost) => {
    if (!post.caption?.trim()) return { eligible: false, reason: 'Caption is missing. Edit or regenerate before publishing.' };
    const hasImage = !!post.imageUrl || (Array.isArray((post as any).carouselImageUrls) && (post as any).carouselImageUrls.length > 0);
    if (!hasImage) return { eligible: false, reason: 'Image is missing. Edit or regenerate before publishing.' };
    if (post.status === 'generation_failed' || post.status === 'generation_incomplete') return { eligible: false, reason: 'Post generation failed or is incomplete. Fix or regenerate before publishing.' };
    if (['manually_posted', 'published', 'published_by_ghl', 'published_unverified', 'publishing'].includes(post.status)) return { eligible: false, reason: 'This post has already been published.' };
    return { eligible: true, reason: '' };
  };

  // ── Post Now handler ──
  const openPostNowModal = (post: SocialPost) => {
    setPostNowTarget(post);
    // Pre-select the default account if available, otherwise empty
    const defaultAcct = ghlAccounts.find(a => a.isDefault);
    setPostNowAccountIds(defaultAcct ? [defaultAcct.id] : []);
    setPostNowIncludeLanding(landingPageConfig?.enabled && !!landingPageConfig?.url ? true : false);
    setPostNowError(null);
    setPostNowLoading(false);
  };

  const [postNowResult, setPostNowResult] = useState<any>(null);

  const executePostNow = async () => {
    if (!postNowTarget) return;
    setPostNowLoading(true);
    setPostNowError(null);
    setPostNowResult(null);
    try {
      const res = await fetch(`/api/social/posts/${postNowTarget.id}/post-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: postNowAccountIds, includeLandingPage: postNowIncludeLanding }),
      });
      const data = await res.json();
      setPostNowResult(data);
      if (res.ok && data.success) {
        const resultsList: any[] = data.results || [];
        const succeededNames = resultsList.filter((r: any) => r.success).map((r: any) => r.accountName).join(', ');
        const toastMsg = data.partial_success
          ? `Partially published — succeeded: ${succeededNames}`
          : `Published through Launch CRM${succeededNames ? ` → ${succeededNames}` : ''}`;
        setActionToast(toastMsg);
        setTimeout(() => setActionToast(null), 6000);
        await fetchPosts();
      } else {
        // All channels failed
        const resultsList: any[] = data.results || [];
        if (resultsList.length > 0) {
          const errors = resultsList.filter((r: any) => !r.success).map((r: any) => `${r.accountName}: ${r.error}`).join(' | ');
          setPostNowError(errors || data.error || 'Failed to publish post.');
        } else {
          setPostNowError(data.error || data.message || 'Failed to publish post.');
        }
      }
    } catch {
      setPostNowError('Network error. Please try again.');
    }
    setPostNowLoading(false);
  };

  // ── Schedule Post handler ──
  const openScheduleModal = (post: SocialPost) => {
    setScheduleTarget(post);
    const defaultAcct = ghlAccounts.find(a => a.isDefault);
    setScheduleAccountIds(defaultAcct ? [defaultAcct.id] : []);
    setScheduleIncludeLanding(landingPageConfig?.enabled && !!landingPageConfig?.url ? true : false);
    // Default to tomorrow 10 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduleDate(tomorrow.toISOString().split('T')[0]);
    setScheduleTime('10:00');
    setScheduleTimezone('America/Denver');
    setScheduleError(null);
    setScheduleLoading(false);
  };

  const executeSchedule = async () => {
    if (!scheduleTarget || !scheduleDate || !scheduleTime) return;
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      const res = await fetch(`/api/social/posts/${scheduleTarget.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor, timezone: scheduleTimezone, accountIds: scheduleAccountIds, includeLandingPage: scheduleIncludeLanding }),
      });
      const data = await res.json();
      if (res.ok) {
        setScheduleTarget(null);
        setActionToast('Post scheduled successfully!');
        setTimeout(() => setActionToast(null), 5000);
        await fetchPosts();
      } else {
        setScheduleError(data.message || data.error || 'Failed to schedule post.');
      }
    } catch {
      setScheduleError('Network error. Please try again.');
    }
    setScheduleLoading(false);
  };

  const toggleChannelId = (channelId: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(channelId) ? list.filter(id => id !== channelId) : [...list, channelId]);
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const downloadImage = async (post: SocialPost) => {
    if (!post.imageUrl) return;
    setDownloadingId(post.id);
    const slug = (post.caption || 'post').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/, '');
    try {
      const imgRes = await fetch(proxyImageUrl(post.imageUrl));
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
        const imgRes = await fetch(proxyImageUrl(post.imageUrl));
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

  const linkedCount = ghlAccounts.length;
  const pendingCount = posts.filter(p => p.status === 'pending_approval').length;
  const approvedCount = posts.filter(p => p.status === 'approved').length;
  const postedCount = posts.filter(p => ['manually_posted', 'published_by_ghl', 'published_unverified'].includes(p.status)).length;
  const downloadedCount = posts.filter(p => p.status === 'downloaded').length;
  const failedCount = posts.filter(p => p.status === 'generation_failed').length;

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
          {/* Compact Create Post dropdown */}
          <CreatePostDropdown
            onScout={scoutForPosts}
            onDraft={() => setShowDraftForm(v => !v)}
            onWeeklyTip={() => { setShowWeeklyTipForm(v => !v); if (showDraftForm) setShowDraftForm(false); }}
            onCarousel={() => setShowCarouselCreator(true)}
            disabled={scouting || generating || draftSubmitting}
            showDraftForm={showDraftForm}
            showWeeklyTipForm={showWeeklyTipForm}
            scouting={scouting}
            generating={generating}
            activeBusinessId={activeBusinessId}
          />
          {/* Persistent Sync from Tombstone button */}
          {activeBusinessId && (
            <button
              onClick={() => pollMissions(false)}
              disabled={polling}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-60"
              title="Sync completed posts from Tombstone"
            >
              {polling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {polling ? 'Syncing...' : 'Sync from Tombstone'}
            </button>
          )}
        </div>
      </div>
      {/* Sync result summary */}
      {lastSyncResult && (
        <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
          <span>Last sync: {new Date(lastSyncResult.checkedAt).toLocaleTimeString('en-US', { timeZone: 'America/Denver' })}</span>
          <span className="text-emerald-600 font-medium">{lastSyncResult.imported} imported</span>
          <span>{lastSyncResult.skipped} already existed</span>
          {lastSyncResult.errors > 0 && <span className="text-red-600">{lastSyncResult.errors} errors</span>}
        </div>
      )}

      {/* Scout mode selector + category picker */}
      <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 mr-1">Scout mode:</span>
          {([
            { value: 'local_only' as ScoutMode, label: '📍 Local Only', desc: 'Local news from your trade area' },
            { value: 'local_plus_interests' as ScoutMode, label: '📍+🏢 Local + Categories', desc: 'Local news plus your selected industries' },
            { value: 'interests_only' as ScoutMode, label: '🏢 Categories Only', desc: 'Industry news from your selected categories' },
          ]).map(mode => (
            <button
              key={mode.value}
              onClick={() => handleScoutModeChange(mode.value)}
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
          {/* Save status indicator */}
          {savingContentSettings && (
            <span className="flex items-center gap-1 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Saving...</span>
          )}
          {contentSettingsSaved && !savingContentSettings && (
            <span className="flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Saved</span>
          )}
        </div>

        {/* Category/Interest selector — shown when mode includes interests */}
        {scoutMode !== 'local_only' && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => setShowCategoryPicker(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-blue-700 transition-colors py-1 px-1 -ml-1 rounded hover:bg-blue-50"
            >
              {showCategoryPicker ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Interest Categories ({selectedCategories.size} selected)
            </button>
            {showCategoryPicker && (
              <div className="mt-2 flex flex-wrap gap-2">
                {industries.length === 0 && contentSettingsLoaded && (
                  <p className="text-xs text-gray-400 italic">No categories available. Check your Content Feeds settings.</p>
                )}
                {industries.map(ind => {
                  const isActive = selectedCategories.has(ind.key);
                  return (
                    <button
                      key={ind.key}
                      onClick={() => handleCategoryToggle(ind.key)}
                      disabled={savingContentSettings}
                      title={ind.description}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100 hover:text-gray-700'
                      } disabled:opacity-60`}
                    >
                      <span>{ind.icon}</span>
                      <span>{ind.label}</span>
                      {isActive && <Check className="w-3 h-3 text-blue-600" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Scout Stories action button */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {scoutMode === 'local_only'
              ? 'Scout will find local news from your trade area.'
              : selectedCategories.size === 0
                ? 'Select at least one category above, then scout for stories.'
                : `Ready to scout ${selectedCategories.size} categor${selectedCategories.size === 1 ? 'y' : 'ies'}${scoutMode === 'local_plus_interests' ? ' + local news' : ''}.`
            }
          </p>
          <button
            onClick={scoutForPosts}
            disabled={scouting || generating || (scoutMode !== 'local_only' && selectedCategories.size === 0)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {scouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {scouting ? 'Scouting...' : 'Scout Stories'}
          </button>
        </div>
      </div>

      {/* ── Weekly Tip Form ─────────────────────────────────────── */}
      <AnimatePresence>
        {showWeeklyTipForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 bg-white border border-amber-200 rounded-2xl shadow-sm overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-amber-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Create a Weekly Tip Post</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Share helpful expertise — we&apos;ll craft an engaging post with artwork</p>
                </div>
              </div>
              <button
                onClick={() => setShowWeeklyTipForm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Topic Category <span className="text-red-500">*</span></label>
                <select
                  value={wtCategory}
                  onChange={e => setWtCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                >
                  <option value="">Select a category…</option>
                  {['Seasonal Tip','Maintenance Reminder','Customer FAQ','How-To / Checklist','Safety / Preparedness','Problem / Solution','Local Lifestyle','Myth-Busting','Offer Tie-In'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Suggested topics */}
              {wtCategory && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Suggested Topic
                    {wtLoadingSuggestions && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                  </label>
                  {wtSuggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {wtSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setWtTopic(s.topic); setWtCustomTopic(''); }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            wtTopic === s.topic && !wtCustomTopic
                              ? 'bg-amber-100 border-amber-400 text-amber-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-amber-300 hover:bg-amber-50'
                          }`}
                          title={s.why_it_fits || s.suggested_business_tie_in || ''}
                        >
                          {s.topic}
                        </button>
                      ))}
                    </div>
                  ) : !wtLoadingSuggestions ? (
                    <p className="text-xs text-gray-400">No suggestions yet — select a category or type your own below.</p>
                  ) : null}
                </div>
              )}

              {/* Custom topic override */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Or type your own topic</label>
                <input
                  type="text"
                  value={wtCustomTopic}
                  onChange={e => setWtCustomTopic(e.target.value)}
                  placeholder="e.g. 5 signs your furnace needs maintenance"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Audience + Tone row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Audience</label>
                  <select
                    value={wtAudience}
                    onChange={e => setWtAudience(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  >
                    {['All customers','New customers','Returning customers','Budget-conscious','Premium/high-value','Seasonal/occasional','Local community','Families','Business owners'].map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Tone</label>
                  <select
                    value={wtTone}
                    onChange={e => setWtTone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  >
                    {['Friendly & conversational','Professional & authoritative','Warm & empathetic','Energetic & motivating','Educational & helpful','Casual & relatable'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* CTA */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Call-to-Action <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={wtCta}
                  onChange={e => setWtCta(e.target.value)}
                  placeholder="e.g. Call us for a free estimate"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Generate art toggle + submit */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setWtGenerateArt(v => !v)}
                      className="text-amber-600"
                    >
                      {wtGenerateArt ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                    Generate artwork
                  </label>
                  {creditBalance !== null && (
                    <span className={`text-xs font-medium ${creditBalance <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {creditBalance} credit{creditBalance !== 1 ? 's' : ''} remaining
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {wtError && <p className="text-xs text-red-600">{wtError}</p>}
                  <button
                    onClick={submitWeeklyTip}
                    disabled={wtSubmitting || (!wtTopic && !wtCustomTopic.trim()) || !wtCategory}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-60"
                  >
                    {wtSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {wtSubmitting ? 'Creating…' : 'Create Tip Post'}
                  </button>
                </div>
              </div>
              {/* Credit enforcement suspended – CREDIT_ENFORCEMENT_ENABLED=false */}
              {false as boolean && creditBalance !== null && creditBalance <= 0 && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-lg">
                  <Lock className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs text-red-700">You need at least 1 credit to create a post. Purchase more in Settings.</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
              {/* Article URL — optional */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Article URL <span className="text-gray-400">(optional)</span>
                </label>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="url"
                    value={draftArticleUrl}
                    onChange={e => setDraftArticleUrl(e.target.value)}
                    placeholder="Paste an article URL to create a post from it…"
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Share interesting articles not in your news feeds — we&apos;ll create a branded post from it</p>
              </div>

              {/* Draft text */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Your Draft Post {!draftArticleUrl.trim() && <span className="text-red-500">*</span>}
                  {draftArticleUrl.trim() && <span className="text-gray-400">(optional — adds your angle to the article)</span>}
                </label>
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  placeholder={draftArticleUrl.trim()
                    ? 'Add your angle or talking points (optional)…'
                    : 'Type or paste your post draft here…'
                  }
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

              {/* Checkboxes: generate art + carousel format */}
              <div className="space-y-2">
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftForceCarousel || !!draftArticleUrl.trim()}
                    onChange={e => setDraftForceCarousel(e.target.checked)}
                    disabled={!!draftArticleUrl.trim()}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:opacity-50"
                  />
                  <Layers className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700">
                    Carousel format
                    <span className="text-xs text-gray-400 ml-1">
                      {draftArticleUrl.trim()
                        ? '(auto for articles)'
                        : '(auto-detects lists, events, tips)'}
                    </span>
                  </span>
                </label>
              </div>

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
            <div className="px-5 py-4 border-t border-purple-100 bg-purple-50/50 space-y-3">
              {/* Credit info for draft */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  Image post uses 1 credit
                </span>
                {creditBalance !== null && (
                  <span className={`text-xs font-medium ${creditBalance <= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {creditBalance} credit{creditBalance !== 1 ? 's' : ''} remaining
                  </span>
                )}
              </div>
              {/* Credit enforcement suspended – CREDIT_ENFORCEMENT_ENABLED=false */}
              {false as boolean && creditBalance !== null && creditBalance <= 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Lock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">You&apos;re out of credits</p>
                    <p className="text-xs text-amber-600 mt-0.5">Add credits to create more posts. Recharge checkout coming soon.</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {draftArticleUrl.trim()
                    ? `Article will be turned into a ${draftGenerateArt ? 'visual ' : ''}post${(draftForceCarousel || draftArticleUrl.trim()) ? ' (carousel if list-based)' : ''}`
                    : `1 polished post will be created${draftGenerateArt ? ' with artwork' : ''}${draftForceCarousel ? ' (carousel if list-based)' : ''}`
                  }
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
                    disabled={draftSubmitting || (!draftText.trim() && !draftArticleUrl.trim())}
                    className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-60"
                  >
                    {draftSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {draftSubmitting
                      ? (draftArticleUrl.trim() ? 'Creating post…' : 'Submitting…')
                      : (draftArticleUrl.trim() ? 'Create From Article' : 'Polish & Create')
                    }
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Generation Progress (real Tombstone task tracking) ─────── */}
      <AnimatePresence>
        {(activeWorkflowIds.length > 0 || activeGenerationRunId) && (
          <GenerationProgress
            key={activeGenerationRunId || activeWorkflowIds.join(',')}
            workflowIds={activeWorkflowIds}
            flowLabel={activeFlowLabel}
            generationRunId={activeGenerationRunId}
            clickedAt={generationClickedAt}
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
                {/* Credit info */}
                {selectedStoryIds.size > 0 && (
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Coins className="w-3 h-3" />
                      Image post uses 1 credit per story
                    </span>
                    {creditBalance !== null && (
                      <span className={`text-xs font-medium ${creditBalance <= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        Balance: {creditBalance} credit{creditBalance !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}
                {/* Credit enforcement suspended – CREDIT_ENFORCEMENT_ENABLED=false */}
                {false as boolean && creditBalance !== null && creditBalance <= 0 && selectedStoryIds.size > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-2">
                    <Lock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">You&apos;re out of credits</p>
                      <p className="text-xs text-amber-600 mt-0.5">Add credits to create more posts. Recharge checkout coming soon.</p>
                    </div>
                  </div>
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
                      disabled={selectedStoryIds.size === 0 || generating}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                    >
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {generating ? 'Creating...' : `Create ${selectedStoryIds.size} Post${selectedStoryIds.size !== 1 ? 's' : ''}`}
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

      {/* Default Social Landing Page Panel */}
      {activeBusinessId && (
        <div className="mb-6">
          {landingPageConfig?.enabled && landingPageConfig?.url ? (
            <div className="bg-white border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Link2 className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Default Social Landing Page</p>
                  <p className="text-xs text-gray-500 mt-0.5">Current destination:</p>
                  <a
                    href={landingPageConfig.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium break-all"
                  >
                    {landingPageConfig.url}
                  </a>
                  <p className="text-xs text-gray-400 mt-1">New social posts will include this link by default.</p>
                  {landingPageConfig.ctaText && landingPageConfig.ctaText !== 'Learn more here:' && (
                    <p className="text-xs text-gray-500 mt-0.5">CTA: <span className="font-medium">{landingPageConfig.ctaText}</span></p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setSlpEditOpen(true)}
                  className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >Change</button>
                <button
                  onClick={async () => {
                    try {
                      await fetch(`/api/businesses/${activeBusinessId}/social-landing-page`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: landingPageConfig.url, enabled: false, ctaText: landingPageConfig.ctaText, applyTo: 'future' }),
                      });
                      setLandingPageConfig(prev => prev ? { ...prev, enabled: false } : null);
                      setActionToast('Landing page disabled for this business.');
                      setTimeout(() => setActionToast(null), 4000);
                    } catch {}
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                >Disable</button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 border-dashed rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Link2 className="w-4 h-4 text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">No default social landing page set.</p>
                  <p className="text-xs text-gray-500 mt-0.5">Add one so social posts have a clear traffic destination.</p>
                </div>
              </div>
              <button
                onClick={() => setSlpEditOpen(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex-shrink-0"
              >Add landing page</button>
            </div>
          )}
        </div>
      )}

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
              <span className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Publish Options</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Post Queue Tab ──────────────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <div>
          {/* Filter bar */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {['', 'pending_approval', 'approved', 'downloaded', 'manually_posted', 'published_by_ghl', 'published_unverified', 'scheduled_in_ghl', 'failed_to_publish', 'publishing', 'rejected', 'generation_failed', 'generation_incomplete'].map(s => (
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
                  Click &ldquo;Scout Stories&rdquo; to discover local and industry news, &ldquo;My Own Post&rdquo; to polish your own draft, or &ldquo;Weekly Tip&rdquo; to share helpful expertise with a professionally crafted post.
                </p>
                <div className="flex items-center justify-center">
                  <button
                    onClick={scoutForPosts}
                    disabled={scouting || showStoryPicker}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {(scouting || generating) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {scouting ? 'Scouting Stories...' : generating ? 'Creating post...' : 'Scout Stories'}
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
                          {post.businessName && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                              <Building2 className="w-3 h-3" />
                              {post.businessName}
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

                      {/* Business mismatch warning */}
                      {activeBusinessId && post.businessId && post.businessId !== activeBusinessId && (
                        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <p className="text-xs text-amber-700">
                            This post belongs to <strong>{post.businessName || 'another business'}</strong> — not the currently selected business.
                          </p>
                        </div>
                      )}

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

                      {/* Generation failed / incomplete diagnostic banner */}
                      {(post.status === 'generation_failed' || post.status === 'generation_incomplete') && (() => {
                        const isFailed = post.status === 'generation_failed';
                        const borderColor = isFailed ? 'border-red-200' : 'border-orange-200';
                        const bgColor = isFailed ? 'bg-red-50' : 'bg-orange-50';
                        const iconColor = isFailed ? 'text-red-500' : 'text-orange-500';
                        const titleColor = isFailed ? 'text-red-700' : 'text-orange-700';
                        const detailColor = isFailed ? 'text-red-600' : 'text-orange-600';
                        const title = isFailed ? 'Generation failed — no usable output' : 'Generation incomplete — partial output';
                        // Detect missing fields
                        const missingFields: string[] = [];
                        if (!post.caption?.trim() || post.caption.startsWith('[Generation')) missingFields.push('caption');
                        if (!post.imageUrl) missingFields.push('image');
                        if (!post.cta) missingFields.push('CTA');
                        if (!post.sourceName && !post.sourceArticleTitle) missingFields.push('source attribution');
                        if (!post.sourceArticleUrl) missingFields.push('source URL');
                        return (
                          <div className={`mb-3 p-3 ${bgColor} border ${borderColor} rounded-lg`}>
                            <div className="flex items-start gap-2">
                              <AlertTriangle className={`w-4 h-4 ${iconColor} mt-0.5 flex-shrink-0`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium ${titleColor}`}>{title}</p>
                                <div className="text-xs mt-1 space-y-0.5">
                                  {post.workflowId && <p className={detailColor}>Workflow: <span className="font-mono">{post.workflowId}</span></p>}
                                  {post.tombstoneTaskId && <p className={detailColor}>Task: <span className="font-mono">{post.tombstoneTaskId}</span></p>}
                                  {post.generationRunId && <p className={detailColor}>Run: <span className="font-mono">{post.generationRunId}</span></p>}
                                  {post.businessName && <p className={detailColor}>Business: {post.businessName}</p>}
                                  {post.sourceArticleTitle && <p className={detailColor}>Source: {post.sourceArticleTitle}</p>}
                                  {post.sourceArticleUrl && (
                                    <a href={post.sourceArticleUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-1">
                                      Source URL <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                  {missingFields.length > 0 && (
                                    <p className={`${detailColor} font-medium mt-1`}>Missing: {missingFields.join(', ')}</p>
                                  )}
                                </div>
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => retryImportForPost(post.id)}
                                    className="px-2.5 py-1 text-xs font-medium bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 transition-colors"
                                  >
                                    ↻ Retry Import
                                  </button>
                                  {post.workflowId && (
                                    <a
                                      href={`/admin?tab=tasks&workflow=${post.workflowId}`}
                                      className="px-2.5 py-1 text-xs font-medium bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 transition-colors"
                                    >
                                      View Workflow
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Post image / Carousel — displayed prominently above caption */}
                      {post.postType === 'carousel' && post.carouselImageUrls && post.carouselImageUrls.length > 0 ? (
                        <CarouselViewer
                          slides={post.carouselSlides as any[] || []}
                          imageUrls={post.carouselImageUrls}
                          sourceAttribution={post.sourceAttribution || ''}
                          onDownload={() => downloadImage(post)}
                          downloading={downloadingId === post.id}
                        />
                      ) : post.imageUrl ? (
                        <div className="mb-3">
                          <div className="relative w-full max-w-md mx-auto aspect-[4/5] bg-gray-100 rounded-lg overflow-hidden">
                            <ResolvedImage
                              imageUrl={post.imageUrl}
                              alt={post.newsAngle || 'Social post image'}
                            />
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => window.open(proxyImageUrl(post.imageUrl!), '_blank')}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Eye className="w-3 h-3" /> View Full Image
                            </button>
                            <button
                              onClick={() => downloadImage(post)}
                              disabled={downloadingId === post.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                            >
                              {downloadingId === post.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              Download
                            </button>
                          </div>
                        </div>
                      ) : post.tombstoneTaskId && (post.status === 'pending_approval' || post.status === 'approved' || post.status === 'downloaded') ? (
                        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-amber-700">Image generated but URL unavailable</p>
                              <p className="text-xs text-amber-600 mt-0.5">Task #{post.tombstoneTaskId} — the render completed but the image URL could not be resolved. Try re-polling or check the workflow directly.</p>
                            </div>
                          </div>
                        </div>
                      ) : null}

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

                      {/* Rendering guard: caption warning */}
                      {post.status !== 'generation_failed' && post.status !== 'generation_incomplete' && !post.caption?.trim() && (
                        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          <p className="text-xs text-amber-700">No caption available for this post.</p>
                        </div>
                      )}

                      {/* Rendering guard: source missing */}
                      {post.status !== 'generation_failed' && post.status !== 'generation_incomplete' && post.tombstoneTaskId && !post.sourceName && !post.sourceArticleTitle && !post.sourceArticleUrl && (
                        <div className="mb-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <p className="text-xs text-gray-500">No source attribution available.</p>
                        </div>
                      )}

                      {/* Rendering guard: debug info when workflowId/taskId missing */}
                      {post.tombstoneTaskId && !post.workflowId && (
                        <div className="mb-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <p className="text-xs text-gray-500">Task <span className="font-mono">{post.tombstoneTaskId}</span> — no workflow ID linked.</p>
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

                      {/* CTA */}
                      {post.cta && (
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">CTA</span>
                          <span className="text-xs text-gray-600 font-medium">{post.cta}</span>
                        </div>
                      )}

                      {/* Source Article */}
                      {(post.sourceName || post.sourceArticleTitle || post.sourceArticleUrl) ? (
                        <div className="mb-3 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-1">Source Article</p>
                          {post.sourceArticleTitle && (
                            <p className="text-xs font-medium text-gray-700 mb-0.5">{post.sourceArticleTitle}</p>
                          )}
                          {post.sourceName && (
                            <p className="text-[10px] text-gray-500">via {post.sourceName}</p>
                          )}
                          {post.sourceArticleUrl && (
                            <a href={post.sourceArticleUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-700 underline break-all mt-1 inline-block">
                              {post.sourceArticleUrl}
                            </a>
                          )}
                        </div>
                      ) : post.tombstoneTaskId ? (
                        <div className="mb-3 p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                          <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                            <span className="text-amber-500">⚠</span>
                            Source article link missing — post may be incomplete
                          </p>
                        </div>
                      ) : null}

                      {/* Task / Workflow details */}
                      {(post.tombstoneTaskId || post.workflowId) && (
                        <div className="flex items-center gap-3 mb-3 text-[10px] text-gray-400 font-mono">
                          {post.tombstoneTaskId && <span>Task #{post.tombstoneTaskId}</span>}
                          {post.workflowId && <span>WF {post.workflowId}</span>}
                        </div>
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

                        {/* Download Package */}
                        <button
                          onClick={() => downloadPostPackage(post)}
                          disabled={downloadingId === post.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                          {downloadingId === post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Download Package
                        </button>

                        {/* Post Now — for eligible posts */}
                        {(() => {
                          const elig = isPostEligible(post);
                          if (['manually_posted', 'published', 'published_by_ghl', 'published_unverified', 'publishing', 'scheduled_in_ghl'].includes(post.status)) return null;
                          return (
                            <button
                              onClick={() => elig.eligible ? openPostNowModal(post) : undefined}
                              disabled={!elig.eligible}
                              title={!elig.eligible ? elig.reason : 'Publish this post now'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-lg text-xs font-medium text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Post Now
                            </button>
                          );
                        })()}

                        {/* Schedule Post — for eligible posts */}
                        {(() => {
                          const elig = isPostEligible(post);
                          if (['manually_posted', 'published', 'published_by_ghl', 'published_unverified', 'publishing', 'scheduled_in_ghl'].includes(post.status)) return null;
                          return (
                            <button
                              onClick={() => elig.eligible ? openScheduleModal(post) : undefined}
                              disabled={!elig.eligible}
                              title={!elig.eligible ? elig.reason : 'Schedule this post for later'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <CalendarPlus className="w-3.5 h-3.5" />
                              Schedule Post
                            </button>
                          );
                        })()}

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

      {/* ── Publish Options Tab ───────────────────────────────────────────── */}
      {activeTab === 'accounts' && (
        <div>
          <p className="text-sm text-gray-500 mb-6">Publish options</p>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Card 1: Download & Post Manually */}
            <div className="rounded-2xl border-2 border-gray-100 bg-white p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <Download className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Download & Post Manually</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Download the finished post package and publish it directly from your own social accounts.
              </p>
              <p className="text-xs text-gray-400 mb-4">
                You can always download the post package and publish manually from your own social accounts.
              </p>
              <button
                onClick={() => setActiveTab('queue')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
              >
                <LayoutGrid className="w-4 h-4" />
                View Post Queue
              </button>
            </div>

            {/* Card 2: Publish Through Launch CRM */}
            <div className={`rounded-2xl border-2 p-6 transition-all ${
              ghlAccountsStatus?.reason === 'accounts_found' ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 bg-white'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Link2 className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Publish Through Launch CRM</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Connect an existing Launch CRM account. Launch OS will publish through Launch CRM Social Planner using the social accounts already connected there.
              </p>

              {ghlAccountsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading Launch CRM accounts…
                </div>
              ) : !ghlAccountsStatus?.connected ? (
                /* No CRM connection */
                <div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700">This business is not linked to Launch CRM.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Link2 className="w-4 h-4" />
                    Connect Launch CRM
                  </button>
                </div>
              ) : ghlAccountsStatus.reason === 'lookup_failed' ? (
                /* CRM connected but lookup failed */
                <div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-red-700">Could not load social accounts from Launch CRM. Verify the Launch CRM connection and try again.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push('/dashboard')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <Link2 className="w-4 h-4" />
                      Reconnect Launch CRM
                    </button>
                    <button
                      onClick={fetchGhlAccounts}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retry
                    </button>
                  </div>
                </div>
              ) : ghlAccounts.length === 0 ? (
                /* CRM connected but no social accounts */
                <div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700">No social accounts are connected inside Launch CRM Social Planner. Connect your social accounts in Launch CRM, then refresh here.</p>
                    </div>
                  </div>
                  <button
                    onClick={fetchGhlAccounts}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Launch CRM Accounts
                  </button>
                </div>
              ) : (
                /* CRM connected and accounts found */
                <div>
                  <p className="text-xs font-medium text-emerald-700 mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Connected through Launch CRM:
                  </p>
                  <div className="space-y-2 mb-4">
                    {ghlAccounts.map(acct => {
                      const platformLabel = acct.platform.charAt(0).toUpperCase() + acct.platform.slice(1).replace('_', ' ');
                      return (
                        <div key={acct.id} className="flex items-center gap-2.5 px-3 py-2 bg-white border border-gray-100 rounded-lg">
                          {acct.avatar ? (
                            <img src={acct.avatar} alt={acct.name} className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500">
                              {platformLabel[0]}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{acct.name}</p>
                            <p className="text-[11px] text-gray-400">{platformLabel}{acct.isDefault ? ' · Default' : ''}{acct.isExpired ? ' · Expired' : ''}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={fetchGhlAccounts}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Launch CRM Accounts
                  </button>
                </div>
              )}
            </div>

            {/* ── Publishing User Section ──────────────────────── */}
            {ghlAccountsStatus?.connected && (
              <div className="mt-6 pt-5 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
                  <UserCircle className="w-4 h-4 text-gray-500" />
                  Publishing User (Staff)
                </h4>
                <p className="text-xs text-gray-500 mb-3">
                  Post Now will automatically resolve a Launch CRM staff user for publishing. Use this section to override the auto-selected user or manually set one if automatic lookup is unavailable.
                </p>

                {ghlPublishingUserLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading publishing user…
                  </div>
                ) : ghlPublishingUser && !showPublishingUserForm ? (
                  /* Saved user display */
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                      <UserCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{ghlPublishingUser.name || 'Unnamed User'}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {ghlPublishingUser.email && <span>{ghlPublishingUser.email} · </span>}
                        ID: {ghlPublishingUser.id.slice(0, 12)}…
                      </p>
                    </div>
                    <button
                      onClick={() => setShowPublishingUserForm(true)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  /* No saved user or editing — show form */
                  <div className="space-y-3">
                    {/* Auto-discovery available: reassure user */}
                    {pubUserLookupStatus === 'success' && pubUserAvailable.length > 0 && !showPublishingUserForm && (
                      <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-800">
                          Auto-discovery is available. Post Now will automatically select a staff user from this location. You can optionally pin a specific user below.
                        </p>
                      </div>
                    )}
                    {/* If Users API returned available users, show dropdown */}
                    {pubUserLookupStatus === 'success' && pubUserAvailable.length > 0 && (
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Select a staff user:</label>
                        <div className="space-y-1.5">
                          {pubUserAvailable.map(u => (
                            <button
                              key={u.id}
                              onClick={() => {
                                setPubUserIdInput(u.id);
                                setPubUserNameInput(u.name);
                                setPubUserEmailInput(u.email);
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border transition-colors ${
                                pubUserIdInput === u.id ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <UserCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${pubUserIdInput === u.id ? 'text-blue-700' : 'text-gray-900'}`}>{u.name}</p>
                                <p className="text-[11px] text-gray-400 truncate">{u.email} · {u.role}</p>
                              </div>
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                pubUserIdInput === u.id ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                              }`}>
                                {pubUserIdInput === u.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* If Users API returned auth_failed (401), show manual entry hint */}
                    {pubUserLookupStatus === 'auth_failed' && (
                      <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-800">
                          Could not fetch staff users from Launch CRM (token lacks <code className="bg-amber-100 px-1 rounded">users.readonly</code> scope). 
                          Enter the user details manually below.
                        </p>
                      </div>
                    )}

                    {/* Manual entry fields — shown if no dropdown users, or always visible for editing */}
                    {(pubUserLookupStatus !== 'success' || pubUserAvailable.length === 0 || pubUserIdInput) && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">User ID <span className="text-red-400">*</span></label>
                          <input
                            type="text"
                            value={pubUserIdInput}
                            onChange={e => setPubUserIdInput(e.target.value)}
                            placeholder="e.g. aBC12dEfGhIjKlMnO"
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Name</label>
                            <input
                              type="text"
                              value={pubUserNameInput}
                              onChange={e => setPubUserNameInput(e.target.value)}
                              placeholder="e.g. Russell Fuller"
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
                            <input
                              type="text"
                              value={pubUserEmailInput}
                              onChange={e => setPubUserEmailInput(e.target.value)}
                              placeholder="e.g. user@example.com"
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveGhlPublishingUser(pubUserIdInput, pubUserNameInput, pubUserEmailInput)}
                        disabled={!pubUserIdInput.trim() || pubUserSaving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {pubUserSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Save Publishing User
                      </button>
                      {showPublishingUserForm && ghlPublishingUser && (
                        <button
                          onClick={() => setShowPublishingUserForm(false)}
                          className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Carousel Creator Modal */}
      {showCarouselCreator && activeBusinessId && activeBizName && (
        <CarouselCreator
          businessId={activeBusinessId}
          businessName={activeBizName}
          onClose={() => setShowCarouselCreator(false)}
          onPostCreated={() => fetchPosts()}
        />
      )}

      {/* ── Post Now Modal ────────────────────────────────────── */}
      {postNowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPostNowTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Post Now</h3>
                <p className="text-xs text-gray-500 mt-0.5">{postNowTarget.businessName || activeBizName}</p>
              </div>
              <button onClick={() => setPostNowTarget(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pb-2">
              <p className="text-sm text-gray-600">Choose where to publish this post.</p>
            </div>

            {/* Caption preview */}
            <div className="px-6 py-2">
              <div className="bg-gray-50 rounded-lg p-3 max-h-24 overflow-y-auto">
                <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-4">{postNowTarget.caption}</p>
              </div>
            </div>

            {/* Image thumbnail */}
            {postNowTarget.imageUrl && (
              <div className="px-6 py-2">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                  <ResolvedImage imageUrl={postNowTarget.imageUrl} alt="Post preview" className="w-full h-full object-cover" />
                </div>
              </div>
            )}

            {/* Channel selection — Launch CRM based */}
            <div className="px-6 py-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Publishing Channel</p>
              {!ghlAccountsStatus?.connected ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-700">Auto-publishing requires Launch CRM.</p>
                      <p className="text-xs text-amber-600 mt-0.5">Connect Launch CRM to publish through its Social Planner, or download the post package and publish manually.</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => { setPostNowTarget(null); router.push('/dashboard'); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">Connect Launch CRM →</button>
                        <button onClick={() => { setPostNowTarget(null); }} className="text-xs font-medium text-gray-500 hover:text-gray-700">Download Package Instead</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : ghlAccountsStatus.reason === 'lookup_failed' ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-red-700">Could not load social accounts from Launch CRM.</p>
                      <p className="text-xs text-red-600 mt-0.5">Verify the Launch CRM connection and try again.</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => { setPostNowTarget(null); router.push('/dashboard'); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">Reconnect Launch CRM →</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : ghlAccounts.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-700">No social accounts connected inside Launch CRM Social Planner.</p>
                      <p className="text-xs text-amber-600 mt-0.5">Connect your social accounts in Launch CRM, then refresh.</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => fetchGhlAccounts()} className="text-xs font-medium text-blue-600 hover:text-blue-800">Refresh Launch CRM Accounts →</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {ghlAccounts.map(acct => {
                    const platformLabel = acct.platform.charAt(0).toUpperCase() + acct.platform.slice(1).replace('_', ' ');
                    const selected = postNowAccountIds.includes(acct.id);
                    return (
                      <button
                        key={acct.id}
                        onClick={() => toggleChannelId(acct.id, postNowAccountIds, setPostNowAccountIds)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border transition-colors ${
                          selected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {acct.avatar ? (
                          <img src={acct.avatar} alt={acct.name} className="w-6 h-6 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0">
                            {platformLabel[0]}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${selected ? 'text-blue-700' : 'text-gray-900'}`}>{acct.name}</p>
                          <p className="text-[11px] text-gray-400">{platformLabel}{acct.isExpired ? ' · Token Expired' : ''}</p>
                        </div>
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                        }`}>
                          {selected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Landing page override */}
            {landingPageConfig?.url && (
              <div className="px-6 py-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postNowIncludeLanding}
                    onChange={e => setPostNowIncludeLanding(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-xs font-medium text-gray-700">Include default social landing page</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{landingPageConfig.ctaText} {landingPageConfig.url}</p>
                  </div>
                </label>
              </div>
            )}

            {/* Warnings */}
            {(!postNowTarget.rssItemLink && !postNowTarget.sourceArticleUrl) && (
              <div className="px-6 py-2">
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  This post has a warning: Source article link missing. You can still post it, or cancel and edit first.
                </div>
              </div>
            )}

            {postNowError && (
              <div className="px-6 py-2">
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p>{postNowError}</p>
                    {(postNowError.toLowerCase().includes('publish options') || postNowError.toLowerCase().includes('staff user') || postNowError.toLowerCase().includes('publishing user')) && (
                      <button
                        onClick={() => { setPostNowTarget(null); setActiveTab('accounts'); }}
                        className="mt-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                      >
                        Go to Publish Options →
                      </button>
                    )}
                    {postNowResult?.publishTraceId && (
                      <p className="text-[10px] text-red-400 mt-1 font-mono">Trace: {postNowResult.publishTraceId}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Per-channel results panel */}
            {postNowResult?.success && Array.isArray(postNowResult.results) && postNowResult.results.length > 0 && (
              <div className="px-6 py-2 space-y-1.5">
                {postNowResult.partial_success && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-xs font-medium text-amber-700">Partial success — some channels failed</p>
                  </div>
                )}
                {postNowResult.results.map((r: any, i: number) => (
                  <div key={r.accountId || i} className={`border rounded-lg p-3 space-y-0.5 ${r.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center gap-2">
                      {r.success
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      }
                      <p className={`text-xs font-medium ${r.success ? 'text-green-700' : 'text-red-700'}`}>
                        {r.accountName || r.platform} — {r.success ? 'Published' : 'Failed'}
                      </p>
                    </div>
                    <p className={`text-[11px] ml-6 capitalize ${r.success ? 'text-green-600' : 'text-red-500'}`}>Platform: {r.platform}</p>
                    {r.ghlPostId && <p className="text-[11px] text-green-600 ml-6 font-mono">Post ID: {r.ghlPostId}</p>}
                    {r.error && <p className="text-[11px] text-red-500 ml-6">{r.error}</p>}
                    {r.traceId && <p className="text-[10px] ml-6 font-mono opacity-60">Trace: {r.traceId}</p>}
                  </div>
                ))}
              </div>
            )}
            {/* Legacy single-result success (no results array) */}
            {postNowResult?.success && !Array.isArray(postNowResult.results) && (
              <div className="px-6 py-2">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-xs font-medium text-green-700">Published successfully</p>
                  </div>
                  {postNowResult.publishTraceId && (
                    <p className="text-[11px] text-green-600 ml-6 font-mono">Trace: {postNowResult.publishTraceId}</p>
                  )}
                </div>
              </div>
            )}

            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setPostNowTarget(null)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={executePostNow}
                disabled={postNowLoading || postNowAccountIds.length === 0 || ghlAccounts.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {postNowLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {postNowLoading ? 'Posting...' : 'Post Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Post Modal ───────────────────────────────── */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setScheduleTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Schedule Post</h3>
                <p className="text-xs text-gray-500 mt-0.5">{scheduleTarget.businessName || activeBizName}</p>
              </div>
              <button onClick={() => setScheduleTarget(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Caption preview */}
            <div className="px-6 py-2">
              <div className="bg-gray-50 rounded-lg p-3 max-h-20 overflow-y-auto">
                <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-3">{scheduleTarget.caption}</p>
              </div>
            </div>

            {/* Image thumbnail */}
            {scheduleTarget.imageUrl && (
              <div className="px-6 py-2">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
                  <ResolvedImage imageUrl={scheduleTarget.imageUrl} alt="Post preview" className="w-full h-full object-cover" />
                </div>
              </div>
            )}

            {/* Date & Time */}
            <div className="px-6 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={e => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
                <select
                  value={scheduleTimezone}
                  onChange={e => setScheduleTimezone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="America/Anchorage">Alaska (AKT)</option>
                  <option value="Pacific/Honolulu">Hawaii (HT)</option>
                </select>
              </div>
            </div>

            {/* Channel selection — Launch CRM based */}
            <div className="px-6 py-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Publishing Channel</p>
              {ghlAccounts.length > 0 ? (
                <div className="space-y-2">
                  {ghlAccounts.map(acct => {
                    const platformLabel = acct.platform.charAt(0).toUpperCase() + acct.platform.slice(1).replace('_', ' ');
                    const selected = scheduleAccountIds.includes(acct.id);
                    return (
                      <button
                        key={acct.id}
                        onClick={() => toggleChannelId(acct.id, scheduleAccountIds, setScheduleAccountIds)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border transition-colors ${
                          selected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {acct.avatar ? (
                          <img src={acct.avatar} alt={acct.name} className="w-6 h-6 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0">
                            {platformLabel[0]}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${selected ? 'text-blue-700' : 'text-gray-900'}`}>{acct.name}</p>
                          <p className="text-[11px] text-gray-400">{platformLabel}</p>
                        </div>
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                        }`}>
                          {selected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-700">
                      {!ghlAccountsStatus?.connected
                        ? 'Connect Launch CRM to schedule through Social Planner.'
                        : 'No social accounts found in Launch CRM. Connect accounts in Launch CRM first.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Landing page override */}
            {landingPageConfig?.url && (
              <div className="px-6 py-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleIncludeLanding}
                    onChange={e => setScheduleIncludeLanding(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-xs font-medium text-gray-700">Include default social landing page</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{landingPageConfig.ctaText} {landingPageConfig.url}</p>
                  </div>
                </label>
              </div>
            )}

            {scheduleError && (
              <div className="px-6 py-2">
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {scheduleError}
                </div>
              </div>
            )}

            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setScheduleTarget(null)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={executeSchedule}
                disabled={scheduleLoading || !scheduleDate || !scheduleTime || scheduleAccountIds.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {scheduleLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {scheduleLoading ? 'Scheduling...' : 'Schedule Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Social Landing Page Edit Modal (Social Posts page) ─────── */}
      {slpEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSlpEditOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Social Post Settings</h3>
                <p className="text-xs text-gray-500 mt-0.5">{activeBizName}</p>
              </div>
              <button onClick={() => setSlpEditOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default social landing page</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Globe className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    type="url"
                    value={slpEditUrl}
                    onChange={e => { setSlpEditUrl(e.target.value); setSlpEditUrlError(null); }}
                    onBlur={() => slpEditUrl.trim() && validateSlpEditUrl(slpEditUrl)}
                    placeholder="https://example.com/offer"
                    className={`w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${
                      slpEditUrlError ? 'border-red-300 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                </div>
                {slpEditUrlError ? (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />{slpEditUrlError}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">This link will be added to scheduled social posts as the default destination for traffic from Facebook, Google Business Profile, LinkedIn, and other connected channels.</p>
                )}
              </div>

              {/* Toggle */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                <p className="text-sm font-medium text-gray-700">Add this link to social posts by default</p>
                <button type="button" onClick={() => setSlpEditEnabled(!slpEditEnabled)} className="flex-shrink-0 ml-3">
                  {slpEditEnabled ? (
                    <div className="w-9 h-5 bg-indigo-600 rounded-full relative transition-colors">
                      <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
                    </div>
                  ) : (
                    <div className="w-9 h-5 bg-gray-300 rounded-full relative transition-colors">
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
                    </div>
                  )}
                </button>
              </div>

              {/* CTA Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default CTA text <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={slpEditCtaText}
                  onChange={e => setSlpEditCtaText(e.target.value)}
                  placeholder="Learn more here:"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>

              {/* Apply To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Apply this to</label>
                <div className="space-y-1.5">
                  {[
                    { value: 'future' as const, label: 'Future posts only', desc: 'New posts will use this setting' },
                    { value: 'drafts' as const, label: 'Existing drafts', desc: 'Update pending and approved drafts too' },
                    { value: 'scheduled' as const, label: 'Existing scheduled posts', desc: 'Update already-scheduled posts too' },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input
                        type="radio"
                        name="slp-edit-apply-to"
                        checked={slpEditApplyTo === opt.value}
                        onChange={() => setSlpEditApplyTo(opt.value)}
                        className="mt-0.5 w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-700">{opt.label}</p>
                        <p className="text-xs text-gray-400">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {slpEditUrl.trim() && slpEditEnabled && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-700 mb-1">Preview — post ending</p>
                  <div className="bg-white rounded px-3 py-2 text-xs text-gray-700 font-mono whitespace-pre-wrap">{slpEditCtaText || 'Learn more here:'}{'\n'}{slpEditUrl.trim()}</div>
                </div>
              )}

              {slpEditError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{slpEditError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setSlpEditOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={handleSlpEditSave}
                disabled={slpEditSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {slpEditSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {slpEditSaving ? 'Saving…' : 'Save Social Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Action Toast ──────────────────────────────────────── */}
      {actionToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 animate-fade-in-up">
          <CheckCircle2 className="w-4 h-4" />
          {actionToast}
        </div>
      )}
    </div>
  );
}