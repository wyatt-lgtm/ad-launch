'use client';

/**
 * Page Briefs tab — P10 WF3 quality visibility (READ ONLY).
 *
 * Surfaces, per dispatched Website-SEO workflow: pipeline status, final QA
 * score vs threshold, publish-readiness, required fixes, brief adherence, Tom
 * conversion-fix provenance and the Gutenberg draft gate — using normalized
 * data (never raw task JSON). No publishing action is offered anywhere.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, FileText, ClipboardCheck, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ShieldAlert, Wrench, Target, ListChecks,
  FileSearch, Gauge, Ban, Clock,
} from 'lucide-react';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }); }
  catch { return '—'; }
}

// Map a primary status label to a badge color.
function statusColor(label: string): string {
  switch (label) {
    case 'Approved for Publish': return 'bg-green-100 text-green-800 border-green-200';
    case 'Failed QA': return 'bg-red-100 text-red-800 border-red-200';
    case 'Workflow Failed': return 'bg-red-100 text-red-800 border-red-200';
    case 'Publish Blocked': return 'bg-red-100 text-red-800 border-red-200';
    case 'Needs Revision': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'Not Publish Ready': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'In Progress': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'Not Started': return 'bg-gray-100 text-gray-600 border-gray-200';
    default: return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function secondaryColor(label: string): string {
  switch (label) {
    case 'Research Brief Used': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'Draft Generated': return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'Draft Only': return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'Publish Blocked': return 'bg-red-50 text-red-700 border-red-200';
    case 'Not Publish Ready': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'Post-Publish Check Deferred': return 'bg-purple-50 text-purple-700 border-purple-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

function severityColor(sev?: string | null): string {
  switch ((sev || '').toLowerCase()) {
    case 'critical': return 'bg-red-100 text-red-800';
    case 'high': return 'bg-orange-100 text-orange-800';
    case 'medium': return 'bg-amber-100 text-amber-800';
    case 'low': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

interface Brief {
  id: string;
  targetPageType: string;
  recommendedSlug: string | null;
  recommendedMetaTitle: string | null;
  recommendedH1: string | null;
  status: string;
  workflowId: string | null;
  dispatched: boolean;
  dispatchedAt: string | null;
  targetKeyword: string | null;
  targetLocation: string | null;
  serviceLine: string | null;
}

export default function PageBriefsTab({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/seo/page-briefs`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load page briefs (${res.status})`);
      const data = await res.json();
      setBriefs(Array.isArray(data?.briefs) ? data.briefs : []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load page briefs');
      setBriefs([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>;
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={load} className="mt-3 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Retry</button>
      </div>
    );
  }
  if (briefs.length === 0) {
    return (
      <div className="bg-white border border-dashed border-gray-300 rounded-xl py-16 text-center">
        <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-900">No page briefs yet</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
          Approved SEO page briefs and their AI page-build quality reports will appear here once research briefs are created and dispatched.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 max-w-3xl">
        Quality &amp; QA visibility for AI-built SEO pages. Each card shows whether the approved research brief was used,
        the final QA score against the publish threshold, publish-readiness, and the required fixes. This view is
        read-only &mdash; pages are never published from here.
      </p>
      {briefs.map((b) => <BriefCard key={b.id} businessId={businessId} brief={b} />)}
    </div>
  );
}

function BriefCard({ businessId, brief }: { businessId: string; brief: Brief }) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<any>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [qErr, setQErr] = useState<string | null>(null);

  const title = brief.recommendedMetaTitle || brief.recommendedH1 || brief.recommendedSlug || `${LABEL(brief.targetPageType)} page`;

  const loadQuality = useCallback(async () => {
    if (!brief.workflowId || quality || loadingQ) return;
    setLoadingQ(true);
    setQErr(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/website/workflows/${brief.workflowId}/quality`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load quality (${res.status})`);
      const data = await res.json();
      setQuality(data?.quality ?? null);
    } catch (e: any) {
      setQErr(e?.message ?? 'Failed to load quality data');
    } finally {
      setLoadingQ(false);
    }
  }, [businessId, brief.workflowId, quality, loadingQ]);

  // Auto-load quality for dispatched briefs so the compact summary is populated.
  useEffect(() => { if (brief.dispatched) loadQuality(); }, [brief.dispatched, loadQuality]);

  const q = quality;
  const d = q?.display;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header row */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <h3 className="font-semibold text-gray-900 truncate">{title}</h3>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{LABEL(brief.targetPageType)}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Brief: {LABEL(brief.status)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {brief.targetKeyword && <span><Target className="w-3 h-3 inline mr-1" />{brief.targetKeyword}</span>}
              {brief.targetLocation && <span>📍 {brief.targetLocation}</span>}
              {brief.recommendedSlug && <span className="font-mono">/{brief.recommendedSlug.replace(/^\//, '')}</span>}
            </div>
          </div>
          {/* primary status badge */}
          <div className="text-right shrink-0">
            {brief.dispatched ? (
              loadingQ && !q ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
              ) : d ? (
                <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor(d.statusLabel)}`}>{d.statusLabel}</span>
              ) : (
                <span className="inline-block text-xs px-2.5 py-1 rounded-full border bg-gray-100 text-gray-600 border-gray-200">Status unavailable</span>
              )
            ) : (
              <span className="inline-block text-xs px-2.5 py-1 rounded-full border bg-gray-100 text-gray-600 border-gray-200">Not dispatched</span>
            )}
          </div>
        </div>

        {/* compact quality summary */}
        {brief.dispatched && q && (
          <div className="mt-4">
            {/* secondary labels */}
            {d?.secondaryLabels?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {d.secondaryLabels.map((l: string) => (
                  <span key={l} className={`text-[11px] px-2 py-0.5 rounded-full border ${secondaryColor(l)}`}>{l}</span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryStat
                label="SEO Quality"
                value={q.finalQa?.available && q.finalQa.seoScore != null
                  ? `${q.finalQa.seoScore} / ${q.finalQa.threshold ?? '—'}`
                  : 'Not scored yet'}
                tone={q.finalQa?.qaStatus === 'fail' ? 'bad' : (d?.publishReady ? 'good' : 'warn')}
              />
              <SummaryStat label="Status" value={d?.statusLabel ?? '—'} tone={d?.statusLabel === 'Approved for Publish' ? 'good' : (d?.statusLabel === 'Failed QA' ? 'bad' : 'warn')} />
              <SummaryStat label="Publish Ready" value={d?.publishReady ? 'Yes' : 'No'} tone={d?.publishReady ? 'good' : 'warn'} />
              <SummaryStat label="Blocked By" value={d?.blockedBy ?? '—'} tone={d?.blockedBy ? 'bad' : 'neutral'} />
            </div>

            {/* top fixes */}
            {d?.topFixes?.length > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1"><Wrench className="w-3.5 h-3.5" /> Top Required Fixes</div>
                <ul className="list-disc list-inside text-xs text-amber-900 space-y-0.5">
                  {d.topFixes.map((f: string, i: number) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            {/* post-publish line */}
            <div className="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> {d?.postPublishLabel}
            </div>

            {/* action buttons — read-only views only, NO publish */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} View QA Details
              </button>
            </div>
          </div>
        )}

        {/* dispatched but quality failed to load */}
        {brief.dispatched && qErr && (
          <div className="mt-3 text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {qErr} <button onClick={loadQuality} className="underline">Retry</button></div>
        )}

        {/* not dispatched help */}
        {!brief.dispatched && (
          <p className="mt-3 text-xs text-gray-500">This approved brief has not been dispatched to the AI page-build workflow yet. Quality data will appear here once a build runs.</p>
        )}
      </div>

      {/* QA details panel */}
      {open && q && <QaDetailsPanel q={q} />}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'warn' | 'neutral' }) {
  const toneCls = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-700';
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  );
}

function QaDetailsPanel({ q }: { q: any }) {
  const fq = q.finalQa ?? {};
  const conv = q.conversion ?? {};
  const gate = q.publishGate ?? {};
  const pp = q.postPublish ?? {};

  return (
    <div className="border-t border-gray-200 bg-gray-50/60 p-4 sm:p-5 space-y-5">
      {/* 1. Summary */}
      <Section icon={Gauge} title="Summary">
        {fq.available ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <KV k="Final QA Score" v={fq.seoScore != null ? `${fq.seoScore}` : '—'} />
            <KV k="Publish Threshold" v={fq.threshold != null ? `${fq.threshold}` : '—'} />
            <KV k="QA Status" v={fq.qaStatus ? LABEL(fq.qaStatus) : '—'} tone={fq.qaStatus === 'fail' ? 'bad' : 'neutral'} />
            <KV k="Publish Recommendation" v={fq.publishRecommendation ? LABEL(fq.publishRecommendation) : '—'} />
            <KV k="Approved for Publish" v={fq.approvedForPublish ? 'Yes' : 'No'} tone={fq.approvedForPublish ? 'good' : 'warn'} />
            <KV k="Computed Publish Ready" v={q.display?.publishReady ? 'Yes' : 'No'} tone={q.display?.publishReady ? 'good' : 'warn'} />
          </div>
        ) : (
          <Empty text={q.reached?.finalQa ? 'Final QA report unavailable.' : 'Final QA has not been reached yet in this workflow.'} />
        )}
        {/* score breakdown */}
        {fq.scoreBreakdown?.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {fq.scoreBreakdown.map((c: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-3 text-xs bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-gray-800">{LABEL(c.category)}</div>
                  {c.explanation && <div className="text-gray-500 mt-0.5">{c.explanation}</div>}
                </div>
                <div className="font-mono text-gray-700 shrink-0">{c.points ?? '—'} / {c.maxPoints ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Required Fixes */}
      <Section icon={Wrench} title={`Required Fixes${fq.requiredFixes?.length ? ` (${fq.requiredFixes.length})` : ''}`}>
        {fq.requiredFixes?.length > 0 ? (
          <div className="space-y-2">
            {fq.requiredFixes.map((f: any, i: number) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {f.severity && <span className={`px-1.5 py-0.5 rounded font-semibold ${severityColor(f.severity)}`}>{LABEL(f.severity)}</span>}
                  {f.responsibleAgent && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{f.responsibleAgent}</span>}
                  {f.section && <span className="text-gray-500">{f.section}</span>}
                  {f.retryRecommended != null && (
                    <span className={`px-1.5 py-0.5 rounded ${f.retryRecommended ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>Retry {f.retryRecommended ? 'recommended' : 'not recommended'}</span>
                  )}
                </div>
                {f.issue && <div className="text-gray-800"><span className="font-medium">Issue:</span> {f.issue}</div>}
                {f.requiredChange && <div className="text-gray-800 mt-0.5"><span className="font-medium">Required change:</span> {f.requiredChange}</div>}
                {f.evidence && <div className="text-gray-500 mt-0.5"><span className="font-medium">Evidence:</span> {f.evidence}</div>}
              </div>
            ))}
          </div>
        ) : (
          <Empty text={fq.available ? 'No required fixes reported.' : 'Final QA has not been reached yet.'} ok={fq.available} />
        )}
      </Section>

      {/* 3. Failed Checklist Items */}
      <Section icon={ListChecks} title={`Failed Checklist Items${fq.failedChecklistItems?.length ? ` (${fq.failedChecklistItems.length})` : ''}`}>
        {fq.failedChecklistItems?.length > 0 ? (
          <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">
            {fq.failedChecklistItems.map((it: string, i: number) => <li key={i}>{it}</li>)}
          </ul>
        ) : <Empty text={fq.available ? 'No failed checklist items.' : 'Not available yet.'} ok={fq.available} />}
      </Section>

      {/* 4. Brief Adherence */}
      <Section icon={Target} title="Brief Adherence">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <KV k="Approved Brief Used" v={q.approvedBriefUsed == null ? '—' : (q.approvedBriefUsed ? 'Yes' : 'No')} tone={q.approvedBriefUsed ? 'good' : 'warn'} />
          <KV k="Target Keyword" v={q.targetKeyword ?? '—'} />
          <KV k="Target Location" v={q.targetLocation ?? '—'} />
          <KV k="Approved Slug" v={q.recommendedSlug ? `/${q.recommendedSlug.replace(/^\//, '')}` : '—'} />
          <KV k="Page Type" v={q.pageType ? LABEL(q.pageType) : '—'} />
          <KV k="Brief Adherence Score" v={fq.briefAdherenceScore != null ? `${fq.briefAdherenceScore}` : '—'} />
        </div>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <MissingList title="Missing Required Sections" items={fq.missingRequiredSections} />
          <MissingList title="Missing Required FAQs" items={fq.missingRequiredFaqs} />
          <MissingList title="Missing Conversion Elements" items={fq.missingConversionElements} />
          <MissingList title="Generic Copy Flags" items={fq.genericCopyFlags} />
        </div>
      </Section>

      {/* 5. Conversion Review */}
      <Section icon={Gauge} title="Conversion Review">
        {conv.available ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <KV k="Tom Review Found" v={conv.tomReviewFound == null ? '—' : (conv.tomReviewFound ? 'Yes' : 'No')} />
            <KV k="Tom Fixes Received" v={conv.tomFixesReceived != null ? `${conv.tomFixesReceived}` : '—'} />
            <KV k="Tom Fixes Applied" v={conv.tomFixesApplied != null ? `${conv.tomFixesApplied}` : '—'} />
            <KV k="Tom Fixes Unresolved" v={conv.tomFixesUnresolved != null ? `${conv.tomFixesUnresolved}` : '—'} tone={conv.tomFixesUnresolved ? 'warn' : 'neutral'} />
            <KV k="Non-Tom Fixes Applied" v={conv.nonTomFixesApplied != null ? `${conv.nonTomFixesApplied}` : '—'} />
            <KV k="Conversion Score" v={(fq.conversionScore ?? conv.tomConversionScore) != null ? `${fq.conversionScore ?? conv.tomConversionScore}` : '—'} />
          </div>
        ) : <Empty text="Conversion review has not been reached yet." />}
      </Section>

      {/* 6. Publish Gate */}
      <Section icon={Ban} title="Publish Gate">
        {gate.available ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <KV k="Draft Status" v={gate.draftStatus ? LABEL(gate.draftStatus) : '—'} />
            <KV k="Publish Ready" v={gate.publishReady == null ? '—' : (gate.publishReady ? 'Yes' : 'No')} tone={gate.publishReady ? 'good' : 'warn'} />
            <KV k="Approval Gate" v={gate.approvalGate ? LABEL(gate.approvalGate) : '—'} />
            <KV k="Published URL" v={gate.publishedUrl || 'None (not published)'} tone={gate.publishedUrl ? 'good' : 'neutral'} />
            <KV k="Has Draft" v={gate.hasDraft ? 'Yes' : 'No'} />
            <KV k="QA Failed" v={gate.qaFailed == null ? '—' : (gate.qaFailed ? 'Yes' : 'No')} tone={gate.qaFailed ? 'bad' : 'neutral'} />
          </div>
        ) : <Empty text={q.reached?.gutenberg ? 'Publish gate data unavailable.' : 'Publish gate (draft generation) has not been reached yet.'} />}
        {gate.guardrailIssues?.length > 0 && (
          <div className="mt-2 text-xs text-gray-600">
            <span className="font-medium">Guardrail notes:</span>
            <ul className="list-disc list-inside mt-0.5">{gate.guardrailIssues.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>
          </div>
        )}
        <div className="mt-3 text-xs text-gray-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {q.display?.postPublishLabel}</div>
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, children }: any) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4 text-gray-500" /><h4 className="text-sm font-semibold text-gray-800">{title}</h4></div>
      {children}
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' | 'warn' | 'neutral' }) {
  const toneCls = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-800';
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{k}</div>
      <div className={`text-sm font-medium mt-0.5 break-words ${toneCls}`}>{v}</div>
    </div>
  );
}

function MissingList({ title, items }: { title: string; items?: string[] }) {
  const has = Array.isArray(items) && items.length > 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1.5">
        {has ? <XCircle className="w-3.5 h-3.5 text-red-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
        {title}
      </div>
      {has ? (
        <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">{items!.map((it, i) => <li key={i}>{it}</li>)}</ul>
      ) : <div className="text-xs text-gray-400">None</div>}
    </div>
  );
}

function Empty({ text, ok }: { text: string; ok?: boolean }) {
  return (
    <div className="text-xs text-gray-500 flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <FileSearch className="w-3.5 h-3.5 text-gray-400" />}
      {text}
    </div>
  );
}
