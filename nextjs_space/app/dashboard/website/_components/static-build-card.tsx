'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Lock, RefreshCw, FileCode2, Image as ImageIcon,
  AlertTriangle, CheckCircle2, Server, Boxes, KeyRound,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Phase 3 — static build & artifact inspection.
 *
 * Surfaces the latest static build status, deployment target, generated
 * routes, asset portability, env requirements, warnings, and the computed
 * dry-run deploy plan. Deployment is DISABLED in this phase: the deploy action
 * is a disabled button labelled "Deployment disabled — dry run only". This
 * component never triggers a live deploy or publish.
 */

interface DryRunFile { path: string; remotePath: string; size: number }
interface DryRunPlan {
  targetType: string;
  mode: string;
  liveDeployEnabled: boolean;
  remotePath: string;
  fileCount: number;
  totalSize: number;
  wouldUpload: DryRunFile[];
  wouldDelete: DryRunFile[];
  warnings: string[];
  note: string;
}
interface DeployTarget {
  id: string;
  targetType: string;
  status: string;
  domain: string | null;
  siteUrl: string | null;
  deployBasePath: string | null;
  hasCredentialsRef: boolean;
}
interface BuildRow {
  id: string;
  buildStatus: string;
  buildNumber: number;
  sourceRef: string | null;
  outputRef: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
}
interface BuildData {
  deployTarget: DeployTarget | null;
  liveDeployEnabled: boolean;
  builds: BuildRow[];
  latest: (BuildRow & { artifactManifest: any }) | null;
  dryRunPlan: DryRunPlan;
}

const STATUS_STYLES: Record<string, string> = {
  ready_for_preview: 'bg-green-100 text-green-700 border-green-200',
  building: 'bg-violet-100 text-violet-700 border-violet-200',
  build_failed: 'bg-amber-100 text-amber-700 border-amber-200',
  draft: 'bg-gray-100 text-gray-500 border-gray-200',
};

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export default function StaticBuildCard() {
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx.activeBusiness?.id || null;
  const [data, setData] = useState<BuildData | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/site-build?businessId=${encodeURIComponent(businessId)}`);
      if (res.ok) setData(await res.json());
    } catch {
      /* surfaced via empty state */
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const manifest = data?.latest?.artifactManifest || null;
  const plan = data?.dryRunPlan || null;
  const target = data?.deployTarget || null;
  const latest = data?.latest || null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-50 p-2"><Layers className="h-5 w-5 text-indigo-600" /></div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Static site package &amp; artifact inspection</h2>
            <p className="text-xs text-gray-500">
              Portable static package, build artifact manifest, and dry-run deploy plan. Live deployment is disabled in this phase.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
          <Lock className="h-3 w-3" /> Dry run only
        </span>
      </div>

      <div className="space-y-5 p-5">
        {!businessId && (
          <p className="text-sm text-gray-500">Select a business to inspect its static build.</p>
        )}

        {businessId && (
          <>
            {/* Target + latest build summary */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400"><Server className="h-3.5 w-3.5" /> Deployment target</div>
                <div className="mt-1 text-sm font-semibold text-gray-800">{target?.targetType || 'hostgator_static'}</div>
                <div className="mt-0.5 text-xs text-gray-500">{target?.domain || 'No domain configured'}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400"><Boxes className="h-3.5 w-3.5" /> Latest build</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{latest ? `#${latest.buildNumber}` : '—'}</span>
                  {latest && (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[latest.buildStatus] || STATUS_STYLES.draft}`}>
                      {latest.buildStatus}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {latest?.completedAt ? new Date(latest.completedAt).toLocaleString('en-US') : 'No builds yet'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400"><KeyRound className="h-3.5 w-3.5" /> Credentials</div>
                <div className="mt-1 text-sm font-semibold text-gray-800">{target?.hasCredentialsRef ? 'Reference set' : 'Not configured'}</div>
                <div className="mt-0.5 text-xs text-gray-500">Stored by reference only — never shown</div>
              </div>
            </div>

            {/* Action row */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button
                disabled
                title="Deployment is disabled in this phase"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400"
              >
                <Lock className="h-4 w-4" /> Deployment disabled — dry run only
              </button>
              {msg && <span className="text-xs text-gray-500">{msg}</span>}
            </div>

            {/* Build failure */}
            {latest?.buildStatus === 'build_failed' && latest.errorMessage && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div><span className="font-medium">Build failed:</span> {latest.errorMessage}</div>
              </div>
            )}

            {/* Manifest detail */}
            {manifest && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Routes */}
                <div className="rounded-xl border border-gray-100 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><FileCode2 className="h-4 w-4 text-indigo-500" /> Generated routes ({manifest.routes?.length || 0})</div>
                  <ul className="space-y-1">
                    {(manifest.routes || []).map((r: string) => (
                      <li key={r} className="flex items-center gap-2 text-xs text-gray-600">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /><code>{r}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Assets */}
                <div className="rounded-xl border border-gray-100 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><ImageIcon className="h-4 w-4 text-indigo-500" /> Asset portability</div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">Copied: {manifest.assets?.totals?.copied ?? 0}</span>
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">Missing: {manifest.assets?.totals?.missing ?? 0}</span>
                    <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">Failed: {manifest.assets?.totals?.failed ?? 0}</span>
                    <span className="rounded-md bg-gray-50 px-2 py-1 text-gray-600">{fmtBytes(manifest.assets?.totals?.totalBytes ?? 0)}</span>
                  </div>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
                    {(manifest.assets?.copied || []).slice(0, 12).map((a: any) => (
                      <li key={a.assetId} className="truncate text-[11px] text-gray-500"><code>{a.webPath}</code></li>
                    ))}
                  </ul>
                </div>

                {/* Env */}
                <div className="rounded-xl border border-gray-100 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-800">Environment variables</div>
                  <div className="text-xs text-gray-500">Public keys (values via <code>.env.example</code>):</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(manifest.env?.publicKeys || []).map((k: string) => (
                      <span key={k} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{k}</span>
                    ))}
                    {(manifest.env?.publicKeys || []).length === 0 && <span className="text-[11px] text-gray-400">none</span>}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Secret refs (names only):</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(manifest.env?.secretRefs || []).map((k: string) => (
                      <span key={k} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{k}</span>
                    ))}
                    {(manifest.env?.secretRefs || []).length === 0 && <span className="text-[11px] text-gray-400">none</span>}
                  </div>
                </div>

                {/* Package / SEO */}
                <div className="rounded-xl border border-gray-100 p-4 text-xs text-gray-600">
                  <div className="mb-2 text-sm font-semibold text-gray-800">Package</div>
                  <div>Files rendered: <span className="font-medium">{manifest.package?.fileCount ?? 0}</span></div>
                  <div className="mt-0.5">Build command: <code className="text-[11px]">{manifest.build?.command}</code></div>
                  <div className="mt-0.5">Build result: <span className="font-medium">{manifest.build?.result}</span> (executed: {String(manifest.build?.executed)})</div>
                  <div className="mt-0.5">Sitemap: <code className="text-[11px]">{manifest.seo?.sitemapPath || '—'}</code> · Robots: <code className="text-[11px]">{manifest.seo?.robotsPath || '—'}</code></div>
                </div>
              </div>
            )}

            {/* Dry-run plan */}
            {plan && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">Dry-run deploy plan</div>
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500">live deploy: {String(plan.liveDeployEnabled)}</span>
                </div>
                <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                  <div>Remote path: <code className="text-[11px]">{plan.remotePath}</code></div>
                  <div>Would upload: <span className="font-medium">{plan.fileCount}</span> files ({fmtBytes(plan.totalSize)})</div>
                  <div>Would delete: <span className="font-medium">{plan.wouldDelete.length}</span> files</div>
                  <div>Target type: <span className="font-medium">{plan.targetType}</span></div>
                </div>
                {plan.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {plan.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />{w}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] italic text-gray-400">{plan.note}</p>
              </div>
            )}

            {/* Warnings from manifest */}
            {manifest?.warnings?.length > 0 && (
              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="mb-1 text-xs font-semibold text-amber-800">Build warnings ({manifest.warnings.length})</div>
                <ul className="space-y-0.5">
                  {manifest.warnings.slice(0, 8).map((w: string, i: number) => (
                    <li key={i} className="text-[11px] text-amber-700">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {!manifest && !loading && (
              <p className="text-sm text-gray-500">
                No build artifact yet. A static build is produced from an approved production site; once available it will appear here for inspection.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
