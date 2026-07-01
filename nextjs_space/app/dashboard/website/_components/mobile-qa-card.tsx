'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Smartphone, RefreshCw, Play, Lock, AlertTriangle, CheckCircle2,
  XCircle, ChevronDown, ChevronRight, Gauge, ListChecks,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Milestone 7 — Mobile / responsive QA panel.
 *
 * Runs a read-only mobile QA inspection against the latest ready-for-preview
 * static build (re-rendered from the approved blueprint). Shows gate state,
 * status, score, pass/fail, checked/failed routes, warnings, critical
 * failures, top issues, route-by-route checks and viewport results.
 * Deployment stays DISABLED — the only future deploy control is disabled and
 * labelled "Deployment disabled — dry run only".
 */

interface QaRow {
  id: string; siteBuildId: string; status: string; score: number | null;
  passed: boolean; checkedRoutesCount: number; failedRoutesCount: number;
  warningCount: number; createdAt: string; updatedAt: string;
}
interface BuildRow {
  id: string; buildStatus: string; buildNumber: number;
  sourceRef: string | null; completedAt: string | null; createdAt: string;
}
interface ListData {
  deploymentDisabledNotice: string;
  qaTargetBuild: BuildRow | null;
  builds: BuildRow[];
  latestQa: QaRow | null;
  qaResults: QaRow[];
}
interface RouteCheck { check: string; status: string; severity: string; message: string; }
interface RouteScores { layout: number; readability: number; tapTargets: number; images: number; navigation: number; forms: number; }
interface RouteReport { path: string; status: string; scores: RouteScores; checks: RouteCheck[]; screenshots: { viewport: string; artifactRef: string }[]; }
interface QaViewport { id: string; label: string; width: number; height: number; }
interface FullReport {
  status: string; score: number; passed: boolean; checkedAt: string;
  viewports: QaViewport[]; routes: RouteReport[];
  summary: {
    checkedRoutesCount: number; failedRoutesCount: number; warningCount: number;
    criticalFailures: string[]; warnings: string[]; topIssues: string[];
  };
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    passed: 'bg-green-100 text-green-800 border-green-200',
    failed: 'bg-red-100 text-red-800 border-red-200',
    blocked: 'bg-amber-100 text-amber-800 border-amber-200',
    running: 'bg-blue-100 text-blue-800 border-blue-200',
    pending: 'bg-gray-100 text-gray-700 border-gray-200',
    error: 'bg-red-100 text-red-800 border-red-200',
  };
  return map[status] || 'bg-gray-100 text-gray-700 border-gray-200';
}

function checkIcon(status: string) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
}

export default function MobileQaCard() {
  const { activeBusiness } = useActiveBusiness();
  const businessId = activeBusiness?.id || null;
  const [data, setData] = useState<ListData | null>(null);
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ code: string; message: string }[] | null>(null);
  const [openRoutes, setOpenRoutes] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/mobile-qa`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Failed (${res.status})`);
      const body: ListData = await res.json();
      setData(body);
      // Auto-load the latest QA full report if present.
      if (body.latestQa) {
        const r = await fetch(`/api/businesses/${businessId}/website/mobile-qa/${body.latestQa.id}`, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j?.qa?.qaJson && j.qa.status !== 'blocked') setReport(j.qa.qaJson as FullReport);
          else setReport(null);
        }
      } else {
        setReport(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const runQa = useCallback(async () => {
    if (!businessId) return;
    setRunning(true); setError(null); setBlocked(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/mobile-qa/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body?.blocked) {
        setBlocked(body?.gate?.blocking || [{ code: 'blocked', message: body?.error || 'Blocked by the QA gate.' }]);
        setReport(null);
      } else if (!res.ok) {
        throw new Error(body?.error || `QA failed (${res.status})`);
      } else if (body?.report) {
        setReport(body.report as FullReport);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || 'QA failed');
    } finally {
      setRunning(false);
    }
  }, [businessId, load]);

  if (!businessId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Select a business to run mobile QA.</p>
      </div>
    );
  }

  const target = data?.qaTargetBuild;
  const latest = data?.latestQa;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
            <Smartphone className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Mobile &amp; Responsive QA</h3>
            <p className="text-xs text-gray-500">Read-only inspection of the static preview package. No deploy.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={runQa}
            disabled={running || !target}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Play className={`h-4 w-4 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Running…' : 'Run mobile QA'}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {/* QA target build */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">QA target build</div>
          {target ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
              <span>Build #{target.buildNumber}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                {target.buildStatus}
              </span>
              <span className="font-mono text-xs text-gray-400">{target.id}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-500">No ready-for-preview build yet. Generate a static build first.</p>
          )}
        </div>

        {/* Blocked reasons */}
        {blocked && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <Lock className="h-4 w-4" /> Mobile QA gate blocked this run
            </div>
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {blocked.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5">•</span>
                  <span><span className="font-mono text-xs">{b.code}</span> — {b.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Latest QA summary */}
        {latest && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-xs text-gray-500">Status</div>
              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusBadge(latest.status)}`}>
                {latest.status}
              </span>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center gap-1 text-xs text-gray-500"><Gauge className="h-3 w-3" /> Score</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{latest.score ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-xs text-gray-500">Routes checked</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{latest.checkedRoutesCount}</div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-xs text-gray-500">Failed routes</div>
              <div className={`mt-1 text-lg font-semibold ${latest.failedRoutesCount ? 'text-red-600' : 'text-gray-900'}`}>{latest.failedRoutesCount}</div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="text-xs text-gray-500">Warnings</div>
              <div className={`mt-1 text-lg font-semibold ${latest.warningCount ? 'text-amber-600' : 'text-gray-900'}`}>{latest.warningCount}</div>
            </div>
          </div>
        )}

        {/* Full report */}
        {report && (
          <div className="space-y-4">
            {/* Viewports */}
            <div className="flex flex-wrap gap-2">
              {report.viewports.map((v) => (
                <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600">
                  {v.label} · {v.width}×{v.height}
                </span>
              ))}
            </div>

            {/* Critical failures */}
            {report.summary.criticalFailures.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                  <XCircle className="h-4 w-4" /> Critical failures ({report.summary.criticalFailures.length})
                </div>
                <ul className="mt-2 space-y-1 text-sm text-red-700">
                  {report.summary.criticalFailures.map((c, i) => (<li key={i}>• {c}</li>))}
                </ul>
              </div>
            )}

            {/* Top issues */}
            {report.summary.topIssues.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <ListChecks className="h-4 w-4" /> Top issues
                </div>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {report.summary.topIssues.map((c, i) => (<li key={i}>• {c}</li>))}
                </ul>
              </div>
            )}

            {/* Route-by-route */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Routes</div>
              {report.routes.map((r) => {
                const open = openRoutes[r.path];
                return (
                  <div key={r.path} className="rounded-lg border border-gray-100">
                    <button
                      onClick={() => setOpenRoutes((s) => ({ ...s, [r.path]: !s[r.path] }))}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left"
                    >
                      <span className="flex items-center gap-2">
                        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        {checkIcon(r.status === 'pass' ? 'pass' : r.status === 'warn' ? 'warn' : 'fail')}
                        <span className="font-mono text-sm text-gray-800">{r.path}</span>
                      </span>
                      <span className="text-xs text-gray-500">
                        L{r.scores.layout} · R{r.scores.readability} · T{r.scores.tapTargets} · I{r.scores.images} · N{r.scores.navigation} · F{r.scores.forms}
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-1.5 border-t border-gray-100 p-3">
                        {r.checks.map((c, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            {checkIcon(c.status)}
                            <span className="text-gray-600">
                              <span className="font-mono text-xs text-gray-400">{c.check}</span> — {c.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Next actions + disabled deploy notice */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="text-xs text-gray-500">
            {report?.passed
              ? 'Mobile QA passed — ready for future deployment approval.'
              : 'Fix flagged layout issues, then rerun mobile QA.'}
          </div>
          <button
            disabled
            title="Deployment disabled — dry run only"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-400"
          >
            <Lock className="h-4 w-4" /> Static build + deploy — Deployment disabled — dry run only
          </button>
        </div>
      </div>
    </div>
  );
}
