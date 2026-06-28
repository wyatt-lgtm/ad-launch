'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Lock, LogIn, Wrench, CheckCircle2, Circle, AlertTriangle, Ban,
  ChevronDown, ChevronRight, Plus, Star, Globe, Video, FileText, X, Edit3,
  Sparkles, Eye, Building2, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

interface Offering {
  id: string;
  name: string;
  slug: string;
  status: string;
  source: string;
  confidence: string;
  priority: string;
  seoEnabled: boolean;
  pageStatus: string;
  videoStatus: string;
  ownerConfirmed: boolean;
  isCustom: boolean;
  industryServiceId: string | null;
  shortDescription: string;
  customerProblem: string;
  evidence: any[];
  hasPage: boolean;
  hasVideoBrief: boolean;
}

interface Industry { id: string; name: string; slug: string; }

interface ServicesData {
  business: {
    id: string;
    name: string | null;
    matchedIndustryId: string | null;
    matchedIndustryConfidence: string | null;
    industryMatchSource: string | null;
    industryMatchEvidence: any[];
    ownerConfirmedIndustry: boolean;
  };
  matchedIndustry: Industry | null;
  industries: Industry[];
  offerings: Offering[];
  summary: { confirmed: number; suggested: number; needsReview: number; rejected: number };
}

const CONFIDENCE_BADGE: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABEL: Record<string, string> = {
  jim_bridger: 'Jim Bridger research',
  website: 'Website',
  owner_confirmed: 'You confirmed',
  ai_inferred: 'AI inferred',
  manual: 'Added by you',
  imported: 'Imported',
};

const PRIORITY_LABEL: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  optional: 'Optional',
  do_not_promote: 'Do not promote',
};

const PAGE_STATUS_LABEL: Record<string, string> = {
  not_started: 'No page',
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
};

const VIDEO_STATUS_LABEL: Record<string, string> = {
  not_started: 'No video',
  brief_ready: 'Brief ready',
  script_ready: 'Script ready',
  generated: 'Generated',
  approved: 'Approved',
  published: 'Published',
};

export default function ServicesManager() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx?.activeBusiness?.id;
  const businessName = bizCtx?.activeBusiness?.businessName;

  const [data, setData] = useState<ServicesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Offering | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [matching, setMatching] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = useCallback(async () => {
    if (!businessId || sessionStatus !== 'authenticated') { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/services`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      } else {
        showToast('Could not load services', false);
      }
    } catch {
      showToast('Could not load services', false);
    }
    setLoading(false);
  }, [businessId, sessionStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const patchOffering = async (offeringId: string, body: any) => {
    if (!businessId) return;
    setBusyId(offeringId);
    try {
      const res = await fetch(`/api/businesses/${businessId}/services/${offeringId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { await fetchData(); }
      else showToast('Update failed', false);
    } catch { showToast('Update failed', false); }
    setBusyId(null);
  };

  const generate = async (offeringId: string, kind: 'page' | 'video') => {
    if (!businessId) return;
    setBusyId(offeringId);
    showToast(kind === 'page' ? 'Generating service page draft...' : 'Generating explainer video brief...');
    try {
      const endpoint = kind === 'page' ? 'generate-page' : 'generate-video-brief';
      const res = await fetch(`/api/businesses/${businessId}/services/${offeringId}/${endpoint}`, { method: 'POST' });
      if (res.ok) {
        showToast(kind === 'page' ? 'Service page draft created — needs review' : 'Explainer video brief & script ready');
        await fetchData();
      } else {
        const e = await res.json().catch(() => ({}));
        showToast(e.error || 'Generation failed', false);
      }
    } catch { showToast('Generation failed', false); }
    setBusyId(null);
  };

  const setIndustry = async (industryId: string) => {
    if (!businessId || !industryId) return;
    setMatching(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/services/match-industry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industryId }),
      });
      if (res.ok) { showToast('Industry updated — service checklist refreshed'); await fetchData(); }
      else showToast('Could not set industry', false);
    } catch { showToast('Could not set industry', false); }
    setMatching(false);
  };

  const autoMatch = async () => {
    if (!businessId) return;
    setMatching(true);
    showToast('Matching your business to an industry...');
    try {
      const res = await fetch(`/api/businesses/${businessId}/services/match-industry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoMatch: true }),
      });
      if (res.ok) { showToast('Industry match complete'); await fetchData(); }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Could not auto-match', false); }
    } catch { showToast('Could not auto-match', false); }
    setMatching(false);
  };

  // Auth gates
  if (sessionStatus === 'loading') {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>;
  }
  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-500 mb-6">Services management is only available for registered business owners.</p>
        <button onClick={() => router.push('/login')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
          <LogIn className="w-4 h-4" /> Log In or Register
        </button>
      </div>
    );
  }
  if (!businessId) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Wrench className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Selected</h2>
        <p className="text-gray-500 mb-6">Select a business from your dashboard to manage services.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">Go to Dashboard</button>
      </div>
    );
  }

  const confirmed = (data?.offerings || []).filter(o => o.status === 'confirmed');
  const needsReview = (data?.offerings || []).filter(o => o.status === 'needs_review');
  const suggested = (data?.offerings || []).filter(o => o.status === 'suggested');
  const rejected = (data?.offerings || []).filter(o => o.status === 'rejected');

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Services Offered</h1>
        </div>
        <p className="text-gray-500 text-sm">{businessName || 'Your Business'}</p>
        <p className="text-gray-600 text-sm mt-3 max-w-3xl">
          These are the services we think you offer, based on your industry and Jim Bridger&apos;s research.
          Confirm the ones you actually provide, remove any you don&apos;t, and add anything we missed.
          Confirmed services power your SEO pages, ads, and social content — and you can generate a draft
          web page and a short explainer video for each one.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
      ) : (
        <>
          {/* Industry match card */}
          <IndustryCard
            data={data!}
            matching={matching}
            onSetIndustry={setIndustry}
            onAutoMatch={autoMatch}
          />

          {/* Summary + Add */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-green-100 text-green-800 font-medium">{confirmed.length} confirmed</span>
              <span className="px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 font-medium">{needsReview.length} needs review</span>
              <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 font-medium">{suggested.length} suggested</span>
              <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">{rejected.length} not offered</span>
            </div>
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors">
              <Plus className="w-4 h-4" /> Add custom service
            </button>
          </div>

          {(data?.offerings || []).length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">No services yet</h3>
              <p className="text-gray-500 text-sm mb-4 max-w-md mx-auto">
                Match your business to an industry above to load a starter checklist, or add your services manually.
              </p>
              <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Add custom service
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {needsReview.length > 0 && (
                <Section title="Needs your review" subtitle="Jim Bridger found some evidence — confirm if you offer these" icon={<AlertTriangle className="w-4 h-4 text-yellow-600" />}>
                  {needsReview.map(o => <Row key={o.id} o={o} busyId={busyId} expanded={expanded} setExpanded={setExpanded} onPatch={patchOffering} onGenerate={generate} onEdit={setEditing} />)}
                </Section>
              )}
              {confirmed.length > 0 && (
                <Section title="Confirmed services" subtitle="Used for SEO pages, ads & social content" icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}>
                  {confirmed.map(o => <Row key={o.id} o={o} busyId={busyId} expanded={expanded} setExpanded={setExpanded} onPatch={patchOffering} onGenerate={generate} onEdit={setEditing} />)}
                </Section>
              )}
              {suggested.length > 0 && (
                <Section title="Suggested for your industry" subtitle="Common services in your industry — confirm any you offer" icon={<Circle className="w-4 h-4 text-blue-600" />}>
                  {suggested.map(o => <Row key={o.id} o={o} busyId={busyId} expanded={expanded} setExpanded={setExpanded} onPatch={patchOffering} onGenerate={generate} onEdit={setEditing} />)}
                </Section>
              )}
              {rejected.length > 0 && (
                <Section title="Not offered" subtitle="Excluded from all content — re-add if this changes" icon={<Ban className="w-4 h-4 text-gray-400" />}>
                  {rejected.map(o => <Row key={o.id} o={o} busyId={busyId} expanded={expanded} setExpanded={setExpanded} onPatch={patchOffering} onGenerate={generate} onEdit={setEditing} />)}
                </Section>
              )}
            </div>
          )}
        </>
      )}

      {/* Add modal */}
      {showAdd && <AddServiceModal businessId={businessId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); fetchData(); showToast('Service added'); }} />}
      {/* Edit modal */}
      {editing && <EditServiceModal offering={editing} onClose={() => setEditing(null)} onSave={async (body) => { await patchOffering(editing.id, body); setEditing(null); showToast('Service updated'); }} />}
    </div>
  );
}

function IndustryCard({ data, matching, onSetIndustry, onAutoMatch }: {
  data: ServicesData; matching: boolean;
  onSetIndustry: (id: string) => void; onAutoMatch: () => void;
}) {
  const matched = data.matchedIndustry;
  const conf = data.business.matchedIndustryConfidence;
  const src = data.business.industryMatchSource;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Industry</div>
            {matched ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-gray-900">{matched.name}</span>
                {conf && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_BADGE[conf] || 'bg-gray-100 text-gray-600'}`}>{conf} confidence</span>}
                {data.business.ownerConfirmedIndustry && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><ShieldCheck className="w-3 h-3" /> Confirmed by you</span>}
              </div>
            ) : (
              <div className="text-base font-semibold text-gray-700">Not matched yet</div>
            )}
            {src && matched && <div className="text-xs text-gray-400 mt-0.5">Matched via {SOURCE_LABEL[src] || src}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!matched && (
            <button onClick={onAutoMatch} disabled={matching} className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {matching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Auto-match
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-xs font-medium text-gray-500">{matched ? 'Change industry:' : 'Or pick manually:'}</label>
        <div className="flex items-center gap-2">
          <select
            value={matched?.id || ''}
            disabled={matching}
            onChange={(e) => e.target.value && onSetIndustry(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          >
            <option value="">Select an industry…</option>
            {data.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {matching && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        <span className="text-xs text-gray-400">— {subtitle}</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({ o, busyId, expanded, setExpanded, onPatch, onGenerate, onEdit }: {
  o: Offering; busyId: string | null;
  expanded: Record<string, boolean>; setExpanded: (fn: any) => void;
  onPatch: (id: string, body: any) => void;
  onGenerate: (id: string, kind: 'page' | 'video') => void;
  onEdit: (o: Offering) => void;
}) {
  const busy = busyId === o.id;
  const isOpen = !!expanded[o.id];
  const isConfirmed = o.status === 'confirmed';
  const isRejected = o.status === 'rejected';
  const hasEvidence = (o.evidence?.length || 0) > 0;

  return (
    <div className={`p-4 ${isRejected ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Confirm checkbox */}
        <button
          onClick={() => onPatch(o.id, { status: isConfirmed ? 'suggested' : 'confirmed' })}
          disabled={busy || isRejected}
          className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
          title={isConfirmed ? 'Unconfirm' : 'Confirm you offer this'}
        >
          {isConfirmed
            ? <CheckCircle2 className="w-5 h-5 text-green-600" />
            : <Circle className="w-5 h-5 text-gray-300 hover:text-blue-500" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold ${isRejected ? 'line-through text-gray-500' : 'text-gray-900'}`}>{o.name}</span>
            {o.priority === 'primary' && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800"><Star className="w-2.5 h-2.5" /> PRIMARY</span>}
            {o.priority === 'do_not_promote' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">DO NOT PROMOTE</span>}
            {o.confidence && !isRejected && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CONFIDENCE_BADGE[o.confidence] || ''}`}>{o.confidence}</span>}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">{SOURCE_LABEL[o.source] || o.source}</span>
          </div>
          {o.shortDescription && <p className="text-sm text-gray-500 mt-0.5">{o.shortDescription}</p>}

          {/* status chips */}
          {isConfirmed && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 border border-gray-200 text-gray-600"><Globe className="w-3 h-3" /> {PAGE_STATUS_LABEL[o.pageStatus] || o.pageStatus}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 border border-gray-200 text-gray-600"><Video className="w-3 h-3" /> {VIDEO_STATUS_LABEL[o.videoStatus] || o.videoStatus}</span>
              {!o.seoEnabled && <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200">SEO off</span>}
            </div>
          )}

          {/* evidence toggle */}
          {hasEvidence && (
            <button onClick={() => setExpanded((p: any) => ({ ...p, [o.id]: !p[o.id] }))} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-2">
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {isOpen ? 'Hide' : 'View'} evidence ({o.evidence.length})
            </button>
          )}
          {isOpen && hasEvidence && (
            <ul className="mt-2 space-y-1 pl-4">
              {o.evidence.map((ev: any, i: number) => (
                <li key={i} className="text-xs text-gray-600 list-disc">
                  {typeof ev === 'string' ? ev : (ev.quote || ev.text || ev.evidence || JSON.stringify(ev))}
                  {ev.source && <span className="text-gray-400"> — {ev.source}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right-side actions */}
        <div className="flex items-center gap-1 shrink-0">
          {busy && <Loader2 className="w-4 h-4 text-blue-600 animate-spin mr-1" />}
          {isConfirmed && (
            <div className="relative group">
              <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Generate"><Sparkles className="w-4 h-4" /></button>
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 hidden group-hover:block">
                <button onClick={() => onGenerate(o.id, 'page')} disabled={busy} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Globe className="w-4 h-4 text-blue-600" /> {o.hasPage ? 'Regenerate page draft' : 'Generate service page'}</button>
                <button onClick={() => onGenerate(o.id, 'video')} disabled={busy} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Video className="w-4 h-4 text-purple-600" /> {o.hasVideoBrief ? 'Regenerate video brief' : 'Generate explainer video'}</button>
              </div>
            </div>
          )}
          <RowMenu o={o} busy={busy} onPatch={onPatch} onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
}

function RowMenu({ o, busy, onPatch, onEdit }: { o: Offering; busy: boolean; onPatch: (id: string, body: any) => void; onEdit: (o: Offering) => void }) {
  const [open, setOpen] = useState(false);
  const isConfirmed = o.status === 'confirmed';
  const isRejected = o.status === 'rejected';
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={busy} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="More">
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20">
            <button onClick={() => { onEdit(o); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Edit3 className="w-4 h-4 text-gray-500" /> Edit name & description</button>
            {isConfirmed && o.priority !== 'primary' && (
              <button onClick={() => { onPatch(o.id, { priority: 'primary' }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Set as primary</button>
            )}
            {isConfirmed && o.priority !== 'secondary' && (
              <button onClick={() => { onPatch(o.id, { priority: 'secondary' }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Circle className="w-4 h-4 text-gray-400" /> Set as secondary</button>
            )}
            {isConfirmed && o.seoEnabled && (
              <button onClick={() => { onPatch(o.id, { priority: 'do_not_promote', seoEnabled: false }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Ban className="w-4 h-4 text-red-500" /> Do not promote</button>
            )}
            {isConfirmed && !o.seoEnabled && (
              <button onClick={() => { onPatch(o.id, { seoEnabled: true, priority: 'secondary' }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><Globe className="w-4 h-4 text-green-600" /> Enable for SEO</button>
            )}
            <div className="border-t border-gray-100 my-1" />
            {!isRejected ? (
              <button onClick={() => { onPatch(o.id, { status: 'rejected' }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"><Ban className="w-4 h-4" /> Mark as not offered</button>
            ) : (
              <button onClick={() => { onPatch(o.id, { status: 'suggested' }); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-gray-500" /> Re-add to list</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AddServiceModal({ businessId, onClose, onAdded }: { businessId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState('secondary');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim()) { setErr('Service name is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), shortDescription: desc.trim() || undefined, priority }),
      });
      if (res.ok) onAdded();
      else { const e = await res.json().catch(() => ({})); setErr(e.error || 'Could not add service'); setSaving(false); }
    } catch { setErr('Could not add service'); setSaving(false); }
  };

  return (
    <Modal title="Add custom service" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Service name *</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Mobile Fleet Servicing" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Short description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="One sentence describing this service" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="optional">Optional</option>
          </select>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add service
        </button>
      </div>
    </Modal>
  );
}

function EditServiceModal({ offering, onClose, onSave }: { offering: Offering; onClose: () => void; onSave: (body: any) => void }) {
  const [name, setName] = useState(offering.name);
  const [desc, setDesc] = useState(offering.shortDescription);
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="Edit service" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Service name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Short description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={() => { setSaving(true); onSave({ name: name.trim(), shortDescription: desc }); }} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
