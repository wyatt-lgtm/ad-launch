'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import {
  Globe, Layout, Eye, Sparkles, CheckCircle2, Clock,
  AlertTriangle, RefreshCw, Rocket, ShieldCheck, Lock, ChevronRight,
  Wand2,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

// ── Status display config ────────────────────────────────────────────
const CONCEPT_LABELS: Record<string, string> = {
  not_started: 'Not started',
  generating: 'Generating…',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
};
const PRODUCTION_LABELS: Record<string, string> = {
  not_started: 'Not started',
  waiting_for_concept_approval: 'Waiting for concept approval',
  planning: 'Planning…',
  generating: 'Generating…',
  qa_pending: 'QA pending',
  qa_failed: 'QA failed',
  ready_for_review: 'Ready for review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
};

function statusColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'published':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'ready_for_review':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'generating':
    case 'planning':
    case 'qa_pending':
      return 'bg-violet-100 text-violet-700 border-violet-200';
    case 'revision_requested':
    case 'qa_failed':
    case 'rejected':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'waiting_for_concept_approval':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function StatusBadge({ status, kind }: { status: string; kind: 'concept' | 'production' }) {
  const label =
    kind === 'concept'
      ? CONCEPT_LABELS[status] || status
      : PRODUCTION_LABELS[status] || status;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${statusColor(status)}`}>
      {label}
    </span>
  );
}

const TABS = [
  { id: 'concepts', label: 'Concepts', icon: Sparkles },
  { id: 'production', label: 'Production Site', icon: Rocket },
  { id: 'pages', label: 'Pages', icon: Layout },
  { id: 'revisions', label: 'Revisions', icon: RefreshCw },
  { id: 'qa', label: 'QA', icon: ShieldCheck },
  { id: 'publish', label: 'Publish', icon: Globe, disabled: true },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function WebsiteSection() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx.activeBusiness?.id || null;

  const [tab, setTab] = useState<TabId>('concepts');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const loadProject = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/website-project?businessId=${encodeURIComponent(businessId)}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setData(json);
      else showToast('err', json.error || 'Failed to load website state');
    } catch {
      showToast('err', 'Failed to load website state');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  const loadPages = useCallback(async () => {
    if (!data?.project?.id) return;
    try {
      const res = await fetch(`/api/website-project/${data.project.id}/pages`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setPages(json.pages || []);
    } catch { /* ignore */ }
  }, [data?.project?.id]);

  const loadRevisions = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`/api/site-feedback?businessId=${encodeURIComponent(businessId)}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRevisions(json.feedback || []);
    } catch { /* ignore */ }
  }, [businessId]);

  useEffect(() => { loadProject(); }, [loadProject]);
  useEffect(() => { if (tab === 'pages' || tab === 'production') loadPages(); }, [tab, loadPages]);
  useEffect(() => { if (tab === 'revisions') loadRevisions(); }, [tab, loadRevisions]);

  const project = data?.project;
  const concepts: any[] = data?.concepts || [];
  const productions: any[] = data?.productions || [];
  const qaResults: any[] = data?.qaResults || [];
  const isAdmin: boolean = !!data?.isAdmin;
  const conceptApproved = project?.conceptStatus === 'approved';
  const reviewableConcept = concepts.find(
    (c) => c.status === 'ready_for_review' || c.status === 'revision_requested',
  );
  const approvedConcept = concepts.find((c) => c.status === 'approved');

  // ── Actions ────────────────────────────────────────────────────────
  const doApprove = async (conceptId?: string) => {
    if (!project) return;
    setBusy('approve');
    try {
      const res = await fetch(`/api/website-project/${project.id}/approve-concept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { showToast('ok', 'Concept approved. Production is now unlocked.'); await loadProject(); }
      else showToast('err', json.error || 'Approval failed');
    } finally { setBusy(null); }
  };

  const doRequestRevision = async (conceptId?: string) => {
    if (!project) return;
    const feedback = window.prompt('What should change in this concept? (your feedback is saved to Revisions)');
    if (feedback === null) return;
    setBusy('revision');
    try {
      const res = await fetch(`/api/website-project/${project.id}/request-concept-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, feedback, target: 'whole_site' }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { showToast('ok', 'Revision requested.'); await loadProject(); }
      else showToast('err', json.error || 'Request failed');
    } finally { setBusy(null); }
  };

  const doStartProduction = async (adminOverride = false) => {
    if (!project) return;
    setBusy('production');
    try {
      const res = await fetch(`/api/website-project/${project.id}/start-production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminOverride }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('ok', `Production build created with ${json.pageCount} pages.`);
        await loadProject();
        setTab('pages');
      } else {
        showToast('err', json.error || 'Could not start production');
      }
    } finally { setBusy(null); }
  };

  const viewConcept = (conceptId: string) => {
    window.open(`/api/website-concept/${conceptId}?html=1`, '_blank');
  };

  const goGenerateConcept = () => {
    if (data?.latestAnalysisId) router.push(`/results/${data.latestAnalysisId}`);
    else router.push('/dashboard');
  };

  if (status === 'loading') {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Globe className="w-6 h-6 text-blue-600" />
          Website
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          A two-stage workflow: design a <strong>Concept</strong>, approve it, then build your
          multi-page <strong>Production Site</strong>.
          {bizCtx.activeBusiness && (
            <span className="ml-1 text-blue-600 font-medium">
              — {bizCtx.activeBusiness.businessName || bizCtx.activeBusiness.businessDomain}
            </span>
          )}
        </p>
      </div>

      {!businessId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Select a business to manage its website.
        </div>
      )}

      {/* Status overview */}
      {businessId && project && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Sparkles className="w-4 h-4 text-violet-600" /> Concept
              </div>
              <StatusBadge status={project.conceptStatus} kind="concept" />
            </div>
            <p className="text-xs text-gray-400 mt-2">Creative direction — not your live production site.</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Rocket className="w-4 h-4 text-blue-600" /> Production Site
              </div>
              <StatusBadge status={project.productionStatus} kind="production" />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {conceptApproved ? 'Multi-page SEO build.' : 'Unlocks after concept approval.'}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      {businessId && (
        <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const disabled = (t as any).disabled;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setTab(t.id)}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : disabled
                    ? 'border-transparent text-gray-300 cursor-not-allowed'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                title={disabled ? 'Publishing is not enabled yet' : undefined}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {disabled && <Lock className="w-3 h-3 ml-0.5" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm border ${
          toast.type === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {toast.msg}
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading website…</div>}

      {/* ── CONCEPTS TAB ── */}
      {businessId && !loading && tab === 'concepts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Concept versions</h2>
            <button
              onClick={goGenerateConcept}
              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              <Wand2 className="w-4 h-4" /> Generate Concept
            </button>
          </div>

          {concepts.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
              <Sparkles className="w-8 h-8 text-violet-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No concept yet. Generate a concept to get started.</p>
              <p className="text-xs text-gray-400 mt-1">The concept is a creative direction — it is not your live production website.</p>
            </div>
          )}

          {concepts.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">Concept v{c.version}</span>
                    <StatusBadge status={c.status} kind="concept" />
                    <span className="text-[10px] font-medium text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">CONCEPT — NOT PRODUCTION</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Created {new Date(c.createdAt).toLocaleDateString('en-US')}
                    {c.approvedAt && ` · Approved ${new Date(c.approvedAt).toLocaleDateString('en-US')}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => viewConcept(c.id)}
                  className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-gray-700"
                >
                  <Eye className="w-4 h-4" /> View Concept
                </button>
                {c.status !== 'approved' && (
                  <button
                    onClick={() => doApprove(c.id)}
                    disabled={busy === 'approve'}
                    className="inline-flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve Concept
                  </button>
                )}
                <button
                  onClick={() => doRequestRevision(c.id)}
                  disabled={busy === 'revision'}
                  className="inline-flex items-center gap-1.5 text-sm border border-amber-200 text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" /> Request Concept Revision
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PRODUCTION TAB ── */}
      {businessId && !loading && tab === 'production' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Production builds</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => doStartProduction(false)}
                disabled={!conceptApproved || busy === 'production' || project?.productionStatus === 'planning' || project?.productionStatus === 'generating'}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                title={conceptApproved ? 'Build the multi-page production site' : 'Approve the concept first'}
              >
                <Rocket className="w-4 h-4" /> Start Production Build
              </button>
              {isAdmin && !conceptApproved && (
                <button
                  onClick={() => { if (window.confirm('Admin override: start production WITHOUT an approved concept?')) doStartProduction(true); }}
                  disabled={busy === 'production'}
                  className="inline-flex items-center gap-1.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-2 rounded-lg disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin override
                </button>
              )}
            </div>
          </div>

          {!conceptApproved && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
              <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Production is locked until a concept is approved. Approve a concept in the
                <button className="underline font-medium mx-1" onClick={() => setTab('concepts')}>Concepts</button>
                tab to unlock the production build.
              </span>
            </div>
          )}

          {productions.length === 0 && conceptApproved && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
              <Rocket className="w-8 h-8 text-blue-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No production build yet. Click “Start Production Build”.</p>
            </div>
          )}

          {productions.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Production v{p.version}</span>
                  <StatusBadge status={p.status} kind="production" />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.qaStatus === 'passed' ? 'bg-green-50 text-green-700' : p.qaStatus === 'failed' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'}`}>QA: {p.qaStatus}</span>
                </div>
                <button onClick={() => { setTab('pages'); }} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
                  View Production Pages <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Built {new Date(p.createdAt).toLocaleDateString('en-US')} · Derived from approved concept
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── PAGES TAB ── */}
      {businessId && !loading && tab === 'pages' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Production pages ({pages.length})</h2>
            <button onClick={loadPages} className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          </div>
          {pages.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No production pages yet. Start a production build from the Production Site tab.
            </div>
          )}
          {pages.map((pg) => (
            <div key={pg.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800 truncate">{pg.title || pg.path}</span>
                    <span className="text-[10px] uppercase tracking-wide font-medium text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">{pg.pageType}</span>
                    <code className="text-xs text-gray-400">{pg.path}</code>
                  </div>
                  {pg.metaDescription && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{pg.metaDescription}</p>}
                  {pg.sections?.length > 0 && (
                    <p className="text-[11px] text-gray-400 mt-1">{pg.sections.length} sections: {pg.sections.map((s: any) => s.sectionType).join(', ')}</p>
                  )}
                </div>
                <StatusBadge status={pg.status} kind="production" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── REVISIONS TAB ── */}
      {businessId && !loading && tab === 'revisions' && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Concept revision requests</h2>
          {revisions.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No revision requests. Use “Request Concept Revision” on a concept to add feedback here.
            </div>
          )}
          {revisions.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">{r.target} · {r.pageId}{r.sectionId ? ` / ${r.sectionId}` : ''}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'applied' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{r.status}</span>
              </div>
              <p className="text-sm text-gray-700 mt-1">{r.feedback}</p>
              <p className="text-[11px] text-gray-400 mt-1">{new Date(r.createdAt).toLocaleDateString('en-US')}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── QA TAB ── */}
      {businessId && !loading && tab === 'qa' && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">QA results</h2>
          {qaResults.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No QA results yet. QA runs automatically during concept and production builds.
            </div>
          )}
          {qaResults.map((q) => (
            <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{q.qaType === 'concept_war_room' ? 'Concept War Room' : q.qaType === 'production_qa' ? 'Production QA' : q.qaType}</span>
                  {q.qaAgent && <span className="text-xs text-gray-400">{q.qaAgent}</span>}
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  q.verdict === 'APPROVED' ? 'bg-green-50 text-green-700' :
                  q.verdict === 'REJECTED' ? 'bg-red-50 text-red-700' :
                  q.verdict === 'WARNING' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
                }`}>
                  {q.verdict === 'APPROVED' ? <CheckCircle2 className="w-3 h-3" /> : q.verdict === 'WARNING' ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {q.verdict}
                </span>
              </div>
              {q.failuresJson?.failures?.length > 0 && (
                <ul className="mt-2 text-xs text-amber-700 list-disc list-inside">
                  {q.failuresJson.failures.map((f: string, i: number) => <li key={i}>{f}</li>)}
                </ul>
              )}
              <p className="text-[11px] text-gray-400 mt-1">{new Date(q.createdAt).toLocaleDateString('en-US')}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── PUBLISH TAB (disabled) ── */}
      {businessId && !loading && tab === 'publish' && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <Lock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Publishing is not enabled in this phase.</p>
        </div>
      )}
    </div>
  );
}
