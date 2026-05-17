'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Users, Activity, Key, Cpu, Search, Loader2,
  CheckCircle2, XCircle, Clock, AlertTriangle, Rss, RefreshCw,
  ChevronRight, Shield, Zap, FileText, Image as ImageIcon,
  MessageSquare, ArrowRight,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type Tab = 'accounts' | 'usage' | 'resets' | 'agents' | 'tasks';

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
            <StatCard label="Users" value={overview.users.total} sub={`${overview.users.confirmed} confirmed`} icon={Users} />
            <StatCard label="Businesses" value={overview.businesses} icon={Zap} />
            <StatCard label="Analyses" value={overview.analyses.total} icon={FileText} />
            <StatCard label="Ads" value={overview.ads} icon={ImageIcon} />
            <StatCard label="Social Posts" value={overview.socialPosts.total} icon={MessageSquare} />
            <StatCard label="PW Resets" value={overview.passwordResets} icon={Key} />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'resets' && <ResetsTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'tasks' && <TasksTab />}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: number; sub?: string; icon: any }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
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
