'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Lock, RefreshCw, FileCode2, Image as ImageIcon,
  AlertTriangle, CheckCircle2, ListTree, ClipboardList, Play,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Milestone 6 — sitemap-first static build panel.
 *
 * Consumes the approved sitemap + copy + approved images and builds a portable
 * static preview package (artifact mode). Shows the gate state, refs, image
 * counts, generated routes, asset materialization, warnings, artifact manifest
 * summary, and the dry-run deployment plan. Deployment is DISABLED — any future
 * deploy control is disabled and labelled "Deployment disabled — dry run only".
 */

interface GatePage {
  slug: string; pageType: string; h1: string; hasCopy: boolean;
  copyStatus: string | null; requiresHero: boolean; hasHero: boolean; heroStatus: string | null;
}
interface GateRefs {
  sitemapId: string | null; sitemapApproved: boolean;
  copyArtifactIds: string[]; representativeCopyStatus: string | null;
  briefSetId: string | null; briefSetStatus: string | null;
  approvedImageCount: number; usableImageCount: number; missingRequiredImageCount: number;
  routes: string[]; pages: GatePage[];
}
interface Gate {
  ok: boolean;
  blocking: { code: string; message: string; slugs?: string[] }[];
  warnings: string[];
  refs: GateRefs;
}
interface BuildRow {
  id: string; buildStatus: string; buildNumber: number;
  sourceRef: string | null; outputRef: string | null;
  errorMessage: string | null; completedAt: string | null; createdAt: string;
}
interface DryRunPlan {
  targetType: string; mode: string; liveDeployEnabled: boolean; remotePath: string;
  fileCount: number; totalSize: number; wouldUpload: any[]; wouldDelete: any[];
  warnings: string[]; note: string;
}
interface Data {
  liveDeployEnabled: boolean;
  deploymentDisabledNotice: string;
  gate: Gate;
  builds: BuildRow[];
  latest: (BuildRow & { artifactManifest: any }) | null;
  dryRunPlan: DryRunPlan | null;
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function StaticSiteBuildCard() {
  const { activeBusiness } = useActiveBusiness();
  const businessId = activeBusiness?.id || null;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [showDryRun, setShowDryRun] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/static-builds`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Failed (${res.status})`);
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async () => {
    if (!businessId) return;
    setBuilding(true); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/static-builds/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 422) throw new Error(body?.error || `Build failed (${res.status})`);
      if (body?.blocked) setError('Build blocked by the static build gate — resolve the blocking items below.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Build failed');
    } finally {
      setBuilding(false);
    }
  }, [businessId, load]);

  if (!businessId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Select a business to inspect static builds.</p>
      </div>
    );
  }

  const gate = data?.gate;
  const refs = gate?.refs;
  const latest = data?.latest;
  const manifest = latest?.artifactManifest;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Static Build</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={generate} disabled={building || (gate ? !gate.ok : false)}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> {building ? 'Building…' : 'Generate Static Preview Build'}
          </button>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {/* Gate state */}
        {gate && (
          <div className={`rounded-md border p-3 text-sm ${gate.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            <div className="flex items-center gap-2 font-medium">
              {gate.ok ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {gate.ok ? 'Gate passed — ready to build a static preview' : 'Gate blocked — resolve the items below'}
            </div>
            {!gate.ok && gate.blocking.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {gate.blocking.map((b, i) => (<li key={i}><span className="font-mono">{b.code}</span>: {b.message}</li>))}
              </ul>
            )}
            {gate.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-80">
                {gate.warnings.map((w, i) => (<li key={i}>{w}</li>))}
              </ul>
            )}
          </div>
        )}

        {/* Refs + counts */}
        {refs && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sitemap" value={refs.sitemapApproved ? 'Approved' : (refs.sitemapId ? 'Not approved' : 'Missing')} />
            <Stat label="Copy status" value={refs.representativeCopyStatus || 'Missing'} />
            <Stat label="Brief set" value={refs.briefSetStatus || (refs.briefSetId ? 'Set' : 'Missing')} />
            <Stat label="Approved images" value={String(refs.approvedImageCount)} />
            <Stat label="Usable images" value={String(refs.usableImageCount)} />
            <Stat label="Missing required images" value={String(refs.missingRequiredImageCount)} />
            <Stat label="Routes" value={String(refs.routes.length)} />
            <Stat label="Latest build" value={latest ? `#${latest.buildNumber} · ${latest.buildStatus}` : 'None'} />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Toggle icon={<ClipboardList className="h-3.5 w-3.5" />} on={showManifest} onClick={() => setShowManifest(v => !v)} disabled={!manifest} label="View Artifact Manifest" />
          <Toggle icon={<ListTree className="h-3.5 w-3.5" />} on={showRoutes} onClick={() => setShowRoutes(v => !v)} disabled={!refs?.routes?.length} label="View Generated Routes" />
          <Toggle icon={<FileCode2 className="h-3.5 w-3.5" />} on={showDryRun} onClick={() => setShowDryRun(v => !v)} disabled={!data?.dryRunPlan} label="View Dry-Run Plan" />
        </div>

        {showRoutes && refs?.routes && (
          <Panel title="Generated routes">
            <ul className="grid grid-cols-2 gap-1 font-mono text-xs text-gray-700 sm:grid-cols-3">
              {refs.routes.map((r) => (<li key={r} className="truncate rounded bg-gray-50 px-2 py-1">{r}</li>))}
            </ul>
          </Panel>
        )}

        {showManifest && manifest && (
          <Panel title="Artifact manifest">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Pages" value={String(manifest?.pages?.length ?? 0)} />
              <Stat label="Routes" value={String(manifest?.routes?.length ?? 0)} />
              <Stat label="Assets copied" value={String(manifest?.assets?.copied ?? 0)} />
              <Stat label="Assets missing" value={String(manifest?.assets?.missing ?? 0)} />
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-600">
              <div><span className="font-medium">sourceRef:</span> <span className="font-mono">{manifest?.package?.sourceRef || '—'}</span></div>
              <div><span className="font-medium">outputRef:</span> <span className="font-mono">{manifest?.package?.outputRef || '— (artifact only)'}</span></div>
              <div><span className="font-medium">Public env keys:</span> <span className="font-mono">{(manifest?.env?.publicKeys || []).join(', ') || '—'}</span></div>
            </div>
            {(manifest?.warnings || []).length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-700">
                {manifest.warnings.map((w: string, i: number) => (<li key={i}>{w}</li>))}
              </ul>
            )}
          </Panel>
        )}

        {showDryRun && data?.dryRunPlan && (
          <Panel title="Dry-run deployment plan">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Target" value={data.dryRunPlan.targetType} />
              <Stat label="Files" value={String(data.dryRunPlan.fileCount)} />
              <Stat label="Total size" value={fmtBytes(data.dryRunPlan.totalSize)} />
              <Stat label="Would upload" value={String(data.dryRunPlan.wouldUpload.length)} />
            </div>
            <p className="mt-2 text-xs text-gray-500">{data.dryRunPlan.note}</p>
          </Panel>
        )}

        {/* Deployment disabled notice */}
        <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <ImageIcon className="h-3.5 w-3.5" />
            Approved images are materialized into <span className="font-mono">/images/…</span>
          </div>
          <button disabled title="Deployment disabled — dry run only"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400">
            <Lock className="h-3.5 w-3.5" /> Deployment disabled — dry run only
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-gray-800">{value}</div>
    </div>
  );
}

function Toggle({ icon, on, onClick, disabled, label }: { icon: React.ReactNode; on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
      {icon} {label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-100 bg-white p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      {children}
    </div>
  );
}
