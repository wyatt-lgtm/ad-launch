'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Link2, RefreshCw, Search, Upload, Plus, ShieldCheck, AlertTriangle,
  CheckCircle2, ArrowRight, Ban, Pencil, ListChecks, ThumbsUp,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

/**
 * Milestone 10 — Backlink Preservation + Redirect Plan panel.
 *
 * Preserves SEO equity when a new site is generated: inventory the existing
 * backlinked URLs (own-site crawl / uploaded export / manual list), map them
 * against the proposed sitemap, and review a 301 redirect plan. This panel
 * NEVER scrapes Google, NEVER deploys redirects, and NEVER mutates live DNS —
 * approving the plan is a READINESS decision only.
 */

type Priority = 'critical' | 'high' | 'medium' | 'low';

interface UrlRow {
  sourceUrl: string;
  targetUrl: string;
  normalizedTargetPath: string;
  referringDomain?: string | null;
  anchorText?: string | null;
  backlinkCount?: number | null;
  authorityScore?: number | null;
  status: string;
  priority?: Priority;
}
interface InventoryData {
  inventoryId: string | null;
  status?: string;
  source?: string;
  liveDomain?: string | null;
  providerMissing?: boolean;
  totalBacklinkUrls?: number;
  highValueUrlCount?: number;
  warnings?: string[];
  urls: UrlRow[];
}
interface Mapping {
  id: string | null;
  oldUrl: string;
  oldPath: string;
  newUrl: string | null;
  newPath: string | null;
  action: string;
  confidence: number;
  reason: string;
  status: string;
  priority: Priority;
  backlinkCount: number;
}
interface RedirectPlan {
  status: string;
  redirects: { from: string; to: string; statusCode: number; reason: string; priority: Priority; approved: boolean }[];
  preservedUrls: { path: string; reason: string }[];
  ignoredUrls: { path: string; reason: string; priority: Priority }[];
  unmappedUrls: { path: string; priority: Priority; backlinkCount: number }[];
  summary: { totalBacklinkUrls: number; preserved: number; redirected: number; ignored: number; unmapped: number };
}

const PRIORITY_BADGE: Record<Priority, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  low: 'border-gray-200 bg-gray-50 text-gray-600',
};

const ACTION_LABEL: Record<string, string> = {
  preserve_same_url: 'Preserve URL',
  redirect_301: '301 redirect',
  rebuild_page: 'Rebuild page',
  ignore_no_value: 'Ignore',
  needs_review: 'Needs review',
};

function prettyStatus(s?: string) {
  return (s || '').replace(/_/g, ' ');
}

export default function BacklinkPreservationCard() {
  const { activeBusiness } = useActiveBusiness();
  const businessId = activeBusiness?.id || null;

  const [inv, setInv] = useState<InventoryData | null>(null);
  const [plan, setPlan] = useState<RedirectPlan | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploadText, setUploadText] = useState('');
  const [manualText, setManualText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState('');
  const [ignoreReason, setIgnoreReason] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try {
      const [invRes, planRes] = await Promise.all([
        fetch(`/api/businesses/${businessId}/website/backlinks`, { cache: 'no-store' }),
        fetch(`/api/businesses/${businessId}/website/redirect-plan`, { cache: 'no-store' }),
      ]);
      if (invRes.ok) setInv(await invRes.json()); else setInv(null);
      if (planRes.ok) {
        const j = await planRes.json();
        setPlan((j?.plan as RedirectPlan) || null);
        setMappings((j?.mappings as Mapping[]) || []);
      } else { setPlan(null); setMappings([]); }
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (path: string, body: any, key: string) => {
    if (!businessId) return null;
    setBusy(key); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
      return j;
    } catch (e: any) {
      setError(e?.message || 'Action failed');
      return null;
    } finally {
      setBusy(null);
    }
  }, [businessId]);

  const scan = useCallback(async () => {
    const j = await post('backlinks/scan', {}, 'scan');
    if (j) { setNotice('Own-site scan complete. Backlink inventory updated.'); await load(); }
  }, [post, load]);

  const upload = useCallback(async () => {
    if (!uploadText.trim() && !manualText.trim()) { setError('Paste a backlink export or add manual URLs first.'); return; }
    const manualUrls = manualText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const j = await post('backlinks/upload', { content: uploadText, manualUrls }, 'upload');
    if (j) { setNotice('Backlink data imported.'); setUploadText(''); setManualText(''); await load(); }
  }, [post, uploadText, manualText, load]);

  const generate = useCallback(async () => {
    const j = await post('redirect-plan/generate', {}, 'generate');
    if (j) { setNotice('Redirect plan generated from the latest sitemap.'); await load(); }
  }, [post, load]);

  const approve = useCallback(async () => {
    const j = await post('redirect-plan/approve', {}, 'approve');
    if (j) { setNotice(`Redirect plan approved (${j.approved} mapping${j.approved === 1 ? '' : 's'}). Readiness only — nothing was deployed.`); await load(); }
  }, [post, load]);

  const saveEdit = useCallback(async (m: Mapping) => {
    if (!businessId || !m.id) return;
    setBusy(`edit:${m.id}`); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/redirect-plan/${m.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redirect_301', newPath: editTarget, status: 'proposed' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
      setEditing(null); setEditTarget(''); await load();
    } catch (e: any) {
      setError(e?.message || 'Edit failed');
    } finally {
      setBusy(null);
    }
  }, [businessId, editTarget, load]);

  const markIgnored = useCallback(async (m: Mapping) => {
    if (!businessId || !m.id) return;
    if (!ignoreReason.trim()) { setError('Enter a reason before ignoring a backlinked URL.'); return; }
    setBusy(`ignore:${m.id}`); setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/redirect-plan/${m.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ignore', status: 'ignored', reason: ignoreReason }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
      setEditing(null); setIgnoreReason(''); await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to ignore');
    } finally {
      setBusy(null);
    }
  }, [businessId, ignoreReason, load]);

  if (!businessId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Select a business to manage backlink preservation.</p>
      </div>
    );
  }

  const anyUnmappedHighValue = (plan?.unmappedUrls || []).some((u) => u.priority === 'high' || u.priority === 'critical');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-gray-700" />
          <h2 className="text-lg font-semibold text-gray-900">SEO &amp; Backlink Preservation</h2>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Inventory existing backlinked URLs and map them to the new sitemap so hard-earned SEO equity is preserved.
        This never scrapes Google, never deploys redirects, and never changes DNS — approval is a readiness decision only.
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span>
        </div>
      )}

      {/* Inventory section */}
      <div className="mt-5 rounded-lg border border-gray-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Backlink inventory</h3>
          <div className="flex items-center gap-2">
            <button onClick={scan} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              <Search className={`h-3.5 w-3.5 ${busy === 'scan' ? 'animate-pulse' : ''}`} /> Scan my site
            </button>
          </div>
        </div>

        {inv?.inventoryId ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">Status: {prettyStatus(inv.status)}</span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">{inv.totalBacklinkUrls ?? 0} URLs</span>
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">{inv.highValueUrlCount ?? 0} high-value</span>
              {inv.liveDomain && <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">{inv.liveDomain}</span>}
            </div>
            {inv.providerMissing && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Backlink provider not configured — external backlink coverage may be incomplete. Current-site URLs were still inventoried. Upload a backlink export below for fuller coverage.</span>
              </div>
            )}
            {(inv.warnings || []).length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-gray-500">
                {inv.warnings!.map((w, i) => (<li key={i}>• {w}</li>))}
              </ul>
            )}
            <div className="mt-3 max-h-52 overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500">
                  <tr><th className="px-2 py-1.5">Path</th><th className="px-2 py-1.5">Priority</th><th className="px-2 py-1.5">Backlinks</th><th className="px-2 py-1.5">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inv.urls.slice(0, 200).map((u, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700">{u.normalizedTargetPath}</td>
                      <td className="px-2 py-1.5">{u.priority && <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${PRIORITY_BADGE[u.priority]}`}>{u.priority}</span>}</td>
                      <td className="px-2 py-1.5 text-gray-600">{u.backlinkCount ?? '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{u.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No inventory yet. Scan your existing site or upload a backlink export to begin.</p>
        )}

        {/* Upload + manual entry */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-gray-600">Paste backlink export (CSV or URL list)</label>
            <textarea value={uploadText} onChange={(e) => setUploadText(e.target.value)} rows={3}
              placeholder="url,referring_domain,backlinks&#10;/services/brakes,example.com,42"
              className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Add URLs manually (one per line)</label>
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={3}
              placeholder="/old-page&#10;/promo/spring"
              className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs" />
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={upload} disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Upload className="h-3.5 w-3.5" /> Import backlink data
          </button>
        </div>
      </div>

      {/* Redirect plan section */}
      <div className="mt-5 rounded-lg border border-gray-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Redirect plan</h3>
          <div className="flex items-center gap-2">
            <button onClick={generate} disabled={!!busy || !inv?.inventoryId}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              <ListChecks className="h-3.5 w-3.5" /> Generate / refresh plan
            </button>
            <button onClick={approve} disabled={!!busy || !mappings.length || anyUnmappedHighValue}
              title={anyUnmappedHighValue ? 'Resolve unmapped high-value URLs before approving' : 'Approve redirect plan (readiness only)'}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
              <ThumbsUp className="h-3.5 w-3.5" /> Approve plan
            </button>
          </div>
        </div>

        {plan ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">Plan: {prettyStatus(plan.status)}</span>
              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-700">{plan.summary.preserved} preserved</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">{plan.summary.redirected} redirected</span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">{plan.summary.ignored} ignored</span>
              <span className={`rounded-full border px-2 py-0.5 ${plan.summary.unmapped > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{plan.summary.unmapped} unmapped</span>
            </div>

            {anyUnmappedHighValue && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>High-value backlinked URLs are unmapped. Assign a redirect target (or explicitly ignore with a reason) before the plan can be approved — these must never become 404s.</span>
              </div>
            )}

            {/* Mapping rows */}
            <div className="mt-3 space-y-2">
              {mappings.map((m) => (
                <div key={m.id || m.oldPath} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${PRIORITY_BADGE[m.priority]}`}>{m.priority}</span>
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{ACTION_LABEL[m.action] || m.action}</span>
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{prettyStatus(m.status)}</span>
                        {m.backlinkCount > 0 && <span className="text-[10px] text-gray-400">{m.backlinkCount} backlinks</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-gray-700">
                        <span className="truncate">{m.oldPath}</span>
                        <ArrowRight className="h-3 w-3 text-gray-400" />
                        <span className={`truncate ${m.newPath ? 'text-gray-700' : 'text-amber-600'}`}>{m.newPath || 'unmapped'}</span>
                      </div>
                      {m.reason && <p className="mt-0.5 truncate text-[11px] text-gray-400">{m.reason}</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setEditing(editing === `t${m.id}` ? null : `t${m.id}`); setEditTarget(m.newPath || ''); }}
                        disabled={!m.id || !!busy}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <Pencil className="h-3 w-3" /> Target
                      </button>
                      <button onClick={() => { setEditing(editing === `i${m.id}` ? null : `i${m.id}`); setIgnoreReason(''); }}
                        disabled={!m.id || !!busy}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <Ban className="h-3 w-3" /> Ignore
                      </button>
                    </div>
                  </div>

                  {editing === `t${m.id}` && (
                    <div className="mt-2 flex items-center gap-2">
                      <input value={editTarget} onChange={(e) => setEditTarget(e.target.value)} placeholder="/services/new-target"
                        className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-mono" />
                      <button onClick={() => saveEdit(m)} disabled={!editTarget.trim() || !!busy}
                        className="rounded-md bg-gray-900 px-2.5 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50">Set 301 target</button>
                    </div>
                  )}
                  {editing === `i${m.id}` && (
                    <div className="mt-2 flex items-center gap-2">
                      <input value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} placeholder="Reason this URL can 404 (required)"
                        className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs" />
                      <button onClick={() => markIgnored(m)} disabled={!ignoreReason.trim() || !!busy}
                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">Mark ignored</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No redirect plan yet. Build a sitemap and an inventory, then generate the plan.</p>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>Approving the redirect plan records a readiness decision and generates the redirect artifact for the eventual build. It does not deploy redirects, publish the site, or change DNS — those remain separate, gated steps.</span>
        </div>
      </div>
    </div>
  );
}
