'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Brain, Zap, Search, RefreshCw, Lock, CheckCircle2, Clock,
  AlertTriangle, PlayCircle,
} from 'lucide-react';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmt(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  } catch {
    return '—';
  }
}

const STATUS_TONE: Record<string, string> = {
  complete: 'bg-green-100 text-green-800',
  completed: 'bg-green-100 text-green-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  not_started: 'bg-gray-100 text-gray-500',
  idle: 'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status?: string | null }) {
  const tone = STATUS_TONE[(status || 'not_started').toLowerCase()] || 'bg-gray-100 text-gray-500';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${tone}`}>{LABEL(status || 'not_started')}</span>;
}

export default function BusinessIntelligencePanel({
  businessId,
  businessName,
  showToast,
}: {
  businessId: string;
  businessName?: string;
  showToast?: (ok: boolean, msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toast = (ok: boolean, msg: string) => { if (showToast) showToast(ok, msg); };

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/research/status`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('[business-intelligence] load error', e);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { if (businessId) load(); }, [businessId, load]);

  const run = async (path: string, key: string, okMsg: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/businesses/${businessId}/${path}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Request failed');
      toast(true, okMsg);
      await load();
    } catch (e: any) {
      toast(false, e.message || 'Request failed');
    }
    setBusy(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 bg-white border border-gray-200 rounded-xl">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  const light = data?.light || {};
  const deep = data?.deep || {};
  const ongoing = data?.ongoing || {};
  const canDeep = !!deep?.canRun;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Light Research */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-gray-900">Light Research</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Fast, shallow scan that powers your first preview posts. Runs before full registration.
        </p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <StatusBadge status={light?.status} />
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-500">Last run</span>
          <span className="text-gray-700">{fmt(light?.lastRunAt)}</span>
        </div>
      </div>

      {/* Deep Research */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold text-gray-900">Deep Business Intelligence</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Full crawl, competitor analysis, pixel detection, social voice & positioning. Runs after you claim your business.
        </p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <StatusBadge status={deep?.status} />
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-500">Last run</span>
          <span className="text-gray-700">{fmt(deep?.lastRunAt)}</span>
        </div>
        <div className="mt-4">
          {canDeep ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => run('research/deep/run', 'deep', 'Deep research queued')}
                disabled={!!busy}
                className="inline-flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
              >
                {busy === 'deep' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                Run Deep Research
              </button>
              <button
                onClick={() => run('research/deep/run', 'refresh', 'Business intelligence refresh queued')}
                disabled={!!busy}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'refresh' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Refresh
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <Lock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <span>{deep?.reason || 'Claim and register your business to unlock deep business intelligence.'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Ongoing Search Intelligence */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Search Intelligence</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Ongoing keyword, rank & competitor tracking via compliant data providers. Separate from preview generation.
        </p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Enabled</span>
          <span className="text-gray-700">
            {ongoing?.enabled ? (
              <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-4 h-4" /> Yes</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-gray-400"><AlertTriangle className="w-4 h-4" /> Off</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-500">Last run</span>
          <span className="text-gray-700">{fmt(ongoing?.lastRunAt)}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-500">Next run</span>
          <span className="text-gray-700 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-gray-400" /> {fmt(ongoing?.nextRunAt)}</span>
        </div>
        <div className="mt-4">
          <button
            onClick={() => run('search-intelligence/run', 'si', 'Search intelligence run queued')}
            disabled={!!busy}
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'si' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run Now
          </button>
        </div>
      </div>
    </div>
  );
}
