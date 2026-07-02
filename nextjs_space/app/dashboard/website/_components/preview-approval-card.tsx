'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, Play, Lock, AlertTriangle, CheckCircle2,
  XCircle, ThumbsUp, ThumbsDown, ListChecks, FileText, Server, Smartphone,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Milestone 8 — Preview approval + deployment-readiness panel.
 *
 * Lets a user review the M6-generated static preview (validated by M7 mobile
 * QA), inspect every readiness signal, and approve/reject the preview for a
 * FUTURE, separately-gated deployment. This panel NEVER deploys, publishes,
 * launches, uploads, or changes DNS. The only forward control is a DISABLED
 * button labelled "Deployment disabled — future milestone".
 */

interface BuildRow {
  id: string; buildStatus: string; buildNumber: number;
  sourceRef: string | null; completedAt: string | null; createdAt: string;
}
interface ApprovalRow {
  id: string; siteBuildId: string; mobileQaId: string | null;
  deploymentTargetId: string | null; status: string;
  approvalNotes: string | null; rejectionReason: string | null;
  approvedByUserId: string | null; rejectedByUserId: string | null;
  approvedAt: string | null; rejectedAt: string | null;
  createdAt: string; updatedAt: string;
}
interface ListData {
  previewApprovalOnly: boolean;
  deploymentDisabledNotice: string;
  launchNotice: string;
  futureDeployNotice: string;
  approvalTargetBuild: BuildRow | null;
  builds: BuildRow[];
  latestApproval: ApprovalRow | null;
  approvals: ApprovalRow[];
}
interface ReadinessChecks {
  siteBuildReady: boolean; mobileQaPassed: boolean; routesGenerated: boolean;
  assetsPortable: boolean; noSignedUrls: boolean; noSecretsEmbedded: boolean;
  noHardcodedHostPaths: boolean; dryRunPlanAvailable: boolean;
  deploymentTargetConfigured: boolean; liveDeployDisabled: boolean;
}
interface ReadinessReport {
  businessId: string; siteBuildId: string | null; mobileQaId: string | null;
  deploymentTargetId: string | null; status: string;
  previewStatus: string; targetStatus: string;
  readyForFutureDeploy: boolean; deploymentDisabled: boolean; checkedAt: string;
  checks: ReadinessChecks;
  routes: { path: string; title: string | null; status: string }[];
  assets: { copied: number; missing: number; failed: number; warnings: string[] };
  mobileQa: { score: number | null; status: string; criticalFailures: number; warnings: number } | null;
  dryRunPlan: { targetType: string; mode: string; liveDeployEnabled: boolean; wouldUploadCount: number; wouldDeleteCount: number; warnings: string[] } | null;
  blockingReasons: { code: string; message: string }[];
  warnings: string[];
  approval: { approvedBy: string | null; approvedAt: string | null; notes: string | null } | null;
}

const CHECK_LABELS: { key: keyof ReadinessChecks; label: string }[] = [
  { key: 'siteBuildReady', label: 'Static build ready for preview' },
  { key: 'mobileQaPassed', label: 'Mobile QA passed (no critical failures)' },
  { key: 'routesGenerated', label: 'Routes generated' },
  { key: 'assetsPortable', label: 'Assets portable (no missing images)' },
  { key: 'noSignedUrls', label: 'No signed URLs embedded' },
  { key: 'noSecretsEmbedded', label: 'No secrets embedded' },
  { key: 'noHardcodedHostPaths', label: 'No hardcoded host/cPanel paths' },
  { key: 'dryRunPlanAvailable', label: 'Dry-run deployment plan available' },
  { key: 'deploymentTargetConfigured', label: 'Deployment target configured' },
  { key: 'liveDeployDisabled', label: 'Live deploy disabled (dry run only)' },
];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    approved_for_deployment_readiness: 'bg-green-100 text-green-800 border-green-200',
    approved_preview_only_target_incomplete: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    pending_review: 'bg-blue-100 text-blue-800 border-blue-200',
    blocked: 'bg-amber-100 text-amber-800 border-amber-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
    archived: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return map[status] || 'bg-gray-100 text-gray-700 border-gray-200';
}

function prettyStatus(s: string) {
  return s.replace(/_/g, ' ');
}

function targetBadge(status: string) {
  const map: Record<string, string> = {
    target_ready_for_future_deploy: 'bg-green-100 text-green-800 border-green-200',
    target_incomplete: 'bg-amber-100 text-amber-800 border-amber-200',
    target_not_configured: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return map[status] || 'bg-gray-100 text-gray-700 border-gray-200';
}

export default function PreviewApprovalCard() {
  const { activeBusiness } = useActiveBusiness();
  const businessId = activeBusiness?.id || null;
  const [data, setData] = useState<ListData | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [currentApprovalId, setCurrentApprovalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  const loadReport = useCallback(async (approvalId: string) => {
    if (!businessId) return;
    try {
      const r = await fetch(
        `/api/businesses/${businessId}/website/preview-approvals/${approvalId}/readiness-report`,
        { cache: 'no-store' },
      );
      if (r.ok) {
        const j = await r.json();
        setReport((j?.readinessReport as ReadinessReport) || null);
      } else {
        setReport(null);
      }
    } catch {
      setReport(null);
    }
  }, [businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/preview-approvals`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Failed (${res.status})`);
      const body: ListData = await res.json();
      setData(body);
      if (body.latestApproval) {
        setCurrentApprovalId(body.latestApproval.id);
        await loadReport(body.latestApproval.id);
      } else {
        setCurrentApprovalId(null);
        setReport(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId, loadReport]);

  useEffect(() => { load(); }, [load]);

  const evaluate = useCallback(async () => {
    if (!businessId) return;
    setEvaluating(true); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/preview-approvals/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 200) {
        throw new Error(body?.error || `Evaluation failed (${res.status})`);
      }
      if (body?.approvalId) setCurrentApprovalId(body.approvalId);
      if (body?.report) setReport(body.report as ReadinessReport);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }, [businessId, load]);

  const approve = useCallback(async () => {
    if (!businessId || !currentApprovalId) return;
    setActing(true); setError(null);
    try {
      const res = await fetch(
        `/api/businesses/${businessId}/website/preview-approvals/${currentApprovalId}/approve`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) },
      );
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body?.blocked) {
        setError('Approval blocked — the readiness gate did not pass. Review blocking reasons below.');
        if (body?.report) setReport(body.report as ReadinessReport);
      } else if (!res.ok) {
        throw new Error(body?.error || `Approval failed (${res.status})`);
      } else {
        setNotes('');
        if (body?.report) setReport(body.report as ReadinessReport);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || 'Approval failed');
    } finally {
      setActing(false);
    }
  }, [businessId, currentApprovalId, notes, load]);

  const reject = useCallback(async () => {
    if (!businessId || !currentApprovalId) return;
    if (!reason.trim()) { setError('Enter a rejection reason first.'); return; }
    setActing(true); setError(null);
    try {
      const res = await fetch(
        `/api/businesses/${businessId}/website/preview-approvals/${currentApprovalId}/reject`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Rejection failed (${res.status})`);
      setReason('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Rejection failed');
    } finally {
      setActing(false);
    }
  }, [businessId, currentApprovalId, reason, load]);

  if (!businessId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Select a business to review preview readiness.</p>
      </div>
    );
  }

  const target = data?.approvalTargetBuild;
  const latest = data?.latestApproval;
  const approved =
    latest?.status === 'approved_for_deployment_readiness' ||
    latest?.status === 'approved_preview_only_target_incomplete';

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50">
            <ClipboardCheck className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Preview Approval &amp; Deployment Readiness</h3>
            <p className="text-xs text-gray-500">Preview approval only. This does not publish or deploy the website.</p>
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
            onClick={evaluate}
            disabled={evaluating || !target}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Play className={`h-4 w-4 ${evaluating ? 'animate-pulse' : ''}`} /> {evaluating ? 'Reviewing...' : 'Review preview readiness'}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {/* Readiness-only banner */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-violet-50 p-3 text-xs font-medium text-violet-800">
          <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Deployment disabled — dry run only</span>
          <span className="text-violet-300">|</span>
          <span>This does not publish or deploy the website</span>
          <span className="text-violet-300">|</span>
          <span>Future deployment requires a separate approval step</span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {/* Linked build + status summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Linked static build</div>
            {target ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
                <span>Build #{target.buildNumber}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  {target.buildStatus}
                </span>
                <span className="font-mono text-xs text-gray-400">{target.id}</span>
              </div>
            ) : (
              <p className="mt-1 text-sm text-gray-500">No ready-for-preview build yet. Generate a static build first.</p>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <Smartphone className="h-3.5 w-3.5" />
              <span>Linked mobile QA: <span className="font-mono">{report?.mobileQaId || latest?.mobileQaId || 'none'}</span></span>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Preview readiness status</div>
            {latest ? (
              <div className="mt-1 space-y-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge(latest.status)}`}>
                  {prettyStatus(latest.status)}
                </span>
                {report && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${targetBadge(report.targetStatus)}`}>
                      {prettyStatus(report.targetStatus)}
                    </span>
                    {report.mobileQa && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Smartphone className="h-3.5 w-3.5" /> QA score {report.mobileQa.score ?? '—'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-gray-500">Not evaluated yet. Click “Review preview readiness”.</p>
            )}
          </div>
        </div>

        {/* Readiness checks */}
        {report && (
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <ListChecks className="h-4 w-4 text-gray-500" /> Readiness checks
            </div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {CHECK_LABELS.map(({ key, label }) => {
                const ok = report.checks[key];
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                    )}
                    <span className={ok ? 'text-gray-700' : 'text-gray-500'}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Blocking reasons */}
        {report && report.blockingReasons.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <Lock className="h-4 w-4" /> Blocking reasons
            </div>
            <ul className="mt-2 space-y-1">
              {report.blockingReasons.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><span className="font-mono text-xs text-amber-600">{b.code}</span> — {b.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {report && report.warnings.length > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Warnings</div>
            <ul className="mt-2 space-y-1">
              {report.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Generated routes + artifact/asset summary */}
        {report && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                <FileText className="h-4 w-4 text-gray-500" /> Generated routes ({report.routes.length})
              </div>
              <div className="space-y-1">
                {report.routes.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono text-xs text-gray-700">{r.path}</span>
                    <span className="text-xs text-gray-400">{r.title || r.status}</span>
                  </div>
                ))}
                {report.routes.length === 0 && <p className="text-sm text-gray-500">No routes recorded.</p>}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">
                Artifact manifest — assets copied {report.assets.copied}, missing {report.assets.missing}, failed {report.assets.failed}
              </div>
            </div>

            {/* Dry-run deployment plan */}
            <div className="rounded-lg border border-gray-100 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Server className="h-4 w-4 text-gray-500" /> Dry-run deployment plan
              </div>
              {report.dryRunPlan ? (
                <div className="space-y-1 text-sm text-gray-700">
                  <div>Target type: <span className="font-mono text-xs">{report.dryRunPlan.targetType}</span></div>
                  <div>Mode: <span className="font-mono text-xs">{report.dryRunPlan.mode}</span></div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <Lock className="h-3 w-3" /> liveDeployEnabled: {String(report.dryRunPlan.liveDeployEnabled)}
                  </div>
                  <div className="text-xs text-gray-500">Would upload {report.dryRunPlan.wouldUploadCount} file(s), would delete {report.dryRunPlan.wouldDeleteCount}.</div>
                  {report.dryRunPlan.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-700">• {w}</div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No dry-run plan available.</p>
              )}
            </div>
          </div>
        )}

        {/* Approval / rejection controls */}
        <div className="rounded-lg border border-gray-100 p-4">
          <div className="mb-3 text-sm font-semibold text-gray-800">Approval decision</div>
          {approved ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              Preview approved for future deployment readiness. Future deployment requires a separate approval step.
            </div>
          ) : latest?.status === 'rejected' ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Preview rejected.{latest.rejectionReason ? ` Reason: ${latest.rejectionReason}` : ''}</span>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Approval notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes for this approval..."
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm text-gray-800 focus:border-violet-400 focus:outline-none"
                />
                <button
                  onClick={approve}
                  disabled={acting || !currentApprovalId}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <ThumbsUp className="h-4 w-4" /> Approve preview for future deployment
                </button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Rejection reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Why is this preview being rejected?"
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm text-gray-800 focus:border-red-400 focus:outline-none"
                />
                <button
                  onClick={reject}
                  disabled={acting || !currentApprovalId}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <ThumbsDown className="h-4 w-4" /> Reject preview
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Next actions + disabled deploy notice */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="text-xs text-gray-500">
            Preview approval only — this does not publish or deploy the website.
          </div>
          <button
            disabled
            title="Deployment disabled — future milestone"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-400"
          >
            <Lock className="h-4 w-4" /> Deploy website — Deployment disabled — future milestone
          </button>
        </div>
      </div>
    </div>
  );
}
