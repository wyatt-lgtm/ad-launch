'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useActiveBusiness } from '@/hooks/use-active-business';
import {
  Loader2, TrendingUp, TrendingDown, DollarSign, Eye,
  MousePointer, Target, BarChart3, RefreshCw, AlertCircle,
  ArrowUpRight, ArrowDownRight, Minus, Activity,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';

/* ── Types ─────────────────────────────────────────────────────────── */

interface KPIs {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  conversion_rate: number;
  roas: number;
}

interface ChannelRow {
  channel: string;
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface ConnectionInfo {
  platform: string;
  status: string;
  last_sync: string | null;
}

interface OverviewData {
  _no_tombstone_id?: boolean;
  date_range: { start: string; end: string };
  kpis: KPIs;
  channels: ChannelRow[];
  connections: ConnectionInfo[];
  last_sync: { id: number; status: string; started_at: string | null; completed_at: string | null } | null;
}

interface MonthlyTrend {
  month: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface PeriodAgg {
  start: string;
  end: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface TrendsData {
  date_range: { start: string; end: string };
  monthly_trend: MonthlyTrend[];
  comparison: {
    mode: string;
    current_period: PeriodAgg;
    previous_period: PeriodAgg;
    deltas_pct: Record<string, number>;
  } | null;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtCurrency = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

function DeltaBadge({ value }: { value: number | undefined }) {
  if (value === undefined || value === null) return null;
  const isUp = value > 0;
  const isDown = value < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
      isUp ? 'text-green-600' : isDown ? 'text-red-600' : 'text-gray-400'
    }`}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : isDown ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ── Date helpers ──────────────────────────────────────────────────── */

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/* ── Main Component ────────────────────────────────────────────────── */

export default function MarketingDashboard() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const { activeBusiness, loading: bizLoading, noBusiness, needsSelection } = useActiveBusiness();

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'previous_7_days' | 'previous_14_days'>('previous_7_days');
  const [dateRange, setDateRange] = useState({ start: daysAgo(30), end: daysAgo(0) });

  // Redirect unauthenticated
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!activeBusiness?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, trendsRes] = await Promise.all([
        fetch(`/api/dashboard/marketing?action=overview&business_id=${activeBusiness.id}&date_start=${dateRange.start}&date_end=${dateRange.end}`),
        fetch(`/api/dashboard/marketing?action=trends&business_id=${activeBusiness.id}&date_start=${dateRange.start}&date_end=${dateRange.end}&compare_mode=${compareMode}`),
      ]);
      const overviewData = await overviewRes.json();
      const trendsData = await trendsRes.json();
      if (overviewRes.ok) setOverview(overviewData);
      else setError(overviewData.error || 'Failed to load overview');
      if (trendsRes.ok) setTrends(trendsData);
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
    setLoading(false);
  }, [activeBusiness?.id, dateRange, compareMode]);

  useEffect(() => {
    if (activeBusiness?.id) fetchData();
  }, [activeBusiness?.id, fetchData]);

  // Sync trigger
  const handleSync = async () => {
    if (!activeBusiness?.id || syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/dashboard/marketing?action=sync&business_id=${activeBusiness.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        // Refetch after sync
        await fetchData();
      }
    } catch (err) {
      console.error('Sync error:', err);
    }
    setSyncing(false);
  };

  /* ── Loading / Guard states ──────────────────────────────────────── */

  if (sessionStatus === 'loading' || bizLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (noBusiness) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">No Business Found</h2>
        <p className="text-gray-500">Add a business from the Dashboard to start tracking marketing performance.</p>
      </div>
    );
  }

  if (needsSelection) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Select a Business</h2>
        <p className="text-gray-500">Choose a business from the selector to view marketing data.</p>
      </div>
    );
  }

  const isEmpty = !overview || overview._no_tombstone_id || (overview.kpis.impressions === 0 && overview.kpis.spend === 0);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unified Marketing</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeBusiness?.businessName || activeBusiness?.businessDomain || 'Business'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date range */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="text-sm border-none outline-none bg-transparent text-gray-700"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="text-sm border-none outline-none bg-transparent text-gray-700"
            />
          </div>
          {/* Sync */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Data'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Error loading marketing data</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : isEmpty ? (
        /* Empty state */
        <div className="text-center py-16">
          <BarChart3 className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Marketing Data Yet</h2>
          <p className="text-gray-500 max-w-md mx-auto mb-6">
            Connect your Google Ads account and sync data to start seeing unified marketing performance metrics.
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 inline mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Run Initial Sync'}
          </button>

          {/* Sync status */}
          {overview?.last_sync && (
            <div className="mt-6 inline-flex items-center gap-2 text-xs text-gray-500">
              <span>Last sync: {overview.last_sync.status}</span>
              {overview.last_sync.completed_at && (
                <span>• {new Date(overview.last_sync.completed_at).toLocaleString('en-US', { timeZone: 'UTC' })}</span>
              )}
            </div>
          )}

          {/* Connection status */}
          {overview?.connections && overview.connections.length > 0 && (
            <div className="mt-4 flex justify-center gap-3">
              {overview.connections.map((c, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                    c.status === 'active' ? 'bg-green-50 text-green-700' :
                    c.status === 'error' ? 'bg-red-50 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    c.status === 'active' ? 'bg-green-500' :
                    c.status === 'error' ? 'bg-red-500' :
                    'bg-gray-400'
                  }`} />
                  {c.platform.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── Data Present ──────────────────────────────────────────── */
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            <KPICard icon={Eye} label="Impressions" value={fmt(overview!.kpis.impressions)} delta={trends?.comparison?.deltas_pct?.impressions} />
            <KPICard icon={MousePointer} label="Clicks" value={fmt(overview!.kpis.clicks)} delta={trends?.comparison?.deltas_pct?.clicks} />
            <KPICard icon={DollarSign} label="Spend" value={fmtCurrency(overview!.kpis.spend)} delta={trends?.comparison?.deltas_pct?.spend} invertDelta />
            <KPICard icon={Target} label="Conversions" value={fmt(overview!.kpis.conversions)} delta={trends?.comparison?.deltas_pct?.conversions} />
            <KPICard icon={TrendingUp} label="Revenue" value={fmtCurrency(overview!.kpis.revenue)} delta={trends?.comparison?.deltas_pct?.revenue} />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <MiniKPI label="CTR" value={fmtPct(overview!.kpis.ctr)} />
            <MiniKPI label="Avg CPC" value={fmtCurrency(overview!.kpis.cpc)} />
            <MiniKPI label="Conv Rate" value={fmtPct(overview!.kpis.conversion_rate)} />
            <MiniKPI label="ROAS" value={`${overview!.kpis.roas.toFixed(2)}x`} />
          </div>

          {/* Trend Chart */}
          {trends && trends.monthly_trend.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Monthly Trend</h3>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends.monthly_trend.map(m => ({
                    ...m,
                    label: new Date(m.month + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
                  }))}>
                    <defs>
                      <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#888' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#888' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        name === 'spend' || name === 'revenue' ? fmtCurrency(value) : fmt(value),
                        name.charAt(0).toUpperCase() + name.slice(1)
                      ]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="spend" stroke="#3b82f6" fill="url(#colorSpend)" strokeWidth={2} name="Spend" />
                    <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#colorRevenue)" strokeWidth={2} name="Revenue" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Comparison Cards */}
          {trends?.comparison && (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Period Comparison</h3>
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setCompareMode('previous_7_days')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      compareMode === 'previous_7_days'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setCompareMode('previous_14_days')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      compareMode === 'previous_14_days'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    14 Days
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ComparisonCard
                  label="Current Period"
                  period={trends.comparison.current_period}
                  isPrimary
                />
                <ComparisonCard
                  label="Previous Period"
                  period={trends.comparison.previous_period}
                />
              </div>
            </div>
          )}

          {/* Channel Performance Table */}
          {overview!.channels.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Channel Performance</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Channel</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Impressions</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Clicks</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Spend</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Conversions</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {overview!.channels.map((ch, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 text-gray-900 font-medium">{ch.channel.replace('_', ' ')}</td>
                        <td className="px-6 py-3 text-gray-600">{ch.platform.replace('_', ' ')}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{fmt(ch.impressions)}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{fmt(ch.clicks)}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{fmtCurrency(ch.spend)}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{fmt(ch.conversions)}</td>
                        <td className="px-6 py-3 text-right text-gray-700">{fmtCurrency(ch.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sync Status Footer */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            {overview?.last_sync && (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3" />
                Last sync: {overview.last_sync.status}
                {overview.last_sync.completed_at && (
                  <> • {new Date(overview.last_sync.completed_at).toLocaleString('en-US', { timeZone: 'UTC' })}</>
                )}
              </span>
            )}
            {overview?.connections && overview.connections.length > 0 && (
              <div className="flex items-center gap-2">
                {overview.connections.map((c, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                      c.status === 'active' ? 'bg-green-50 text-green-700' :
                      c.status === 'error' ? 'bg-red-50 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      c.status === 'active' ? 'bg-green-500' :
                      c.status === 'error' ? 'bg-red-500' :
                      'bg-gray-400'
                    }`} />
                    {c.platform.replace('_', ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function KPICard({ icon: Icon, label, value, delta, invertDelta }: {
  icon: React.ElementType;
  label: string;
  value: string;
  delta?: number;
  invertDelta?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-gray-400" />
        {delta !== undefined && (
          <DeltaBadge value={invertDelta ? -delta : delta} />
        )}
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function MiniKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function ComparisonCard({ label, period, isPrimary }: {
  label: string;
  period: PeriodAgg;
  isPrimary?: boolean;
}) {
  return (
    <div className={`border rounded-xl p-5 ${
      isPrimary ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</h4>
        <span className="text-xs text-gray-400">
          {period.start} → {period.end}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-gray-500">Spend</p>
          <p className="text-sm font-semibold text-gray-900">{fmtCurrency(period.spend)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Clicks</p>
          <p className="text-sm font-semibold text-gray-900">{fmt(period.clicks)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-sm font-semibold text-gray-900">{fmtCurrency(period.revenue)}</p>
        </div>
      </div>
    </div>
  );
}
