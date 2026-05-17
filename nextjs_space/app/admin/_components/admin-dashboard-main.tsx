'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Users, Activity, Key, Cpu, Search, Loader2,
  CheckCircle2, XCircle, Clock, AlertTriangle, Rss, RefreshCw,
  ChevronRight, Shield, Zap, FileText, Image as ImageIcon,
  MessageSquare, ArrowRight, ArrowLeft, Calendar, Eye, X,
} from 'lucide-react';
import NextImage from 'next/image';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type Tab = 'accounts' | 'usage' | 'resets' | 'agents' | 'tasks' | 'ads';

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
    { id: 'ads',      label: 'Ads',      icon: ImageIcon },
    { id: 'usage',    label: 'Usage',    icon: BarChart3 },
    { id: 'resets',   label: 'Resets',   icon: Key },
    { id: 'agents',   label: 'Agents',   icon: Cpu },
    { id: 'tasks',    label: 'Tasks',    icon: Activity },
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
            <StatCard label="Businesses" value={overview.businesses} icon={Zap} onClick={() => setTab('accounts')} />
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
        {tab === 'ads' && <AdsTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'resets' && <ResetsTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'tasks' && <TasksTab />}
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

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents');
      const data = await res.json();
      if (data.agents) {
        setAgents(data.agents);
        setLastFetch(data.fetchedAt || new Date().toISOString());
        setError('');
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
    alive_idle: { color: 'text-green-700', bg: 'bg-green-50 border-green-200', label: 'Idle', dot: 'bg-green-500' },
    alive_busy: { color: 'text-green-700', bg: 'bg-green-50 border-green-200', label: 'Busy', dot: 'bg-green-500 animate-pulse' },
    stale: { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Stale', dot: 'bg-amber-500' },
    offline: { color: 'text-red-700', bg: 'bg-red-50 border-red-200', label: 'Offline', dot: 'bg-red-500' },
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>;

  const alive = agents.filter(a => a.status === 'alive_idle' || a.status === 'alive_busy').length;
  const stale = agents.filter(a => a.status === 'stale').length;
  const offline = agents.filter(a => a.status === 'offline').length;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center gap-6 mb-6 text-sm">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> {alive} alive
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> {stale} stale
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> {offline} offline
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
          return (
            <div key={agent.name} className={`rounded-xl border p-4 ${cfg.bg}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={`text-sm font-semibold ${cfg.color}`}>{agent.display_name}</h3>
                <span className={`w-3 h-3 rounded-full ${cfg.dot}`} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">
                  Status: <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                </p>
                {agent.department && (
                  <p className="text-xs text-gray-500">Dept: {agent.department}</p>
                )}
                {agent.current_task_id && (
                  <p className="text-xs text-gray-500">
                    Task: <span className="font-mono text-gray-700">#{agent.current_task_id}</span>
                  </p>
                )}
                {agent.last_seen && (
                  <p className="text-xs text-gray-400">
                    Last seen: {formatTimeAgo(agent.last_seen)}
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

function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('in progress,ready for pickup,failed,blocked');
  const [hours, setHours] = useState(24);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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

  const statusColors: Record<string, string> = {
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

  const FILTER_PRESETS = [
    { label: 'Active', value: 'in progress,ready for pickup,blocked,claimed' },
    { label: 'Failed', value: 'failed,error' },
    { label: 'All', value: '' },
  ];

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
              {tasks.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-mono text-gray-700 text-xs">#{t.id}</td>
                  <td className="px-3 py-3 text-gray-700">{t.department || '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      statusColors[(t.status || '').toLowerCase()] || 'bg-gray-100 text-gray-500'
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
              {tasks.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No tasks match the current filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3 text-center">
        Showing {tasks.length} tasks • Auto-refreshing every 15 seconds
      </p>
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
