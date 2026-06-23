'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Cpu, AlertTriangle, Clock, DollarSign,
  RefreshCw, Loader2, Zap, Image as ImageIcon, MessageSquare,
  ChevronDown, ChevronUp, Filter, TrendingUp,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface UsageTotals {
  total_calls: number;
  success_calls: number;
  error_calls: number;
  timeout_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_estimated_cost_usd: number;
  avg_latency_ms: number;
  last_call_at: string | null;
  note?: string;
}

interface BreakdownRow {
  calls: number;
  errors?: number;
  cost_usd: number;
  avg_latency_ms?: number;
  tokens?: number;
  [key: string]: any;
}

interface ErrorRow {
  created_at: string;
  agent_name: string;
  worker_name: string;
  call_site: string;
  model: string;
  request_type: string;
  status: string;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  latency_ms: number;
  openai_request_id: string | null;
  task_id: number | null;
}

interface DailyTrend {
  day: string;
  calls: number;
  errors: number;
  cost_usd: number;
}

interface UsageData {
  totals: UsageTotals;
  by_worker: BreakdownRow[];
  by_agent: BreakdownRow[];
  by_model: BreakdownRow[];
  by_request_type: BreakdownRow[];
  top_call_sites: BreakdownRow[];
  daily_trend: DailyTrend[];
  recent_errors: ErrorRow[];
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function fmt$(n: number) {
  return '$' + n.toFixed(4);
}

function fmtMs(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 's';
  return Math.round(n) + 'ms';
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Denver',
    });
  } catch { return iso; }
}

// Simple bar for trend visualization
function MiniBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function OpenAIUsageTab() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [agentFilter, setAgentFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (agentFilter) params.set('agent_name', agentFilter);
      if (modelFilter) params.set('model', modelFilter);
      if (typeFilter) params.set('request_type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const res = await fetch(`/api/admin/openai-usage${qs ? '?' + qs : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, modelFilter, typeFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading OpenAI usage data…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 font-medium">Failed to load usage data</p>
        <p className="text-sm text-gray-500 mt-1">{error}</p>
        <button onClick={fetchData} className="mt-3 text-sm text-blue-600 hover:underline">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;
  const maxDailyCalls = Math.max(...(data.daily_trend.map(d => d.calls)), 1);
  const errorRate = t.total_calls > 0 ? ((t.error_calls + t.timeout_calls) / t.total_calls * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">OpenAI API Usage</h2>
          <p className="text-sm text-gray-500">
            {t.last_call_at ? `Last call: ${fmtDate(t.last_call_at)}` : 'No data yet — waiting for first instrumented call'}
            {t.note && <span className="ml-2 text-amber-600">({t.note})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Agent</label>
              <select
                value={agentFilter}
                onChange={e => setAgentFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">All agents</option>
                {data.by_agent.map(a => (
                  <option key={a.agent_name} value={a.agent_name}>{a.agent_name} ({a.calls})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
              <select
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">All models</option>
                {data.by_model.map(m => (
                  <option key={m.model} value={m.model}>{m.model} ({m.calls})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">All types</option>
                <option value="text">Text</option>
                <option value="image">Image</option>
                <option value="embedding">Embedding</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="timeout">Timeout</option>
              </select>
            </div>
          </div>
          {(agentFilter || modelFilter || typeFilter || statusFilter) && (
            <button
              onClick={() => { setAgentFilter(''); setModelFilter(''); setTypeFilter(''); setStatusFilter(''); }}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Calls" value={fmtNum(t.total_calls)} icon={Zap} color="blue" />
        <KpiCard label="Errors" value={fmtNum(t.error_calls + t.timeout_calls)} icon={AlertTriangle}
          color={errorRate > 5 ? 'red' : 'amber'}
          sub={t.total_calls > 0 ? `${errorRate.toFixed(1)}%` : undefined} />
        <KpiCard label="Est. Cost" value={t.total_estimated_cost_usd >= 1 ? `$${t.total_estimated_cost_usd.toFixed(2)}` : fmt$(t.total_estimated_cost_usd)}
          icon={DollarSign} color="green" />
        <KpiCard label="Avg Latency" value={fmtMs(t.avg_latency_ms)} icon={Clock} color="purple" />
        <KpiCard label="Tokens" value={fmtNum(t.total_tokens)} icon={MessageSquare} color="gray" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Worker */}
        <BreakdownCard title="By Worker" labelKey="worker_name" rows={data.by_worker} />
        {/* By Agent */}
        <BreakdownCard title="By Agent" labelKey="agent_name" rows={data.by_agent} />
        {/* By Model */}
        <BreakdownCard title="By Model" labelKey="model" rows={data.by_model} />
        {/* By Type */}
        <BreakdownCard title="By Request Type" labelKey="request_type" rows={data.by_request_type} />
      </div>

      {/* Daily Trend */}
      {data.daily_trend.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> Daily Trend (Last 30 Days)
          </h3>
          <div className="space-y-1.5">
            {data.daily_trend.slice().reverse().map(d => (
              <div key={d.day} className="flex items-center gap-3 text-xs">
                <span className="w-16 text-gray-500 font-mono">{d.day.slice(5)}</span>
                <div className="flex-1">
                  <MiniBar value={d.calls} max={maxDailyCalls} />
                </div>
                <span className="w-12 text-right text-gray-700 font-medium">{d.calls}</span>
                {d.errors > 0 && <span className="w-10 text-right text-red-500">{d.errors} err</span>}
                <span className="w-16 text-right text-gray-400">{fmt$(d.cost_usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Call Sites */}
      {data.top_call_sites.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" /> Top Call Sites
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-left py-1.5 pr-4 font-medium">Call Site</th>
                  <th className="text-right py-1.5 px-2 font-medium">Calls</th>
                  <th className="text-right py-1.5 px-2 font-medium">Cost</th>
                  <th className="text-right py-1.5 pl-2 font-medium">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.top_call_sites.map((cs, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-4 font-mono text-gray-700">{cs.call_site}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{cs.calls}</td>
                    <td className="py-1.5 px-2 text-right text-gray-500">{fmt$(cs.cost_usd)}</td>
                    <td className="py-1.5 pl-2 text-right text-gray-400">{fmtMs(cs.avg_latency_ms || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Errors */}
      {data.recent_errors.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Recent Errors ({data.recent_errors.length})
            </h3>
            {showErrors ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showErrors && (
            <div className="mt-3 space-y-2">
              {data.recent_errors.map((e, i) => (
                <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-red-700">
                      {e.agent_name} → {e.status} {e.http_status ? `(HTTP ${e.http_status})` : ''}
                    </span>
                    <span className="text-red-400">{fmtDate(e.created_at)}</span>
                  </div>
                  <div className="text-red-600 font-mono">
                    {e.error_type}: {e.error_message?.slice(0, 200)}
                  </div>
                  <div className="flex gap-4 mt-1 text-red-400">
                    <span>Model: {e.model}</span>
                    <span>Latency: {fmtMs(e.latency_ms)}</span>
                    {e.task_id && <span>Task #{e.task_id}</span>}
                    {e.openai_request_id && <span>ReqID: {e.openai_request_id.slice(0, 16)}…</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

function KpiCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: any; color: string; sub?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    gray: 'bg-gray-50 text-gray-600',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colorMap[color] || colorMap.gray}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownCard({ title, labelKey, rows }: {
  title: string; labelKey: string; rows: BreakdownRow[];
}) {
  if (!rows.length) return null;
  const maxCalls = Math.max(...rows.map(r => r.calls), 1);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700 truncate">{r[labelKey] || '(unknown)'}</span>
              <div className="flex items-center gap-3 text-gray-500">
                <span>{r.calls} calls</span>
                {(r.errors ?? 0) > 0 && <span className="text-red-500">{r.errors} err</span>}
                <span>{fmt$(r.cost_usd)}</span>
              </div>
            </div>
            <MiniBar value={r.calls} max={maxCalls} />
          </div>
        ))}
      </div>
    </div>
  );
}
