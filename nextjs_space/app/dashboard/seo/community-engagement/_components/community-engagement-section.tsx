'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import {
  Users, Shield, Eye, Globe, AlertTriangle, Plus, X, Trash2,
  ExternalLink, CheckCircle, XCircle, MessageSquare, FileText,
  ChevronDown, ChevronUp, RefreshCw, Search, Filter,
  ThumbsUp, ThumbsDown, PenLine, Archive, Lightbulb,
  Video, BookOpen, Link2, Clock, BarChart3, Target,
  ArrowUpRight, Info, Sliders, Bell
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

// ── Types ────────────────────────────────────────────────────────────────────
interface Settings {
  enabled: boolean;
  minOpportunityScore: number;
  minContentMatchScore: number;
  minRuleCompatibility: number;
  requireVideo: boolean;
  requireExplainerStory: boolean;
  humanApprovalRequired: boolean;
  disclosureReminder: boolean;
  maxOppsPerDay: number;
  maxOppsPerCommunityWeek: number;
  urlCooldownDays: number;
  expertiseTopics: string[];
  contentSourceUrls: string[];
}

interface CommunitySource {
  id: string;
  platform: string;
  communityName: string;
  communityUrl?: string;
  enabled: boolean;
  excluded: boolean;
  notes?: string;
  lastCheckedAt?: string;
}

interface ContentMatch {
  id: string;
  contentUrl: string;
  contentTitle?: string;
  contentType?: string;
  matchReason?: string;
  hasVideo: boolean;
  hasExplainerStory: boolean;
  score: number;
}

interface Opportunity {
  id: string;
  platform: string;
  communityName: string;
  threadTitle: string;
  threadUrl: string;
  threadTextSnippet?: string;
  topic?: string;
  relevanceScore: number;
  intentScore: number;
  contentMatchScore: number;
  ruleCompatibility: number;
  spamRiskScore: number;
  opportunityScore: number;
  spamRisk: string;
  matchedContentUrl?: string;
  matchedContentTitle?: string;
  matchedContentType?: string;
  hasVideo: boolean;
  hasExplainerStory: boolean;
  linkRecommendation: boolean;
  status: string;
  draftText?: string;
  recommendedUrl?: string;
  disclosureText?: string;
  linkJustification?: string;
  riskNotes?: string;
  draftStatus?: string;
  reviewDecision?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  manuallyPostedUrl?: string;
  postedAt?: string;
  referralClicks: number;
  conversions: number;
  outcomeNotes?: string;
  communityRules?: string;
  selfPromoProhibited: boolean;
  createdAt: string;
  contentMatches: ContentMatch[];
  reviewer?: { email: string };
}

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  minOpportunityScore: 75,
  minContentMatchScore: 20,
  minRuleCompatibility: 10,
  requireVideo: false,
  requireExplainerStory: false,
  humanApprovalRequired: true,
  disclosureReminder: true,
  maxOppsPerDay: 3,
  maxOppsPerCommunityWeek: 1,
  urlCooldownDays: 14,
  expertiseTopics: [],
  contentSourceUrls: [],
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: 'New', color: 'text-blue-700', bg: 'bg-blue-50' },
  draft_ready: { label: 'Draft Ready', color: 'text-amber-700', bg: 'bg-amber-50' },
  under_review: { label: 'Under Review', color: 'text-purple-700', bg: 'bg-purple-50' },
  approved: { label: 'Approved', color: 'text-green-700', bg: 'bg-green-50' },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50' },
  archived: { label: 'Archived', color: 'text-gray-700', bg: 'bg-gray-100' },
  content_needed: { label: 'Content Needed', color: 'text-orange-700', bg: 'bg-orange-50' },
};

const RISK_CONFIG: Record<string, { color: string; bg: string }> = {
  Low: { color: 'text-green-700', bg: 'bg-green-50' },
  Medium: { color: 'text-amber-700', bg: 'bg-amber-50' },
  High: { color: 'text-red-700', bg: 'bg-red-50' },
};

// ── Toggle Switch ────────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange, disabled, label, sublabel }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  sublabel?: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        {sublabel && <div className="text-xs text-gray-400">{sublabel}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          checked ? 'bg-blue-600' : 'bg-gray-200'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

// ── Score Bar ────────────────────────────────────────────────────────────────
function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-gray-500 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-medium text-gray-700">{value}/{max}</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CommunityEngagementSection() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx.activeBusiness?.id;

  // Settings state
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [targetCommunities, setTargetCommunities] = useState<CommunitySource[]>([]);
  const [excludedCommunities, setExcludedCommunities] = useState<CommunitySource[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Opportunities state
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [totalOpps, setTotalOpps] = useState(0);
  const [loadingOpps, setLoadingOpps] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [reviewingOpp, setReviewingOpp] = useState<string | null>(null);

  // Community add form
  const [showAddCommunity, setShowAddCommunity] = useState(false);
  const [newCommunity, setNewCommunity] = useState({ platform: 'reddit', communityName: '', communityUrl: '', excluded: false });

  // Topic/URL input
  const [newTopic, setNewTopic] = useState('');
  const [newContentUrl, setNewContentUrl] = useState('');

  // Section expansion
  const [showSettings, setShowSettings] = useState(true);
  const [showOpps, setShowOpps] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  // Load settings
  const fetchSettings = useCallback(async () => {
    if (!businessId) return;
    setLoadingSettings(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/community-engagement/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || DEFAULT_SETTINGS);
        setTargetCommunities(data.targetCommunities || []);
        setExcludedCommunities(data.excludedCommunities || []);
      }
    } catch (e) { console.error('Failed to load CE settings:', e); }
    setLoadingSettings(false);
  }, [businessId]);

  // Load opportunities
  const fetchOpps = useCallback(async () => {
    if (!businessId) return;
    setLoadingOpps(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/businesses/${businessId}/community-engagement/opportunities?${params}`);
      if (res.ok) {
        const data = await res.json();
        setOpportunities(data.opportunities || []);
        setTotalOpps(data.total || 0);
      }
    } catch (e) { console.error('Failed to load CE opportunities:', e); }
    setLoadingOpps(false);
  }, [businessId, statusFilter]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchOpps(); }, [fetchOpps]);

  // Save settings
  const saveSettings = async (updates: Partial<Settings & { addCommunity?: any; removeCommunityId?: string; toggleCommunityId?: string }>) => {
    if (!businessId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/community-engagement/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || DEFAULT_SETTINGS);
        setTargetCommunities(data.targetCommunities || []);
        setExcludedCommunities(data.excludedCommunities || []);
      }
    } catch (e) { console.error('Failed to save CE settings:', e); }
    setSaving(false);
  };

  // Review opportunity
  const handleReview = async (oppId: string, decision: string, notes?: string) => {
    if (!businessId) return;
    setReviewingOpp(oppId);
    try {
      const res = await fetch(`/api/businesses/${businessId}/community-engagement/opportunities/${oppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review', decision, notes }),
      });
      if (res.ok) {
        await fetchOpps();
      }
    } catch (e) { console.error('Failed to review opportunity:', e); }
    setReviewingOpp(null);
  };

  // Create content task
  const handleCreateContentTask = async (oppId: string) => {
    if (!businessId) return;
    setReviewingOpp(oppId);
    try {
      const res = await fetch(`/api/businesses/${businessId}/community-engagement/opportunities/${oppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_content_task' }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchOpps();
        // TODO: could show content task details in a modal
      }
    } catch (e) { console.error('Failed to create content task:', e); }
    setReviewingOpp(null);
  };

  // Add community
  const handleAddCommunity = async () => {
    if (!newCommunity.communityName.trim()) return;
    await saveSettings({
      addCommunity: {
        platform: newCommunity.platform,
        communityName: newCommunity.communityName.trim(),
        communityUrl: newCommunity.communityUrl.trim() || null,
        excluded: newCommunity.excluded,
      },
    });
    setNewCommunity({ platform: 'reddit', communityName: '', communityUrl: '', excluded: false });
    setShowAddCommunity(false);
  };

  // Add topic
  const handleAddTopic = async () => {
    if (!newTopic.trim()) return;
    const updated = [...(settings.expertiseTopics || []), newTopic.trim()];
    await saveSettings({ expertiseTopics: updated });
    setNewTopic('');
  };

  // Remove topic
  const handleRemoveTopic = async (topic: string) => {
    const updated = (settings.expertiseTopics || []).filter(t => t !== topic);
    await saveSettings({ expertiseTopics: updated });
  };

  // Add content URL
  const handleAddContentUrl = async () => {
    if (!newContentUrl.trim()) return;
    const updated = [...(settings.contentSourceUrls || []), newContentUrl.trim()];
    await saveSettings({ contentSourceUrls: updated });
    setNewContentUrl('');
  };

  // Remove content URL
  const handleRemoveContentUrl = async (url: string) => {
    const updated = (settings.contentSourceUrls || []).filter(u => u !== url);
    await saveSettings({ contentSourceUrls: updated });
  };

  if (status === 'loading') {
    return <div className="max-w-6xl mx-auto px-4 py-12 text-center text-gray-400">Loading…</div>;
  }

  if (!businessId) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Select a business to manage Community Engagement settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <a href="/dashboard/seo" className="text-sm text-gray-400 hover:text-blue-600 transition-colors">SEO</a>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-600 font-medium">Community Engagement</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          Community Engagement
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Reddit & Specialty Forums — Find relevant conversations where your website content genuinely answers questions.
          {bizCtx.activeBusiness && (
            <span className="ml-1 text-blue-600 font-medium">— {bizCtx.activeBusiness.businessName || bizCtx.activeBusiness.businessDomain}</span>
          )}
        </p>
      </div>

      {/* Compliance Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Shield className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <span className="font-semibold">Human-First Engagement</span> — This tool finds conversations where your content can help. It never auto-posts, creates accounts, or hides affiliations. All drafts require your approval before any action.
        </div>
      </div>

      {/* ── Settings Card ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-hidden">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Sliders className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-gray-900">Monitoring Settings</h2>
              <p className="text-xs text-gray-400">Configure communities, topics, and engagement rules</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${settings.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {settings.enabled ? 'Active' : 'Inactive'}
            </span>
            {showSettings ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </div>
        </button>

        {showSettings && (
          <div className="px-6 pb-6 border-t border-gray-100">
            {loadingSettings ? (
              <div className="py-8 text-center text-gray-400">Loading settings…</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4">
                {/* Left Column */}
                <div className="space-y-6">
                  {/* Enable/Disable */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <ToggleSwitch
                      checked={settings.enabled}
                      onChange={(v) => saveSettings({ enabled: v })}
                      label="Enable Community Monitoring"
                      sublabel="Monitor Reddit and forums for relevant conversations"
                    />
                  </div>

                  {/* Target Communities */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-blue-500" /> Target Communities
                    </h3>
                    <div className="space-y-1.5">
                      {targetCommunities.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No target communities added yet.</p>
                      )}
                      {targetCommunities.map(c => (
                        <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{c.platform}</span>
                            <span className="text-gray-800 truncate">{c.communityName}</span>
                            {c.communityUrl && (
                              <a href={c.communityUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => saveSettings({ toggleCommunityId: c.id })}
                              className={`text-xs px-2 py-0.5 rounded ${c.enabled ? 'text-green-600 bg-green-50' : 'text-gray-400 bg-gray-100'}`}
                            >
                              {c.enabled ? 'On' : 'Off'}
                            </button>
                            <button
                              onClick={() => saveSettings({ removeCommunityId: c.id })}
                              className="text-gray-400 hover:text-red-500 p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Excluded Communities */}
                    {excludedCommunities.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Excluded Communities</h4>
                        {excludedCommunities.map(c => (
                          <div key={c.id} className="flex items-center justify-between bg-red-50/50 rounded-lg px-3 py-1.5 text-sm mb-1">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-gray-600">{c.communityName}</span>
                            </div>
                            <button
                              onClick={() => saveSettings({ removeCommunityId: c.id })}
                              className="text-gray-400 hover:text-red-500 p-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add Community */}
                    {showAddCommunity ? (
                      <div className="mt-2 bg-blue-50/50 border border-blue-200 rounded-lg p-3 space-y-2">
                        <div className="flex gap-2">
                          <select
                            value={newCommunity.platform}
                            onChange={e => setNewCommunity(p => ({ ...p, platform: e.target.value }))}
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                          >
                            <option value="reddit">Reddit</option>
                            <option value="forum">Forum</option>
                            <option value="specialty">Specialty</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Community name (e.g. r/MechanicAdvice)"
                            value={newCommunity.communityName}
                            onChange={e => setNewCommunity(p => ({ ...p, communityName: e.target.value }))}
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="URL (optional)"
                          value={newCommunity.communityUrl}
                          onChange={e => setNewCommunity(p => ({ ...p, communityUrl: e.target.value }))}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                        />
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newCommunity.excluded}
                              onChange={e => setNewCommunity(p => ({ ...p, excluded: e.target.checked }))}
                              className="rounded border-gray-300"
                            />
                            Add as excluded
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleAddCommunity} disabled={saving} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            Add Community
                          </button>
                          <button onClick={() => setShowAddCommunity(false)} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddCommunity(true)}
                        className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Community
                      </button>
                    )}
                  </div>

                  {/* Expertise Topics */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-blue-500" /> Business Expertise Topics
                    </h3>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(settings.expertiseTopics || []).map(t => (
                        <span key={t} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
                          {t}
                          <button onClick={() => handleRemoveTopic(t)} className="hover:text-red-500">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add topic (e.g. brake repair, oil change)"
                        value={newTopic}
                        onChange={e => setNewTopic(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddTopic()}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                      />
                      <button onClick={handleAddTopic} disabled={!newTopic.trim() || saving} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Website Content Sources */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <Link2 className="w-4 h-4 text-blue-500" /> Website Content Sources
                    </h3>
                    <div className="space-y-1">
                      {(settings.contentSourceUrls || []).map(u => (
                        <div key={u} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5 text-sm">
                          <a href={u} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate text-xs">{u}</a>
                          <button onClick={() => handleRemoveContentUrl(u)} className="text-gray-400 hover:text-red-500 p-1">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input
                        type="text"
                        placeholder="Add content URL (e.g. https://example.com/blog)"
                        value={newContentUrl}
                        onChange={e => setNewContentUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddContentUrl()}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                      />
                      <button onClick={handleAddContentUrl} disabled={!newContentUrl.trim() || saving} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column — Toggles & Thresholds */}
                <div className="space-y-6">
                  {/* Content Requirements */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-blue-500" /> Content Requirements
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                      <ToggleSwitch
                        checked={settings.requireVideo}
                        onChange={(v) => saveSettings({ requireVideo: v })}
                        label="Require video content"
                        sublabel="Only recommend when client has a relevant video"
                      />
                      <ToggleSwitch
                        checked={settings.requireExplainerStory}
                        onChange={(v) => saveSettings({ requireExplainerStory: v })}
                        label="Require explainer story"
                        sublabel="Only recommend when an explainer article exists"
                      />
                      <ToggleSwitch
                        checked={settings.humanApprovalRequired}
                        onChange={() => {}}
                        disabled={true}
                        label="Human approval required"
                        sublabel="Locked ON — all drafts require human review"
                      />
                      <ToggleSwitch
                        checked={settings.disclosureReminder}
                        onChange={(v) => saveSettings({ disclosureReminder: v })}
                        label="Disclosure reminder"
                        sublabel="Remind to disclose business affiliation"
                      />
                    </div>
                  </div>

                  {/* Scoring Thresholds */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-blue-500" /> Scoring Thresholds
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Min Opportunity Score</span>
                          <span className="font-medium">{settings.minOpportunityScore}/100</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={100} step={5}
                          value={settings.minOpportunityScore}
                          onChange={e => setSettings(s => ({ ...s, minOpportunityScore: parseInt(e.target.value) }))}
                          onMouseUp={() => saveSettings({ minOpportunityScore: settings.minOpportunityScore })}
                          onTouchEnd={() => saveSettings({ minOpportunityScore: settings.minOpportunityScore })}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Min Content Match Score</span>
                          <span className="font-medium">{settings.minContentMatchScore}/25</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={25} step={1}
                          value={settings.minContentMatchScore}
                          onChange={e => setSettings(s => ({ ...s, minContentMatchScore: parseInt(e.target.value) }))}
                          onMouseUp={() => saveSettings({ minContentMatchScore: settings.minContentMatchScore })}
                          onTouchEnd={() => saveSettings({ minContentMatchScore: settings.minContentMatchScore })}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Min Rule Compatibility</span>
                          <span className="font-medium">{settings.minRuleCompatibility}/15</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={15} step={1}
                          value={settings.minRuleCompatibility}
                          onChange={e => setSettings(s => ({ ...s, minRuleCompatibility: parseInt(e.target.value) }))}
                          onMouseUp={() => saveSettings({ minRuleCompatibility: settings.minRuleCompatibility })}
                          onTouchEnd={() => saveSettings({ minRuleCompatibility: settings.minRuleCompatibility })}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Frequency Controls */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-500" /> Frequency Controls
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Max opps/day</span>
                        <select
                          value={settings.maxOppsPerDay}
                          onChange={e => saveSettings({ maxOppsPerDay: parseInt(e.target.value) })}
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                        >
                          {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Max per community/week</span>
                        <select
                          value={settings.maxOppsPerCommunityWeek}
                          onChange={e => saveSettings({ maxOppsPerCommunityWeek: parseInt(e.target.value) })}
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                        >
                          {[1, 2, 3, 5].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">URL cooldown (days)</span>
                        <select
                          value={settings.urlCooldownDays}
                          onChange={e => saveSettings({ urlCooldownDays: parseInt(e.target.value) })}
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                        >
                          {[7, 14, 21, 30, 60, 90].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Scoring Breakdown Reference */}
                  <div className="bg-gradient-to-br from-gray-50 to-blue-50/50 rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Opportunity Score Breakdown
                    </h4>
                    <div className="space-y-1.5">
                      <ScoreBar label="Thread Relevance" value={25} max={25} color="bg-blue-500" />
                      <ScoreBar label="Expert Intent" value={20} max={20} color="bg-purple-500" />
                      <ScoreBar label="Content Match" value={25} max={25} color="bg-green-500" />
                      <ScoreBar label="Rule Compatibility" value={15} max={15} color="bg-amber-500" />
                      <ScoreBar label="Low Spam Risk" value={15} max={15} color="bg-emerald-500" />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2">Total: 100 points. Default minimum: 75.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Opportunity Log ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowOpps(!showOpps)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-gray-900">Opportunity Log</h2>
              <p className="text-xs text-gray-400">{totalOpps} opportunities found</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); fetchOpps(); }}
              className="text-gray-400 hover:text-blue-600 p-1"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loadingOpps ? 'animate-spin' : ''}`} />
            </button>
            {showOpps ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </div>
        </button>

        {showOpps && (
          <div className="border-t border-gray-100">
            {/* Filters */}
            <div className="px-6 py-3 bg-gray-50/50 border-b border-gray-100 flex flex-wrap items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">All Statuses</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400 ml-auto">{totalOpps} total</span>
            </div>

            {/* Opportunities */}
            {loadingOpps ? (
              <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading opportunities…</div>
            ) : opportunities.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No opportunities found yet.</p>
                <p className="text-gray-400 text-xs mt-1">
                  {settings.enabled
                    ? 'The monitoring agent will surface relevant threads here as they are discovered.'
                    : 'Enable monitoring in the settings above to start finding opportunities.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {opportunities.map(opp => {
                  const isExpanded = expandedOpp === opp.id;
                  const statusInfo = STATUS_CONFIG[opp.status] || STATUS_CONFIG.new;
                  const riskInfo = RISK_CONFIG[opp.spamRisk] || RISK_CONFIG.Low;

                  return (
                    <div key={opp.id} className="hover:bg-gray-50/50 transition-colors">
                      {/* Row Header */}
                      <button
                        onClick={() => setExpandedOpp(isExpanded ? null : opp.id)}
                        className="w-full px-6 py-3 flex items-center gap-3 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{opp.platform}</span>
                            <span className="text-xs text-gray-400">{opp.communityName}</span>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusInfo.bg} ${statusInfo.color}`}>
                              {statusInfo.label}
                            </span>
                            {opp.selfPromoProhibited && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 flex items-center gap-0.5">
                                <AlertTriangle className="w-2.5 h-2.5" /> Self-promo prohibited
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-medium text-gray-800 mt-1 truncate">{opp.threadTitle}</h4>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                            <span>Score: <span className="font-semibold text-gray-700">{opp.opportunityScore}</span>/100</span>
                            <span className={`${riskInfo.color}`}>Risk: {opp.spamRisk}</span>
                            {opp.hasVideo && <span className="text-green-600 flex items-center gap-0.5"><Video className="w-3 h-3" /> Video</span>}
                            {opp.hasExplainerStory && <span className="text-purple-600 flex items-center gap-0.5"><BookOpen className="w-3 h-3" /> Explainer</span>}
                            {opp.linkRecommendation && <span className="text-blue-600 flex items-center gap-0.5"><Link2 className="w-3 h-3" /> Link rec</span>}
                            <span>{new Date(opp.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                            opp.opportunityScore >= 75 ? 'bg-green-100 text-green-700' :
                            opp.opportunityScore >= 50 ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {opp.opportunityScore}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </button>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-6 pb-4 space-y-4">
                          {/* Thread snippet */}
                          {opp.threadTextSnippet && (
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-500 font-medium mb-1">Thread Snippet</p>
                              <p className="text-sm text-gray-700">{opp.threadTextSnippet}</p>
                            </div>
                          )}

                          {/* Score breakdown */}
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 font-medium mb-2">Score Breakdown</p>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                              <ScoreBar label="Relevance" value={opp.relevanceScore} max={25} color="bg-blue-500" />
                              <ScoreBar label="Intent" value={opp.intentScore} max={20} color="bg-purple-500" />
                              <ScoreBar label="Content" value={opp.contentMatchScore} max={25} color="bg-green-500" />
                              <ScoreBar label="Rules" value={opp.ruleCompatibility} max={15} color="bg-amber-500" />
                              <ScoreBar label="Low Spam" value={opp.spamRiskScore} max={15} color="bg-emerald-500" />
                            </div>
                          </div>

                          {/* Content matches */}
                          {opp.contentMatches?.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-500 font-medium mb-1">Content Matches</p>
                              <div className="space-y-1">
                                {opp.contentMatches.map(m => (
                                  <div key={m.id} className="flex items-center gap-2 bg-green-50/50 rounded-lg px-3 py-1.5 text-xs">
                                    <CheckCircle className="w-3 h-3 text-green-500" />
                                    <span className="text-gray-700 font-medium">{m.contentTitle || m.contentUrl}</span>
                                    <span className="text-gray-400">({m.contentType})</span>
                                    {m.hasVideo && <Video className="w-3 h-3 text-green-600" />}
                                    {m.hasExplainerStory && <BookOpen className="w-3 h-3 text-purple-600" />}
                                    <span className="text-gray-400 ml-auto">Score: {m.score}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Matched content summary */}
                          {opp.matchedContentUrl && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                              <div>
                                <p className="text-xs font-medium text-green-800">Recommended content: {opp.matchedContentTitle || 'Matched page'}</p>
                                <a href={opp.matchedContentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-green-600 hover:underline">
                                  {opp.matchedContentUrl}
                                </a>
                              </div>
                            </div>
                          )}

                          {/* Draft */}
                          {opp.draftText && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-blue-800 mb-1 flex items-center gap-1">
                                <PenLine className="w-3 h-3" /> Draft Response
                                {opp.draftStatus && (
                                  <span className="ml-2 text-[10px] bg-blue-100 px-1.5 py-0.5 rounded">{opp.draftStatus}</span>
                                )}
                              </p>
                              <p className="text-sm text-gray-700 whitespace-pre-line">{opp.draftText}</p>
                              {opp.disclosureText && (
                                <p className="text-xs text-blue-600 mt-2 italic">Disclosure: {opp.disclosureText}</p>
                              )}
                              {opp.linkJustification && (
                                <p className="text-xs text-gray-500 mt-1">Link justification: {opp.linkJustification}</p>
                              )}
                            </div>
                          )}

                          {/* Risk notes */}
                          {opp.riskNotes && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                              <div>
                                <p className="text-xs font-medium text-amber-800">Risk Notes</p>
                                <p className="text-xs text-amber-700">{opp.riskNotes}</p>
                              </div>
                            </div>
                          )}

                          {/* Community rules */}
                          {opp.communityRules && (
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                                <Shield className="w-3 h-3" /> Community Rules Snapshot
                              </p>
                              <p className="text-xs text-gray-500 whitespace-pre-line">{opp.communityRules}</p>
                            </div>
                          )}

                          {/* Review info */}
                          {opp.reviewedAt && (
                            <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                              <Eye className="w-4 h-4 text-gray-500 mt-0.5" />
                              <div>
                                <p className="text-xs text-gray-600">
                                  Reviewed by <span className="font-medium">{opp.reviewer?.email || 'Unknown'}</span>{' '}
                                  on {new Date(opp.reviewedAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}
                                </p>
                                <p className="text-xs text-gray-500">Decision: <span className="font-medium capitalize">{opp.reviewDecision}</span></p>
                                {opp.reviewNotes && <p className="text-xs text-gray-400 mt-0.5">{opp.reviewNotes}</p>}
                              </div>
                            </div>
                          )}

                          {/* Outcome */}
                          {opp.manuallyPostedUrl && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-green-800 mb-1">Posted</p>
                              <a href={opp.manuallyPostedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-green-600 hover:underline flex items-center gap-1">
                                {opp.manuallyPostedUrl} <ExternalLink className="w-3 h-3" />
                              </a>
                              <div className="flex gap-4 mt-1 text-xs text-gray-500">
                                {opp.referralClicks > 0 && <span>Clicks: {opp.referralClicks}</span>}
                                {opp.conversions > 0 && <span>Conversions: {opp.conversions}</span>}
                              </div>
                            </div>
                          )}

                          {/* Thread link */}
                          <div className="flex items-center gap-2">
                            <a
                              href={opp.threadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> View Thread
                            </a>
                          </div>

                          {/* Review Actions */}
                          {!opp.reviewedAt && opp.status !== 'archived' && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                              <button
                                onClick={() => handleReview(opp.id, 'approved')}
                                disabled={reviewingOpp === opp.id}
                                className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                              >
                                <ThumbsUp className="w-3 h-3" /> Approve Draft
                              </button>
                              <button
                                onClick={() => handleReview(opp.id, 'rewrite')}
                                disabled={reviewingOpp === opp.id}
                                className="flex items-center gap-1 text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 disabled:opacity-50"
                              >
                                <RefreshCw className="w-3 h-3" /> Request Rewrite
                              </button>
                              <button
                                onClick={() => handleReview(opp.id, 'not_relevant')}
                                disabled={reviewingOpp === opp.id}
                                className="flex items-center gap-1 text-xs bg-gray-500 text-white px-3 py-1.5 rounded-lg hover:bg-gray-600 disabled:opacity-50"
                              >
                                <ThumbsDown className="w-3 h-3" /> Not Relevant
                              </button>
                              <button
                                onClick={() => handleCreateContentTask(opp.id)}
                                disabled={reviewingOpp === opp.id}
                                className="flex items-center gap-1 text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                              >
                                <Lightbulb className="w-3 h-3" /> Create Content Instead
                              </button>
                              <button
                                onClick={() => handleReview(opp.id, 'archived')}
                                disabled={reviewingOpp === opp.id}
                                className="flex items-center gap-1 text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                              >
                                <Archive className="w-3 h-3" /> Archive
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
