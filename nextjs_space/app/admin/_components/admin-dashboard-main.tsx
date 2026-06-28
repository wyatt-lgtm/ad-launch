'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Users, Activity, Key, Cpu, Search, Loader2,
  CheckCircle2, XCircle, Clock, AlertTriangle, Rss, RefreshCw,
  ChevronRight, ChevronDown, ChevronUp, Shield, Zap, FileText, Image as ImageIcon,
  MessageSquare, ArrowRight, ArrowLeft, Calendar, Eye, X, Copy, ExternalLink,
  Building2, Globe,
} from 'lucide-react';
import NextImage from 'next/image';
import DefensibilityTab from './defensibility-tab';
import OpenAIUsageTab from './openai-usage-tab';
import IndustriesTab from './industries-tab';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type Tab = 'accounts' | 'businesses' | 'usage' | 'resets' | 'agents' | 'tasks' | 'ads' | 'audit' | 'credits' | 'defensibility' | 'openai' | 'industries';

interface Overview {
  users: { total: number; confirmed: number; unconfirmed: number; recentSignups: number };
  businesses: number;
  analyses: { total: number; byStatus: Record<string, number> };
  ads: number;
  socialPosts: { total: number; byStatus: Record<string, number> };
  passwordResets: number;
}

interface Account {
  id: string; email: string; confirmed: boolean; role: string;
  freeAdsUsed: number; paidAdsCount: number;
  createdAt: string; updatedAt: string;
  businessCount: number; analysisCount: number;
  adCount: number; socialPostCount: number;
}

interface UsageData {
  analyses: { total: number; byStatus: Record<string, number> };
  ads: { total: number; byLane: Record<string, number> };
  socialPosts: { total: number; byStatus: Record<string, number> };
  perBusiness: { id: string; businessName: string; websiteUrl: string; analysisCount: number; adCount: number; socialPostCount: number }[];
}

interface ResetItem {
  id: string; userEmail: string; requestedAt: string;
  expiresAt: string; used: boolean; expired: boolean; status: string;
}

interface Agent {
  name: string; display_name: string; status: string;
  last_seen: string | null; current_task_id: number | null;
  department: string | null; running: boolean;
  seconds_since_heartbeat?: number; service_name?: string; instance_id?: string;
}

interface Task {
  id: number; workflow_id: string; mission: string | null;
  department: string; status: string; claimed_by: string | null;
  heartbeat_at: string | null; created_at: string; updated_at: string | null;
  last_error: string | null; retry_count: number; max_retries: number;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function AdminDashboardMain() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('accounts');

  // Overview data
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/admin/overview').then(r => r.json()).then(setOverview).finally(() => setOverviewLoading(false));
  }, [status]);

  if (status === 'loading' || overviewLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'businesses', label: 'Businesses', icon: Building2 },
    { id: 'ads',      label: 'Ads',      icon: ImageIcon },
    { id: 'usage',    label: 'Usage',    icon: BarChart3 },
    { id: 'resets',   label: 'Resets',   icon: Key },
    { id: 'agents',   label: 'Agents',   icon: Cpu },
    { id: 'tasks',    label: 'Tasks',    icon: Activity },
    { id: 'audit',    label: 'Agent Audit', icon: Eye },
    { id: 'credits',  label: 'Credits',      icon: Shield },
    { id: 'defensibility', label: 'Defensibility', icon: Zap },
    { id: 'openai',         label: 'OpenAI Usage',   icon: BarChart3 },
    { id: 'industries',     label: 'Industries',     icon: Building2 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/admin/rss')}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <Rss className="w-3.5 h-3.5" /> RSS Intel
                <ChevronRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                Dashboard <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex gap-1 -mb-px">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      {overview && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Users" value={overview.users.total} sub={`${overview.users.confirmed} confirmed`} icon={Users} onClick={() => setTab('accounts')} />
            <StatCard label="Businesses" value={overview.businesses} icon={Building2} onClick={() => setTab('businesses')} />
            <StatCard label="Analyses" value={overview.analyses.total} icon={FileText} onClick={() => setTab('usage')} />
            <StatCard label="Ads" value={overview.ads} icon={ImageIcon} onClick={() => setTab('ads')} />
            <StatCard label="Social Posts" value={overview.socialPosts.total} icon={MessageSquare} onClick={() => setTab('usage')} />
            <StatCard label="PW Resets" value={overview.passwordResets} icon={Key} onClick={() => setTab('resets')} />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'businesses' && <BusinessesTab />}
        {tab === 'ads' && <AdsTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'resets' && <ResetsTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'credits' && <CreditsTab />}
        {tab === 'defensibility' && <DefensibilityTab />}
        {tab === 'openai' && <OpenAIUsageTab />}
        {tab === 'industries' && <IndustriesTab />}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, onClick }: { label: string; value: number; sub?: string; icon: any; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm transition-all ${onClick ? 'cursor-pointer hover:border-blue-400 hover:shadow-md active:scale-[0.98]' : ''}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Ads (drill-down: days → accounts → preview)
// ═══════════════════════════════════════════════════════════════

interface DayRow { date: string; count: number; lanes: Record<string, number> }
interface AdItem {
  id: string; imageUrl: string | null; headline: string | null;
  caption: string | null; lane: string | null; websiteUrl: string | null;
  businessName: string | null; createdAt: string;
}
interface AccountAds {
  userId: string; email: string; adCount: number; ads: AdItem[];
}

const LANE_COLORS: Record<string, string> = {
  website: 'bg-blue-100 text-blue-700',
  news: 'bg-amber-100 text-amber-700',
  holiday: 'bg-rose-100 text-rose-700',
  unknown: 'bg-gray-100 text-gray-600',
};

function AdsTab() {
  const [view, setView] = useState<'daily' | 'day-detail' | 'preview'>('daily');
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountAds[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountAds | null>(null);
  const [previewAd, setPreviewAd] = useState<AdItem | null>(null);
  const [totalAds, setTotalAds] = useState(0);

  // Load daily view
  useEffect(() => {
    fetch('/api/admin/ads?mode=daily')
      .then(r => r.json())
      .then(data => { setDays(data.days || []); setTotalAds(data.total || 0); })
      .finally(() => setLoading(false));
  }, []);

  // Load day detail
  const openDay = useCallback(async (day: string) => {
    setSelectedDay(day);
    setDayLoading(true);
    setView('day-detail');
    try {
      const res = await fetch(`/api/admin/ads?mode=day-detail&day=${day}`);
      const data = await res.json();
      setAccounts(data.accounts || []);
    } finally {
      setDayLoading(false);
    }
  }, []);

  const openAccountPreview = (account: AccountAds) => {
    setSelectedAccount(account);
    setView('preview');
  };

  const formatDate = (d: string) => {
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  // find max count for the bar chart
  const maxCount = days.length > 0 ? Math.max(...days.map(d => d.count)) : 1;

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Breadcrumb header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        {view !== 'daily' && (
          <button
            onClick={() => {
              if (view === 'preview') { setView('day-detail'); setSelectedAccount(null); }
              else { setView('daily'); setSelectedDay(null); setAccounts([]); }
            }}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium mr-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        <ImageIcon className="w-5 h-5 text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">
          {view === 'daily' && `Ads by Day (${totalAds} total, last 90 days)`}
          {view === 'day-detail' && selectedDay && `${formatDate(selectedDay)} — ${accounts.reduce((s, a) => s + a.adCount, 0)} ads`}
          {view === 'preview' && selectedAccount && `${selectedAccount.email} — ${selectedAccount.adCount} ads on ${formatDate(selectedDay!)}`}
        </span>
      </div>

      {/* ── Daily view: bar chart of ads by day ── */}
      {view === 'daily' && (
        <div className="divide-y divide-gray-50">
          {days.length === 0 && <p className="text-center text-gray-400 py-12">No ads found in the last 90 days</p>}
          {days.map(day => (
            <button
              key={day.date}
              onClick={() => openDay(day.date)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-blue-50/50 transition-colors group text-left"
            >
              <div className="w-36 shrink-0">
                <p className="text-sm font-medium text-gray-800">{formatDate(day.date)}</p>
              </div>
              <div className="flex-1 flex items-center gap-3">
                <div className="flex-1 h-7 bg-gray-100 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all"
                    style={{ width: `${Math.max((day.count / maxCount) * 100, 4)}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-gray-700 w-10 text-right">{day.count}</span>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {Object.entries(day.lanes).map(([lane, cnt]) => (
                  <span key={lane} className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANE_COLORS[lane] || LANE_COLORS.unknown}`}>
                    {lane} {cnt}
                  </span>
                ))}
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* ── Day detail: accounts that generated ads that day ── */}
      {view === 'day-detail' && (
        <div>
          {dayLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : accounts.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No ads found for this day</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {accounts.map(acct => (
                <button
                  key={acct.userId}
                  onClick={() => openAccountPreview(acct)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-blue-50/50 transition-colors group text-left"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{acct.email}</p>
                    <p className="text-xs text-gray-400">
                      {acct.adCount} ad{acct.adCount !== 1 ? 's' : ''}
                      {acct.ads[0]?.businessName && ` · ${acct.ads[0].businessName}`}
                      {acct.ads[0]?.websiteUrl && ` · ${acct.ads[0].websiteUrl}`}
                    </p>
                  </div>
                  {/* Mini thumbnails */}
                  <div className="flex -space-x-2 shrink-0">
                    {acct.ads.slice(0, 4).map((ad, i) => (
                      <div key={ad.id} className="w-10 h-10 rounded-lg border-2 border-white overflow-hidden bg-gray-100 relative" style={{ zIndex: 4 - i }}>
                        {ad.imageUrl ? (
                          <NextImage src={ad.imageUrl} alt={ad.headline || 'Ad'} fill className="object-cover" sizes="40px" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-4 h-4 text-gray-300" />
                          </div>
                        )}
                      </div>
                    ))}
                    {acct.adCount > 4 && (
                      <div className="w-10 h-10 rounded-lg border-2 border-white bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                        +{acct.adCount - 4}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Preview: ad gallery for selected account ── */}
      {view === 'preview' && selectedAccount && (
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {selectedAccount.ads.map(ad => (
              <div
                key={ad.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => setPreviewAd(ad)}
              >
                {/* Image */}
                <div className="relative aspect-[4/5] bg-gray-100">
                  {ad.imageUrl ? (
                    <NextImage src={ad.imageUrl} alt={ad.headline || 'Ad preview'} fill className="object-cover" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" unoptimized />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-gray-300" />
                    </div>
                  )}
                  {/* Lane badge */}
                  {ad.lane && (
                    <span className={`absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full font-medium ${LANE_COLORS[ad.lane] || LANE_COLORS.unknown}`}>
                      {ad.lane}
                    </span>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Eye className="w-8 h-8 text-white drop-shadow-lg" />
                  </div>
                </div>
                {/* Info */}
                <div className="p-3">
                  {ad.headline && <p className="text-sm font-semibold text-gray-800 truncate">{ad.headline}</p>}
                  {ad.businessName && <p className="text-xs text-gray-400 truncate">{ad.businessName}</p>}
                  <p className="text-xs text-gray-300 mt-1">{new Date(ad.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Full-screen preview modal ── */}
      {previewAd && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreviewAd(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                {previewAd.lane && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANE_COLORS[previewAd.lane] || LANE_COLORS.unknown}`}>{previewAd.lane}</span>}
                {previewAd.businessName && <span className="text-sm font-medium text-gray-600">{previewAd.businessName}</span>}
              </div>
              <button onClick={() => setPreviewAd(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            {previewAd.imageUrl && (
              <div className="relative w-full aspect-[4/5] bg-gray-100">
                <NextImage src={previewAd.imageUrl} alt={previewAd.headline || 'Ad'} fill className="object-contain" sizes="512px" unoptimized />
              </div>
            )}
            <div className="p-5 space-y-3">
              {previewAd.headline && <h3 className="text-lg font-bold text-gray-900">{previewAd.headline}</h3>}
              {previewAd.caption && <p className="text-sm text-gray-600 whitespace-pre-wrap">{previewAd.caption}</p>}
              {previewAd.websiteUrl && <p className="text-xs text-blue-500">{previewAd.websiteUrl}</p>}
              <p className="text-xs text-gray-300">{new Date(previewAd.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Accounts
// ═══════════════════════════════════════════════════════════════

function AccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30' });
    if (search) params.set('search', search);
    const res = await fetch(`/api/admin/accounts?${params}`);
    const data = await res.json();
    setAccounts(data.accounts || []);
    setTotalPages(data.pagination?.totalPages || 1);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by email..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button onClick={load} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Confirmed</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Biz</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Analyses</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Ads</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Posts</th>
                <th className="px-4 py-3 font-medium text-gray-500">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[200px]">{a.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      a.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>{a.role}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {a.confirmed ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" /> : <XCircle className="w-4 h-4 text-gray-300 mx-auto" />}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{a.businessCount}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{a.analysisCount}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{a.adCount}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{a.socialPostCount}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No accounts found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Businesses
// ═══════════════════════════════════════════════════════════════

interface BusinessRow {
  id: string;
  source: 'frontend' | 'tombstone';
  tombstoneBusinessId: number | null;
  websiteUrl: string;
  businessName: string | null;
  businessCity: string | null;
  businessState: string | null;
  ownerEmail: string | null;
  analysisCount: number;
  adCount: number;
  socialPostCount: number;
  taskCount: number;
  workflowCount: number;
  latestAnalysisId: string | null;
  latestAnalysisStatus: string | null;
  createdAt: string;
}

function BusinessesTab() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30' });
    if (search) params.set('search', search);
    const res = await fetch(`/api/admin/businesses?${params}`);
    const data = await res.json();
    setBusinesses(data.businesses || []);
    setTotalPages(data.pagination?.totalPages || 1);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string | null) => {
    if (!s) return 'bg-gray-100 text-gray-500';
    if (s === 'completed') return 'bg-green-100 text-green-700';
    if (s === 'processing') return 'bg-blue-100 text-blue-700';
    if (s === 'provisional') return 'bg-amber-100 text-amber-700';
    if (s === 'error' || s === 'Failed') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
  };

  const handleBusinessClick = (b: BusinessRow) => {
    if (b.latestAnalysisId) {
      router.push(`/results/${b.latestAnalysisId}`);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, URL, or owner email..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button onClick={load} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500">Business</th>
                <th className="px-4 py-3 font-medium text-gray-500">URL</th>
                <th className="px-4 py-3 font-medium text-gray-500">Location</th>
                <th className="px-4 py-3 font-medium text-gray-500">Owner</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Workflows</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Tasks</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Posts</th>
                <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {businesses.map(b => (
                <tr
                  key={b.id}
                  onClick={() => handleBusinessClick(b)}
                  className={`hover:bg-blue-50/50 transition-colors ${
                    b.latestAnalysisId ? 'cursor-pointer' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="font-medium text-gray-900 truncate max-w-[180px]">
                        {b.businessName || '—'}
                      </span>
                      {b.source === 'tombstone' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-medium whitespace-nowrap">Pipeline</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-gray-500 truncate max-w-[180px]">
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{b.websiteUrl?.replace(/^https?:\/\//, '') || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                    {[b.businessCity, b.businessState].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-[150px] text-xs">{b.ownerEmail || '—'}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.workflowCount || b.analysisCount || 0}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.taskCount || b.adCount || 0}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.socialPostCount}</td>
                  <td className="px-4 py-3">
                    {b.latestAnalysisStatus ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(b.latestAnalysisStatus)}`}>
                        {b.latestAnalysisStatus}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'}
                  </td>
                </tr>
              ))}
              {businesses.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No businesses found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Usage
// ═══════════════════════════════════════════════════════════════

function UsageTab() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/usage').then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;
  if (!data) return <p className="text-gray-500 text-center py-8">Failed to load usage data</p>;

  return (
    <div className="space-y-8">
      {/* Breakdown cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <BreakdownCard title="Analyses by Status" total={data.analyses.total} items={data.analyses.byStatus} />
        <BreakdownCard title="Ads by Lane" total={data.ads.total} items={data.ads.byLane} />
        <BreakdownCard title="Social Posts by Status" total={data.socialPosts.total} items={data.socialPosts.byStatus} />
      </div>

      {/* Per-business table */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Per-Business Breakdown</h3>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500">Business</th>
                <th className="px-4 py-3 font-medium text-gray-500">URL</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Analyses</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Ads</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">Posts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.perBusiness.map(b => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{b.businessName}</td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]">{b.websiteUrl}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.analysisCount}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.adCount}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{b.socialPostCount}</td>
                </tr>
              ))}
              {data.perBusiness.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No businesses yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BreakdownCard({ title, total, items }: { title: string; total: number; items: Record<string, number> }) {
  const entries = Object.entries(items).sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
      <p className="text-2xl font-bold text-gray-900 mb-4">{total.toLocaleString()}</p>
      <div className="space-y-2">
        {entries.map(([key, count]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-sm text-gray-600 capitalize">{key.replace(/_/g, ' ')}</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
              </div>
              <span className="text-sm font-medium text-gray-700 w-8 text-right">{count}</span>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-gray-400">No data</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Password Resets
// ═══════════════════════════════════════════════════════════════

function ResetsTab() {
  const [resets, setResets] = useState<ResetItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/password-resets').then(r => r.json()).then(d => setResets(d.resets || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-4 py-3 font-medium text-gray-500">User Email</th>
            <th className="px-4 py-3 font-medium text-gray-500">Requested</th>
            <th className="px-4 py-3 font-medium text-gray-500">Expires</th>
            <th className="px-4 py-3 font-medium text-gray-500 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {resets.map(r => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{r.userEmail}</td>
              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(r.requestedAt).toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(r.expiresAt).toLocaleString()}</td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  r.status === 'used' ? 'bg-green-100 text-green-700' :
                  r.status === 'expired' ? 'bg-gray-100 text-gray-500' :
                  'bg-amber-100 text-amber-700'
                }`}>{r.status}</span>
              </td>
            </tr>
          ))}
          {resets.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No password resets recorded</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Agent Status (live polling)
// ═══════════════════════════════════════════════════════════════

function AgentsTab() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [error, setError] = useState('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [apiUnreachable, setApiUnreachable] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents');
      const data = await res.json();
      if (data.agents) {
        setAgents(data.agents);
        setLastFetch(data.fetchedAt || new Date().toISOString());
        setApiUnreachable(!!data.api_unreachable);
        setError(data.api_unreachable ? (data.error || 'Backend unreachable') : '');
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError('Failed to fetch agent status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    intervalRef.current = setInterval(fetchAgents, 12000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAgents]);

  const statusConfig: Record<string, { color: string; bg: string; label: string; dot: string }> = {
    alive_idle: { color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', label: 'Idle', dot: 'bg-purple-400' },
    alive_busy: { color: 'text-green-700', bg: 'bg-green-50 border-green-200', label: 'Active', dot: 'bg-green-500 animate-pulse' },
    stale: { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Stale', dot: 'bg-amber-500' },
    offline: { color: 'text-red-700', bg: 'bg-red-50 border-red-200', label: 'On standby', dot: 'bg-red-500' },
    unreachable: { color: 'text-gray-500', bg: 'bg-gray-50 border-gray-300 border-dashed', label: 'Unreachable', dot: 'bg-gray-400' },
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;

  const alive = agents.filter(a => a.status === 'alive_idle' || a.status === 'alive_busy').length;
  const stale = agents.filter(a => a.status === 'stale').length;
  const offline = agents.filter(a => a.status === 'offline').length;

  // Heartbeat freshness alerting — warn if any critical worker is > 120s stale
  const HEARTBEAT_WARN_SECONDS = 120;
  const criticalAgents = ['Jim Bridger', 'Andy Warhol', 'David Ogilvy', 'Don Draper', 'Dispatcher'];
  const staleWorkers = agents.filter(a =>
    criticalAgents.includes(a.name) &&
    a.seconds_since_heartbeat != null &&
    a.seconds_since_heartbeat > HEARTBEAT_WARN_SECONDS
  );

  const formatHeartbeat = (secs: number | undefined | null) => {
    if (secs == null) return null;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
  };

  return (
    <div>
      {/* API unreachable banner */}
      {apiUnreachable && (
        <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-blue-800">⚡ Backend Unreachable</span>
          </div>
          <p className="text-xs text-blue-700">
            {error || 'Could not reach the Tombstone API.'} Showing known roster with unknown status.
            The backend may be cold-starting — status will update automatically.
          </p>
        </div>
      )}
      {/* Heartbeat freshness warning banner */}
      {staleWorkers.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-600 text-sm font-semibold">⚠ Heartbeat Warning</span>
          </div>
          <p className="text-xs text-amber-700">
            {staleWorkers.length} worker{staleWorkers.length > 1 ? 's' : ''} with stale heartbeat ({'>'}{HEARTBEAT_WARN_SECONDS}s):{' '}
            {staleWorkers.map(w => `${w.display_name} (${formatHeartbeat(w.seconds_since_heartbeat)})`).join(', ')}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            New requests may experience delays. Workers may be restarting or under load.
          </p>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-6 mb-6 text-sm">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> {alive} online
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> {stale} stale
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> {offline} on standby
        </span>
        {lastFetch && (
          <span className="text-gray-400 text-xs ml-auto">
            Last update: {new Date(lastFetch).toLocaleTimeString()}
          </span>
        )}
        {error && <span className="text-red-500 text-xs ml-2">{error}</span>}
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map(agent => {
          const cfg = statusConfig[agent.status] || statusConfig.offline;
          const hbWarn = agent.seconds_since_heartbeat != null && agent.seconds_since_heartbeat > HEARTBEAT_WARN_SECONDS;
          return (
            <div key={agent.name} className={`rounded-xl border p-4 ${hbWarn ? 'bg-amber-50 border-amber-300' : cfg.bg}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={`text-sm font-semibold ${hbWarn ? 'text-amber-700' : cfg.color}`}>{agent.display_name}</h3>
                <span className={`w-3 h-3 rounded-full ${hbWarn ? 'bg-amber-500 animate-pulse' : cfg.dot}`} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">
                  Status: <span className={`font-medium ${hbWarn ? 'text-amber-700' : cfg.color}`}>{cfg.label}</span>
                </p>
                {agent.department && (
                  <p className="text-xs text-gray-500">Dept: {agent.department}</p>
                )}
                {agent.current_task_id && (
                  <p className="text-xs text-gray-500">
                    Task: <span className="font-mono text-gray-700">#{agent.current_task_id}</span>
                  </p>
                )}
                {/* Heartbeat freshness */}
                {agent.seconds_since_heartbeat != null && (
                  <p className={`text-xs ${hbWarn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                    Heartbeat: {formatHeartbeat(agent.seconds_since_heartbeat)}
                    {hbWarn && ' ⚠'}
                  </p>
                )}
                {!agent.seconds_since_heartbeat && agent.last_seen && (
                  <p className="text-xs text-gray-400">
                    Last seen: {formatTimeAgo(agent.last_seen)}
                  </p>
                )}
                {agent.service_name && (
                  <p className="text-xs text-gray-300 font-mono truncate" title={agent.service_name}>
                    {agent.service_name}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Tasks & Processes (live polling)
// ═══════════════════════════════════════════════════════════════

const TASK_STATUS_COLORS: Record<string, string> = {
  'in progress': 'bg-blue-100 text-blue-700',
  'in_progress': 'bg-blue-100 text-blue-700',
  'running': 'bg-blue-100 text-blue-700',
  'claimed': 'bg-blue-100 text-blue-700',
  'ready for pickup': 'bg-gray-100 text-gray-600',
  'blocked': 'bg-amber-100 text-amber-700',
  'failed': 'bg-red-100 text-red-700',
  'error': 'bg-red-100 text-red-700',
  'complete': 'bg-green-100 text-green-700',
  'completed': 'bg-green-100 text-green-700',
};

// VCE / Agency sections we detect in output JSON
const AGENCY_SECTIONS: { key: string; label: string; paths: string[] }[] = [
  { key: 'memory', label: 'Business Memory', paths: ['business_memory', 'memory_context'] },
  { key: 'playbook', label: 'Industry Playbook', paths: ['industry_playbook', 'playbook_context'] },
  { key: 'territories', label: 'Creative Territories', paths: ['creative_territories'] },
  { key: 'scorecard', label: 'War Room Scorecard', paths: ['scorecard', 'war_room_scorecard'] },
  { key: 'vce', label: 'Visual Concept Engineering', paths: ['visual_concept_engineering', 'vce_user_summary'] },
  { key: 'render_contract', label: 'Don Render Contract', paths: ['render_prompt', 'composition', 'visual_concept', 'cta_style', 'must_include'] },
  { key: 'preflight', label: 'Andy Preflight', paths: ['preflight_result', 'preflight_checks', 'validation_checklist'] },
];

function detectAgencySections(parsed: any): { key: string; label: string; data: any }[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const result: { key: string; label: string; data: any }[] = [];
  for (const sec of AGENCY_SECTIONS) {
    for (const p of sec.paths) {
      if (parsed[p] !== undefined && parsed[p] !== null) {
        result.push({ key: sec.key, label: sec.label, data: parsed[p] });
        break;
      }
    }
  }
  return result;
}

function tryParseJson(s: string): { parsed: any; isJson: boolean } {
  if (!s || typeof s !== 'string') return { parsed: s, isJson: false };
  try {
    const p = JSON.parse(s);
    return { parsed: p, isJson: true };
  } catch {
    return { parsed: s, isJson: false };
  }
}

// ─── Task Output Card ────────────────────────────────────────
function TaskOutputCard({ output }: { output: any }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const { parsed, isJson } = tryParseJson(output.output);
  const preview = typeof output.output === 'string' ? output.output.slice(0, 300) : JSON.stringify(output.output).slice(0, 300);
  const agencySections = isJson ? detectAgencySections(parsed) : [];

  const handleCopy = () => {
    navigator.clipboard.writeText(typeof output.output === 'string' ? output.output : JSON.stringify(output.output, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400">#{output.id}</span>
          <span className="text-sm font-medium text-gray-700">{output.agent}</span>
          <span className="text-xs text-gray-400">{output.created_at ? new Date(output.created_at).toLocaleString() : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">
            <Copy className="w-3 h-3" /> {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Preview when collapsed */}
      {!expanded && (
        <div className="px-4 py-3">
          <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono">
            {preview}{preview.length >= 300 ? '…' : ''}
          </pre>
        </div>
      )}

      {/* Full output when expanded */}
      {expanded && (
        <div className="px-4 py-3 space-y-3">
          {/* Agency sections */}
          {agencySections.length > 0 && (
            <div className="space-y-2">
              {agencySections.map(sec => (
                <div key={sec.key} className="border border-blue-100 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSections(prev => ({ ...prev, [sec.key]: !prev[sec.key] }))}
                    className="w-full px-3 py-2 bg-blue-50 text-left flex items-center justify-between hover:bg-blue-100 transition-colors"
                  >
                    <span className="text-xs font-semibold text-blue-700">{sec.label}</span>
                    {expandedSections[sec.key] ? <ChevronUp className="w-3 h-3 text-blue-500" /> : <ChevronDown className="w-3 h-3 text-blue-500" />}
                  </button>
                  {expandedSections[sec.key] && (
                    <div className="px-3 py-2 bg-white">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all font-mono max-h-[400px] overflow-y-auto">
                        {typeof sec.data === 'string' ? sec.data : JSON.stringify(sec.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Full JSON output */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Full Output</p>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all font-mono max-h-[600px] overflow-y-auto bg-gray-50 rounded-lg p-3">
              {isJson ? JSON.stringify(parsed, null, 2) : output.output}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Task Detail Drawer ──────────────────────────────────────
function TaskDetailDrawer({ taskId, onClose, onOpenWorkflow }: {
  taskId: number;
  onClose: () => void;
  onOpenWorkflow: (wfId: string) => void;
}) {
  const [task, setTask] = useState<any>(null);
  const [outputs, setOutputs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/admin/tasks/${taskId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setTask(data.task);
        setOutputs(data.outputs || []);
      })
      .catch(() => setError('Failed to load task'))
      .finally(() => setLoading(false));
  }, [taskId]);

  const fieldRow = (label: string, value: any, mono = false) => (
    <div className="flex justify-between py-1.5 border-b border-gray-50">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-xs text-right max-w-[60%] break-all ${mono ? 'font-mono' : ''} ${
        label === 'last_error' && value ? 'text-red-600 font-medium' : 'text-gray-700'
      }`}>{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* Drawer */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-gray-900">Task #{taskId}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-red-500">{error}</div>
        ) : task ? (
          <div className="px-6 py-4 space-y-6">
            {/* Status badge */}
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                TASK_STATUS_COLORS[(task.status || '').toLowerCase()] || 'bg-gray-100 text-gray-500'
              }`}>{task.status}</span>
              <span className="text-sm text-gray-600">{task.department}</span>
              {task.workflow_id && (
                <button
                  onClick={() => onOpenWorkflow(task.workflow_id)}
                  className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <ExternalLink className="w-3 h-3" /> View Workflow
                </button>
              )}
            </div>

            {/* Mission/Summary */}
            {task.mission && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Mission</p>
                <p className="text-sm text-gray-800">{task.mission}</p>
              </div>
            )}
            {task.summary && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Summary</p>
                <p className="text-sm text-gray-700">{task.summary}</p>
              </div>
            )}

            {/* Core fields */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Task Metadata</p>
              {fieldRow('Task ID', `#${task.id}`, true)}
              {fieldRow('Workflow ID', task.workflow_id || '—', true)}
              {fieldRow('Department', task.department)}
              {fieldRow('Status', task.status)}
              {fieldRow('Step Order', task.step_order)}
              {fieldRow('Execution Mode', task.execution_mode)}
              {fieldRow('Claimed By', task.claimed_by)}
              {fieldRow('Worker Instance', task.worker_instance_id)}
              {fieldRow('Claim Token Present', task.claim_token_present ? 'Yes' : 'No')}
              {fieldRow('Created At', task.created_at ? new Date(task.created_at).toLocaleString() : '—')}
              {fieldRow('Claimed At', task.claimed_at ? new Date(task.claimed_at).toLocaleString() : '—')}
              {fieldRow('Heartbeat At', task.heartbeat_at ? new Date(task.heartbeat_at).toLocaleString() : '—')}
              {fieldRow('Last Attempt', task.last_attempt_at ? new Date(task.last_attempt_at).toLocaleString() : '—')}
              {fieldRow('Updated At', task.updated_at ? new Date(task.updated_at).toLocaleString() : '—')}
              {fieldRow('Retry Count', `${task.retry_count ?? 0} / ${task.max_retries ?? 3}`)}
              {fieldRow('Depends On Task', task.depends_on_task_id ? `#${task.depends_on_task_id}` : '—', true)}
              {fieldRow('Input From Task', task.input_from_task_id ? `#${task.input_from_task_id}` : '—', true)}
            </div>

            {/* Timing Panel */}
            {(() => {
              const created = task.created_at ? new Date(task.created_at).getTime() : null;
              const claimed = task.claimed_at ? new Date(task.claimed_at).getTime() : null;
              const heartbeat = task.heartbeat_at ? new Date(task.heartbeat_at).getTime() : null;
              const updated = task.updated_at ? new Date(task.updated_at).getTime() : null;
              const isComp = ['complete', 'completed'].includes((task.status || '').toLowerCase());
              const isFail = ['failed', 'error'].includes((task.status || '').toLowerCase());
              const endAt = (isComp || isFail) && updated ? updated : null;
              const fmtMs = (ms: number | null) => {
                if (ms === null) return '—';
                if (ms < 1000) return `${Math.round(ms)}ms`;
                const s = ms / 1000;
                if (s < 60) return `${s.toFixed(1)}s`;
                return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
              };
              const createdToClaimed = created && claimed ? claimed - created : null;
              const claimedToHeart = claimed && heartbeat ? heartbeat - claimed : null;
              const activeProc = claimed && endAt ? endAt - claimed : null;
              const totalLife = created && endAt ? endAt - created : null;
              const heartAge = heartbeat && !isComp && !isFail ? Date.now() - heartbeat : null;

              // Lag warnings
              const warns: string[] = [];
              if (createdToClaimed !== null && createdToClaimed > 10000) warns.push(`Agent pickup delay: ${fmtMs(createdToClaimed)}`);
              if (claimedToHeart !== null && claimedToHeart > 10000) warns.push(`Worker heartbeat delay: ${fmtMs(claimedToHeart)}`);
              if (heartAge !== null && heartAge > 60000) warns.push(`Stale heartbeat: ${fmtMs(heartAge)} since last`);

              return (
                <div className="bg-indigo-50 rounded-lg p-4">
                  <p className="text-xs font-semibold text-indigo-600 mb-2 uppercase tracking-wide">Timing</p>
                  {fieldRow('Created → Claimed', fmtMs(createdToClaimed))}
                  {fieldRow('Claimed → First Heartbeat', fmtMs(claimedToHeart))}
                  {fieldRow('Active Processing', fmtMs(activeProc))}
                  {fieldRow('Total Lifecycle', fmtMs(totalLife))}
                  {heartAge !== null && fieldRow('Heartbeat Age', fmtMs(heartAge))}
                  {fieldRow('Retry Count', `${task.retry_count ?? 0}`)}
                  {warns.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {warns.map((w, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Error */}
            {task.last_error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-red-600 mb-1">Last Error</p>
                <pre className="text-xs text-red-700 whitespace-pre-wrap break-all font-mono">{task.last_error}</pre>
              </div>
            )}

            {/* Blocked reason */}
            {task.blocked_reason && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-amber-600 mb-1">Blocked Reason</p>
                <p className="text-xs text-amber-700">{task.blocked_reason}</p>
              </div>
            )}

            {/* Execution notes */}
            {task.execution_notes && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Execution Notes</p>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all font-mono bg-gray-50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                  {task.execution_notes}
                </pre>
              </div>
            )}

            {/* Outputs */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">
                Task Outputs ({outputs.length})
              </p>
              {outputs.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No outputs recorded</p>
              ) : (
                <div className="space-y-3">
                  {outputs.map((o: any) => <TaskOutputCard key={o.id} output={o} />)}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Workflow Detail Drawer ──────────────────────────────────
function WorkflowDetailDrawer({ workflowId, onClose, onOpenTask }: {
  workflowId: string;
  onClose: () => void;
  onOpenTask: (taskId: number) => void;
}) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [mission, setMission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/admin/tasks/workflow/${workflowId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setTasks(data.tasks || []);
        setMission(data.mission);
      })
      .catch(() => setError('Failed to load workflow'))
      .finally(() => setLoading(false));
  }, [workflowId]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Workflow</h3>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{workflowId}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-red-500">{error}</div>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {mission && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Mission</p>
                <p className="text-sm text-gray-800">{mission}</p>
              </div>
            )}
            <p className="text-xs text-gray-400">{tasks.length} tasks in workflow</p>

            <div className="space-y-2">
              {tasks.map((t: any, i: number) => {
                const statusCls = TASK_STATUS_COLORS[(t.status || '').toLowerCase()] || 'bg-gray-100 text-gray-500';
                const isFailed = ['failed', 'error'].includes((t.status || '').toLowerCase());
                return (
                  <div key={t.id}>
                    <button
                      onClick={() => onOpenTask(t.id)}
                      className={`w-full text-left px-4 py-3 rounded-lg border hover:shadow-sm transition-all ${
                        isFailed ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-400">#{t.id}</span>
                          <span className="text-sm font-medium text-gray-800">{t.department}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCls}`}>{t.status}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </div>
                      {t.summary && <p className="text-xs text-gray-500 line-clamp-2">{t.summary}</p>}
                      {t.last_error && (
                        <p className="text-xs text-red-600 mt-1 truncate">{t.last_error}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                        {t.step_order != null && <span>Step {t.step_order}</span>}
                        {t.claimed_by && <span>By: {t.claimed_by}</span>}
                        {t.depends_on_task_id && <span>Depends: #{t.depends_on_task_id}</span>}
                        <span>Retries: {t.retry_count ?? 0}/{t.max_retries ?? 3}</span>
                      </div>
                    </button>
                    {i < tasks.length - 1 && (
                      <div className="flex justify-center py-1">
                        <div className="w-0.5 h-3 bg-gray-200" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tasks Tab ───────────────────────────────────────────────
function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('in progress,ready for pickup,failed,blocked');
  const [hours, setHours] = useState(24);
  const [pageSize, setPageSize] = useState(10);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Drawer state
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);
    params.set('hours', String(hours));
    try {
      const res = await fetch(`/api/admin/tasks?${params}`);
      const data = await res.json();
      setTasks(data.tasks || []);
      setLastFetch(data.fetchedAt || new Date().toISOString());
    } catch { /* silent */ }
    setLoading(false);
  }, [statusFilter, search, hours]);

  useEffect(() => {
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchTasks]);

  const FILTER_PRESETS = [
    { label: 'Active', value: 'in progress,ready for pickup,blocked,claimed' },
    { label: 'Failed', value: 'failed,error' },
    { label: 'All', value: '' },
  ];

  const displayedTasks = tasks.slice(0, pageSize);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-1">
          {FILTER_PRESETS.map(fp => (
            <button
              key={fp.label}
              onClick={() => setStatusFilter(fp.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                statusFilter === fp.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{fp.label}</button>
          ))}
        </div>
        <select
          value={hours}
          onChange={e => setHours(parseInt(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value={6}>Last 6h</option>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 3d</option>
          <option value={168}>Last 7d</option>
        </select>
        <select
          value={pageSize}
          onChange={e => setPageSize(parseInt(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value={10}>Show 10</option>
          <option value={25}>Show 25</option>
          <option value={50}>Show 50</option>
        </select>
        {lastFetch && (
          <span className="text-gray-400 text-xs ml-auto">Updated: {new Date(lastFetch).toLocaleTimeString()}</span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-3 font-medium text-gray-500 w-16">ID</th>
                <th className="px-3 py-3 font-medium text-gray-500">Department</th>
                <th className="px-3 py-3 font-medium text-gray-500 text-center">Status</th>
                <th className="px-3 py-3 font-medium text-gray-500">Claimed By</th>
                <th className="px-3 py-3 font-medium text-gray-500">Workflow</th>
                <th className="px-3 py-3 font-medium text-gray-500">Heartbeat</th>
                <th className="px-3 py-3 font-medium text-gray-500">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedTasks.map(t => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-3 font-mono text-gray-700 text-xs">#{t.id}</td>
                  <td className="px-3 py-3 text-gray-700">{t.department || '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      TASK_STATUS_COLORS[(t.status || '').toLowerCase()] || 'bg-gray-100 text-gray-500'
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{t.claimed_by || '—'}</td>
                  <td className="px-3 py-3 font-mono text-gray-400 text-xs truncate max-w-[120px]">{t.workflow_id?.slice(0, 8) || '—'}</td>
                  <td className="px-3 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {t.heartbeat_at ? formatTimeAgo(t.heartbeat_at) : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {t.last_error ? (
                      <span className="text-red-600 truncate max-w-[200px] block" title={t.last_error}>
                        {t.last_error.slice(0, 80)}{t.last_error.length > 80 ? '…' : ''}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {displayedTasks.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No tasks match the current filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3 text-center">
        Showing {displayedTasks.length} of {tasks.length} tasks • Auto-refreshing every 15 seconds
      </p>

      {/* Task Detail Drawer */}
      {selectedTaskId !== null && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onOpenWorkflow={(wfId) => {
            setSelectedTaskId(null);
            setSelectedWorkflowId(wfId);
          }}
        />
      )}

      {/* Workflow Detail Drawer */}
      {selectedWorkflowId !== null && (
        <WorkflowDetailDrawer
          workflowId={selectedWorkflowId}
          onClose={() => setSelectedWorkflowId(null)}
          onOpenTask={(taskId) => {
            setSelectedWorkflowId(null);
            setSelectedTaskId(taskId);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Agent Output Audit
// ═══════════════════════════════════════════════════════════════

interface AuditStage {
  taskId: number;
  agentName: string;
  departmentLabel: string;
  sortOrder: number;
  stepOrder: number | null;
  status: string;
  claimedBy: string | null;
  dependsOnTaskId: number | null;
  inputFromTaskId: number | null;
  createdAt: string | null;
  completedAt: string | null;
  mission: string | null;
  summary: string | null;
  rawOutput: string | null;
  parsedOutput: any;
  metadata: Record<string, any> | null;
  artifactUrl: string | null;
  retryCount: number;
  lastError: string | null;
}

interface AuditData {
  post: {
    id: string; caption: string; hashtags: string[];
    imageUrl: string | null; imagePrompt: string | null;
    status: string; postType: string; sourceType: string | null;
    tombstoneTaskId: string; createdAt: string;
  } | null;
  workflowId?: string;
  taskCount?: number;
  hopkinsNote?: string | null;
  stages: AuditStage[];
  error?: string;
}

const AGENT_COLORS: Record<string, string> = {
  'Jim Bridger':     'border-emerald-500 bg-emerald-50',
  'Zig Ziglar':      'border-amber-500 bg-amber-50',
  'David Ogilvy':    'border-purple-500 bg-purple-50',
  'Don Draper':      'border-sky-500 bg-sky-50',
  'Andy Warhol':     'border-rose-500 bg-rose-50',
  'Claude Hopkins':  'border-gray-400 bg-gray-50',
  'Wyatt Earp':      'border-yellow-500 bg-yellow-50',
  'Dispatcher':      'border-gray-300 bg-gray-50',
};

const AGENT_DOT_COLORS: Record<string, string> = {
  'Jim Bridger':     'bg-emerald-500',
  'Zig Ziglar':      'bg-amber-500',
  'David Ogilvy':    'bg-purple-500',
  'Don Draper':      'bg-sky-500',
  'Andy Warhol':     'bg-rose-500',
  'Claude Hopkins':  'bg-gray-400',
  'Wyatt Earp':      'bg-yellow-500',
  'Dispatcher':      'bg-gray-400',
};

function statusBadge(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'complete' || s === 'completed') return 'bg-green-100 text-green-800';
  if (s === 'failed' || s === 'error') return 'bg-red-100 text-red-800';
  if (s.includes('progress') || s === 'running' || s === 'claimed') return 'bg-blue-100 text-blue-800';
  if (s === 'blocked') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-700';
}

function AuditTab() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, string | null>>({});  // taskId → active section

  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/agent-audit')
      .then(r => r.json())
      .then(setData)
      .catch(err => setData({ error: err.message, post: null, stages: [] }))
      .finally(() => setLoading(false));
  }, []);

  const toggleSection = (taskId: number, section: string) => {
    setExpanded(prev => ({
      ...prev,
      [taskId]: prev[taskId] === section ? null : section,
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        <span className="ml-3 text-gray-500">Loading audit data…</span>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">Could not load audit data</p>
        <p className="text-sm text-gray-500 mt-1">{data?.error || 'Unknown error'}</p>
      </div>
    );
  }

  if (!data.post) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <Eye className="w-8 h-8 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">No social posts linked to Tombstone tasks</p>
        <p className="text-sm text-gray-500 mt-1">Generate a social post first to see the agent output audit.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Post summary card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Most Recent Generated Post</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Task #{data.post.tombstoneTaskId} • Workflow: <code className="bg-gray-200 px-1 py-0.5 rounded text-[10px]">{data.workflowId || '—'}</code> • {data.taskCount || 0} pipeline stages
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge(data.post.status)}`}>
            {data.post.status}
          </span>
        </div>
        <div className="p-6 flex gap-6">
          {data.post.imageUrl && (
            <div className="w-40 h-40 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 relative">
              <NextImage src={data.post.imageUrl} alt="Post image" fill className="object-cover" unoptimized />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800 line-clamp-4">{data.post.caption}</p>
            {data.post.hashtags?.length > 0 && (
              <p className="text-xs text-blue-600 mt-2 truncate">{data.post.hashtags.join(' ')}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500">
              <span>Type: <strong>{data.post.postType}</strong></span>
              {data.post.sourceType && <span>Source: <strong>{data.post.sourceType}</strong></span>}
              <span>Created: <strong>{new Date(data.post.createdAt).toLocaleString()}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Hopkins bypass note */}
      {data.hopkinsNote && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800">{data.hopkinsNote}</p>
        </div>
      )}

      {/* Pipeline stages */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Pipeline Stages</h3>
        <div className="space-y-3">
          {data.stages.map((stage, i) => {
            const colorClass = AGENT_COLORS[stage.agentName] || 'border-gray-300 bg-gray-50';
            const dotColor = AGENT_DOT_COLORS[stage.agentName] || 'bg-gray-400';
            const activeSection = expanded[stage.taskId] || null;

            return (
              <div key={stage.taskId} className={`border-l-4 rounded-lg border ${colorClass} overflow-hidden`}>
                {/* Stage header */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs text-gray-400 font-mono w-5">{i + 1}</span>
                      <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                      <span className="text-sm font-semibold text-gray-900">{stage.agentName}</span>
                      <span className="text-xs text-gray-500">/ {stage.departmentLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge(stage.status)}`}>
                        {stage.status}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">#{stage.taskId}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-500">
                    {stage.createdAt && <span>Created: {new Date(stage.createdAt).toLocaleString()}</span>}
                    {stage.completedAt && <span>Completed: {new Date(stage.completedAt).toLocaleString()}</span>}
                    {stage.dependsOnTaskId && <span>Depends on: #{stage.dependsOnTaskId}</span>}
                    {stage.inputFromTaskId && <span>Input from: #{stage.inputFromTaskId}</span>}
                    {stage.retryCount > 0 && <span className="text-amber-600">Retries: {stage.retryCount}</span>}
                  </div>
                  {stage.summary && (
                    <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{stage.summary}</p>
                  )}
                  {stage.lastError && (
                    <p className="text-xs text-red-600 mt-1 line-clamp-1">Error: {stage.lastError}</p>
                  )}
                </div>

                {/* Expandable sections */}
                <div className="border-t border-gray-200/60 bg-white/60 flex gap-0">
                  {(['summary', 'raw', 'parsed', 'metadata', 'artifact'] as const).map(sec => {
                    const isDisabled =
                      (sec === 'raw' && !stage.rawOutput) ||
                      (sec === 'parsed' && !stage.parsedOutput) ||
                      (sec === 'metadata' && !stage.metadata) ||
                      (sec === 'artifact' && !stage.artifactUrl);

                    return (
                      <button
                        key={sec}
                        disabled={isDisabled}
                        onClick={() => toggleSection(stage.taskId, sec)}
                        className={`px-3 py-1.5 text-[10px] font-medium transition-colors capitalize ${
                          isDisabled
                            ? 'text-gray-300 cursor-default'
                            : activeSection === sec
                              ? 'text-blue-600 bg-blue-50'
                              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {sec === 'raw' ? 'Raw Output' : sec === 'parsed' ? 'Structured' : sec === 'artifact' ? 'Artifact' : sec.charAt(0).toUpperCase() + sec.slice(1)}
                      </button>
                    );
                  })}
                </div>

                {/* Section content */}
                {activeSection === 'summary' && (
                  <div className="px-4 py-3 bg-white border-t border-gray-100">
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{stage.summary || stage.mission || 'No summary available'}</p>
                  </div>
                )}
                {activeSection === 'raw' && stage.rawOutput && (
                  <div className="px-4 py-3 bg-white border-t border-gray-100">
                    <pre className="text-[10px] text-gray-700 whitespace-pre-wrap break-all max-h-80 overflow-auto font-mono bg-gray-50 rounded p-3">
                      {stage.rawOutput.length > 8000 ? stage.rawOutput.slice(0, 8000) + '\n\n… [truncated]' : stage.rawOutput}
                    </pre>
                  </div>
                )}
                {activeSection === 'parsed' && stage.parsedOutput && (
                  <div className="px-4 py-3 bg-white border-t border-gray-100">
                    <pre className="text-[10px] text-gray-700 whitespace-pre-wrap break-all max-h-80 overflow-auto font-mono bg-gray-50 rounded p-3">
                      {JSON.stringify(stage.parsedOutput, null, 2).slice(0, 8000)}
                    </pre>
                  </div>
                )}
                {activeSection === 'metadata' && stage.metadata && (
                  <div className="px-4 py-3 bg-white border-t border-gray-100">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(stage.metadata).map(([k, v]) => (
                        <div key={k} className="bg-gray-50 rounded px-3 py-2">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider">{k.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-gray-800 font-medium mt-0.5">{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activeSection === 'artifact' && stage.artifactUrl && (
                  <div className="px-4 py-3 bg-white border-t border-gray-100">
                    <p className="text-[10px] text-gray-500 mb-2 break-all font-mono">{stage.artifactUrl}</p>
                    {(stage.artifactUrl.includes('.png') || stage.artifactUrl.includes('.jpg') || stage.artifactUrl.includes('.webp') || stage.artifactUrl.includes('s3.') || stage.artifactUrl.includes('r2.')) && (
                      <div className="w-64 h-64 relative rounded-lg overflow-hidden bg-gray-100">
                        <NextImage src={stage.artifactUrl} alt={`Artifact from ${stage.agentName}`} fill className="object-contain" unoptimized />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ═══════════════════════════════════════════════════════════════
// Tab: Credits
// ═══════════════════════════════════════════════════════════════

interface CreditAccountRow {
  id: string;
  businessId: string;
  creditBalance: number;
  monthlyAllowance: number;
  creditPlanName: string;
  creditStatus: string;
  accountClosedAt: string | null;
  updatedAt: string;
  business: { businessName: string | null; websiteUrl: string } | null;
}

interface CreditLotRow {
  id: string;
  creditType: string;
  originalAmount: number;
  remainingAmount: number;
  expiresAt: string | null;
  closureExpiresAt: string | null;
  createdAt: string;
}

interface CreditTxRow {
  id: string;
  transactionType: string;
  amount: number;
  reason: string | null;
  balanceAfter: number | null;
  createdAt: string;
}

function CreditsTab() {
  const [accounts, setAccounts] = useState<CreditAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBizId, setSelectedBizId] = useState<string | null>(null);
  const [lots, setLots] = useState<CreditLotRow[]>([]);
  const [txns, setTxns] = useState<CreditTxRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView] = useState<'lots' | 'transactions' | 'costs'>('lots');
  const [costEntries, setCostEntries] = useState<any[]>([]);

  // Load accounts
  useEffect(() => {
    fetch('/api/admin/credits/ledger?view=credits&limit=100')
      .then(r => r.json())
      .then(d => setAccounts(d.accounts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load detail when business selected
  useEffect(() => {
    if (!selectedBizId) return;
    setDetailLoading(true);
    const loadDetail = async () => {
      try {
        const [lotsRes, ledgerRes, costRes] = await Promise.all([
          fetch(`/api/admin/credits/lots?businessId=${selectedBizId}&includeEmpty=true`),
          fetch(`/api/admin/credits/ledger?businessId=${selectedBizId}&view=credits&limit=100`),
          fetch(`/api/admin/credits/ledger?view=costs&limit=100`),
        ]);
        if (lotsRes.ok) { const d = await lotsRes.json(); setLots(d.lots || []); }
        if (ledgerRes.ok) { const d = await ledgerRes.json(); setTxns(d.transactions || []); }
        if (costRes.ok) { const d = await costRes.json(); setCostEntries(d.entries || []); }
      } catch { /* silent */ }
      setDetailLoading(false);
    };
    loadDetail();
  }, [selectedBizId]);

  const handleExpireNow = async () => {
    if (!selectedBizId) return;
    if (!confirm('Force-expire all eligible credit lots for this business?')) return;
    const res = await fetch('/api/admin/credits/expire-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: selectedBizId }),
    });
    const d = await res.json();
    alert(`Expired ${d.expiredCount ?? 0} lots, ${d.totalCreditsExpired ?? 0} credits`);
    // Reload lots
    const lr = await fetch(`/api/admin/credits/lots?businessId=${selectedBizId}&includeEmpty=true`);
    if (lr.ok) { const ld = await lr.json(); setLots(ld.lots || []); }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Accounts list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Credit Accounts ({accounts.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-500">Business</th>
              <th className="px-4 py-3 font-medium text-gray-500">Balance</th>
              <th className="px-4 py-3 font-medium text-gray-500">Plan</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 font-medium text-gray-500">Updated</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr
                key={a.id}
                onClick={() => setSelectedBizId(a.businessId)}
                className={`border-t border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors ${
                  selectedBizId === a.businessId ? 'bg-blue-50' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{a.business?.businessName || 'Unnamed'}</p>
                  <p className="text-xs text-gray-400 truncate max-w-[200px]">{a.business?.websiteUrl}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`font-bold ${a.creditBalance <= 0 ? 'text-red-600' : 'text-blue-700'}`}>
                    {a.creditBalance}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 capitalize">{a.creditPlanName} ({a.monthlyAllowance}/mo)</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                    a.creditStatus === 'active' ? 'bg-green-100 text-green-700' :
                    a.creditStatus === 'canceled' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{a.creditStatus}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{new Date(a.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No credit accounts</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail view */}
      {selectedBizId && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">
                {accounts.find(a => a.businessId === selectedBizId)?.business?.businessName || 'Detail'}
              </h3>
              <div className="flex gap-1 ml-4">
                {(['lots', 'transactions', 'costs'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                      view === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {v === 'lots' ? 'Credit Lots' : v === 'transactions' ? 'Transactions' : 'Cost Ledger'}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleExpireNow}
              className="px-3 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
            >
              Force Expire
            </button>
          </div>

          {detailLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 text-blue-600 animate-spin" /></div>
          ) : view === 'lots' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Original</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Remaining</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Expires</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Closure Exp</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(lot => {
                    const effectiveExpiry = lot.closureExpiresAt || lot.expiresAt;
                    const isExpired = effectiveExpiry && new Date(effectiveExpiry) < new Date();
                    return (
                      <tr key={lot.id} className={`border-t border-gray-100 ${isExpired ? 'opacity-50' : ''} ${lot.remainingAmount <= 0 ? 'bg-gray-50' : ''}`}>
                        <td className="px-4 py-3 capitalize">{lot.creditType.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-gray-700">{lot.originalAmount}</td>
                        <td className="px-4 py-3">
                          <span className={`font-semibold ${lot.remainingAmount <= 0 ? 'text-gray-400' : 'text-blue-700'}`}>
                            {lot.remainingAmount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {lot.closureExpiresAt ? new Date(lot.closureExpiresAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{new Date(lot.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                  {lots.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No credit lots</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : view === 'transactions' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Amount</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Reason</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map(tx => (
                    <tr key={tx.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(tx.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 capitalize">{tx.transactionType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[250px]">{tx.reason || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{tx.balanceAfter ?? '—'}</td>
                    </tr>
                  ))}
                  {txns.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No transactions</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Provider</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Operation</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Cost ($)</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Business</th>
                  </tr>
                </thead>
                <tbody>
                  {costEntries.map((e: any, i: number) => (
                    <tr key={e.id || i} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-700">{e.provider || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{e.operation || '—'}</td>
                      <td className="px-4 py-3 font-mono text-gray-700">${(e.costUsd ?? 0).toFixed(4)}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 truncate max-w-[150px]">{e.businessId?.slice(0, 8) || '—'}</td>
                    </tr>
                  ))}
                  {costEntries.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No cost entries</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
