'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Lock, LogIn, Crosshair, Plus, Target, Users, Map, Activity,
  Edit3, Archive, CheckCircle2, Ban, Copy, ShieldCheck, AlertTriangle, Trash2,
  X,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import PixelModal, { PixelDraft, EMPTY_PIXEL } from './pixel-modal';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-600',
  draft: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  needs_verification: 'bg-orange-100 text-orange-800',
  archived: 'bg-gray-100 text-gray-400',
};

const VERIFY_BADGE: Record<string, string> = {
  verified: 'bg-green-100 text-green-800',
  unverified: 'bg-gray-100 text-gray-500',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

type Tab = 'pixels' | 'events' | 'audiences' | 'rules' | 'activity';

export default function TrackingPixelsManager() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx?.activeBusiness?.id;
  const businessName = bizCtx?.activeBusiness?.businessName;

  const [tab, setTab] = useState<Tab>('pixels');
  const [loading, setLoading] = useState(true);
  const [pixels, setPixels] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [eventTemplates, setEventTemplates] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [audienceTemplates, setAudienceTemplates] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [routeTemplates, setRouteTemplates] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const showToast = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3000); };

  const [pixelModalOpen, setPixelModalOpen] = useState(false);
  const [pixelDraft, setPixelDraft] = useState<PixelDraft>(EMPTY_PIXEL);
  const [saving, setSaving] = useState(false);

  const api = (path: string) => `/api/businesses/${businessId}/${path}`;

  const loadAll = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [px, ev, au, rt, ad] = await Promise.all([
        fetch(api('tracking-pixels')).then((r) => r.json()),
        fetch(api('tracking-events')).then((r) => r.json()),
        fetch(api('tracking-audiences')).then((r) => r.json()),
        fetch(api('tracking-routes')).then((r) => r.json()),
        fetch(api('tracking-audit')).then((r) => r.json()),
      ]);
      setPixels(px?.pixels || []);
      setEvents(ev?.events || []); setEventTemplates(ev?.templates || []);
      setAudiences(au?.audiences || []); setAudienceTemplates(au?.templates || []);
      setRoutes(rt?.routes || []); setRouteTemplates(rt?.templates || []);
      setAudit(ad?.events || []);
    } catch (e) {
      console.error('[tracking] load error', e);
    }
    setLoading(false);
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (businessId) loadAll(); }, [businessId, loadAll]);

  // ── Pixel actions ──────────────────────────────────────────────
  const openAddPixel = () => { setPixelDraft({ ...EMPTY_PIXEL }); setPixelModalOpen(true); };
  const openEditPixel = (p: any) => {
    setPixelDraft({ ...EMPTY_PIXEL, ...p, id: p.id, scriptSnippet: p.scriptSnippet || '' });
    setPixelModalOpen(true);
  };
  const savePixel = async (draft: PixelDraft) => {
    setSaving(true);
    try {
      const isEdit = !!draft.id;
      const url = isEdit ? api(`tracking-pixels/${draft.id}`) : api('tracking-pixels');
      const res = await fetch(url, { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      showToast(true, isEdit ? 'Pixel updated' : 'Pixel added');
      setPixelModalOpen(false);
      await loadAll();
    } catch (e: any) { showToast(false, e.message || 'Failed to save pixel'); }
    setSaving(false);
  };
  const pixelAction = async (p: any, action: string) => {
    try {
      const res = await fetch(api(`tracking-pixels/${p.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      showToast(true, `Pixel ${action}d`);
      await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const archivePixel = async (p: any) => {
    if (!confirm(`Archive pixel "${p.name}"?`)) return;
    try {
      const res = await fetch(api(`tracking-pixels/${p.id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      showToast(true, 'Pixel archived');
      await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const copySnippet = (p: any) => {
    const snippet = p.scriptSnippet || `${LABEL(p.platform)} pixel ID: ${p.pixelId || p.ga4MeasurementId || p.metaPixelId || p.gtmContainerId || 'n/a'}`;
    navigator.clipboard?.writeText(snippet).then(() => showToast(true, 'Snippet copied'), () => showToast(false, 'Copy failed'));
  };

  // ── Generic template add ───────────────────────────────────────
  const addTemplate = async (resource: string, templateKey: string) => {
    try {
      const res = await fetch(api(resource), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateKey }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      showToast(true, 'Added');
      await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const deleteResource = async (resource: string, id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const res = await fetch(api(`${resource}/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      showToast(true, 'Deleted');
      await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };

  // ── Auth gates ─────────────────────────────────────────────────
  if (sessionStatus === 'loading') {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>;
  }
  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-500 mb-6">Tracking pixels are only available for registered business owners.</p>
        <button onClick={() => router.push('/login')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"><LogIn className="w-4 h-4" /> Log In or Register</button>
      </div>
    );
  }
  if (!businessId) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Crosshair className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Selected</h2>
        <p className="text-gray-500 mb-6">Select a business from your dashboard to manage tracking pixels.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Go to Dashboard</button>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: 'pixels', label: 'Pixels', icon: Crosshair, count: pixels.length },
    { key: 'events', label: 'Events', icon: Target, count: events.length },
    { key: 'audiences', label: 'Audiences', icon: Users, count: audiences.length },
    { key: 'rules', label: 'Page Rules', icon: Map, count: routes.length },
    { key: 'activity', label: 'Activity', icon: Activity, count: audit.length },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      {toast && (
        <div className={`fixed top-20 right-6 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Crosshair className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Tracking Pixels</h1>
        </div>
        <p className="text-gray-500 text-sm">{businessName || 'Your Business'}</p>
        <p className="text-gray-600 text-sm mt-3 max-w-3xl">
          A centralized, business-scoped system for every website, landing page, thank-you page, ad,
          social and retargeting pixel. Configure base pixels, funnel events, and retargeting audiences
          so generated pages know exactly what conversion tracking to install.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
      ) : (
        <>
          {tab === 'pixels' && (
            <PixelsTab pixels={pixels} onAdd={openAddPixel} onEdit={openEditPixel} onAction={pixelAction} onArchive={archivePixel} onCopy={copySnippet} />
          )}
          {tab === 'events' && (
            <EventsTab events={events} templates={eventTemplates} onAddTemplate={(k: string) => addTemplate('tracking-events', k)} onDelete={(id: string, n: string) => deleteResource('tracking-events', id, n)} businessId={businessId} onRefresh={loadAll} showToast={showToast} />
          )}
          {tab === 'audiences' && (
            <AudiencesTab audiences={audiences} templates={audienceTemplates} onAddTemplate={(k: string) => addTemplate('tracking-audiences', k)} onDelete={(id: string, n: string) => deleteResource('tracking-audiences', id, n)} />
          )}
          {tab === 'rules' && (
            <RulesTab routes={routes} templates={routeTemplates} onAddTemplate={(k: string) => addTemplate('tracking-routes', k)} onDelete={(id: string, n: string) => deleteResource('tracking-routes', id, n)} />
          )}
          {tab === 'activity' && <ActivityTab audit={audit} />}
        </>
      )}

      {pixelModalOpen && (
        <PixelModal initial={pixelDraft} saving={saving} onClose={() => setPixelModalOpen(false)} onSave={savePixel} />
      )}
    </div>
  );
}

// ── Pixels tab ───────────────────────────────────────────────────
function PixelsTab({ pixels, onAdd, onEdit, onAction, onArchive, onCopy }: any) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{pixels.length} pixel{pixels.length === 1 ? '' : 's'} configured</p>
        <button onClick={onAdd} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Pixel</button>
      </div>
      {pixels.length === 0 ? (
        <EmptyState icon={Crosshair} title="No pixels yet" desc="Add your first tracking pixel — Meta, GA4, Google Tag Manager, Choozle or custom." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Platform</th>
                <th className="text-left px-4 py-3">Pixel / Tag ID</th>
                <th className="text-left px-4 py-3">Method</th>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Consent</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Verified</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pixels.map((p: any) => {
                const idVal = p.pixelId || p.ga4MeasurementId || p.metaPixelId || p.gtmContainerId || p.googleTagId || p.tiktokPixelId || p.choozlePixelId || '—';
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-4 py-3">{LABEL(p.platform)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{idVal}</td>
                    <td className="px-4 py-3">{LABEL(p.trackingMethod)}</td>
                    <td className="px-4 py-3 text-xs">{LABEL(p.scope)}</td>
                    <td className="px-4 py-3 text-xs">{LABEL(p.consentCategory)}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status] || 'bg-gray-100'}`}>{LABEL(p.status)}</span></td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${VERIFY_BADGE[p.verificationStatus] || 'bg-gray-100'}`}>{LABEL(p.verificationStatus)}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="Verify" onClick={() => onAction(p, 'verify')}><ShieldCheck className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Copy snippet" onClick={() => onCopy(p)}><Copy className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Edit" onClick={() => onEdit(p)}><Edit3 className="w-4 h-4" /></IconBtn>
                        {p.status === 'active'
                          ? <IconBtn title="Disable" onClick={() => onAction(p, 'disable')}><Ban className="w-4 h-4" /></IconBtn>
                          : <IconBtn title="Enable" onClick={() => onAction(p, 'enable')}><CheckCircle2 className="w-4 h-4" /></IconBtn>}
                        <IconBtn title="Archive" onClick={() => onArchive(p)}><Archive className="w-4 h-4" /></IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Events tab ───────────────────────────────────────────────────
function EventsTab({ events, templates, onAddTemplate, onDelete, businessId, onRefresh, showToast }: any) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ eventName: '', eventType: 'custom', triggerType: 'page_load', pageScope: 'all_pages', consentCategory: 'analytics' });
  const [saving, setSaving] = useState(false);
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none';

  const submit = async () => {
    if (!form.eventName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/tracking-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed');
      showToast(true, 'Event added'); setAdding(false); setForm({ eventName: '', eventType: 'custom', triggerType: 'page_load', pageScope: 'all_pages', consentCategory: 'analytics' });
      await onRefresh();
    } catch (e: any) { showToast(false, e.message); }
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Quick add from templates</p>
        <div className="flex flex-wrap gap-2">
          {templates.map((t: any) => (
            <button key={t.key} onClick={() => onAddTemplate(t.key)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:border-blue-400 hover:text-blue-700"><Plus className="w-3 h-3" /> {t.label}</button>
          ))}
          <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"><Plus className="w-3 h-3" /> Custom Event</button>
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input className={inputCls} placeholder="Event name (e.g. quote_request)" value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} />
          <select className={inputCls} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
            {['page_view', 'lead', 'conversion', 'click', 'form', 'phone', 'email', 'purchase', 'custom'].map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
          </select>
          <select className={inputCls} value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
            {['page_load', 'url_match', 'form_submit', 'button_click', 'phone_link_click', 'email_link_click', 'thank_you_page_load', 'custom_js', 'server_event', 'webhook_event'].map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
          </select>
          <select className={inputCls} value={form.pageScope} onChange={(e) => setForm({ ...form, pageScope: e.target.value })}>
            {['all_pages', 'landing_pages', 'social_landing_pages', 'thank_you_pages', 'service_pages', 'blog_pages'].map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
          </select>
          <select className={inputCls} value={form.consentCategory} onChange={(e) => setForm({ ...form, consentCategory: e.target.value })}>
            {['essential', 'analytics', 'advertising', 'remarketing', 'conversion_tracking'].map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Add</button>
            <button onClick={() => setAdding(false)} className="text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <EmptyState icon={Target} title="No events yet" desc="Add funnel events like landing_page_view, thank_you_page_view, lead and form_submit." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Event Name</th>
                <th className="text-left px-4 py-3">Platform Name</th>
                <th className="text-left px-4 py-3">Trigger</th>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Consent</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e: any) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 font-mono text-xs">{e.eventName}</td>
                  <td className="px-4 py-3 text-xs">{e.platformEventName || '—'}</td>
                  <td className="px-4 py-3 text-xs">{LABEL(e.triggerType)}</td>
                  <td className="px-4 py-3 text-xs">{LABEL(e.pageScope)}</td>
                  <td className="px-4 py-3 text-xs">{e.requiresConsent ? LABEL(e.consentCategory) : 'Not required'}</td>
                  <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[e.status] || 'bg-gray-100'}`}>{LABEL(e.status)}</span></td>
                  <td className="px-4 py-3 text-right"><IconBtn title="Delete" onClick={() => onDelete(e.id, e.eventName)}><Trash2 className="w-4 h-4" /></IconBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Audiences tab ────────────────────────────────────────────────
function AudiencesTab({ audiences, templates, onAddTemplate, onDelete }: any) {
  return (
    <div>
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Quick add from templates</p>
        <div className="flex flex-wrap gap-2">
          {templates.map((t: any) => (
            <button key={t.key} onClick={() => onAddTemplate(t.key)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:border-blue-400 hover:text-blue-700"><Plus className="w-3 h-3" /> {t.label}</button>
          ))}
        </div>
      </div>
      {audiences.length === 0 ? (
        <EmptyState icon={Users} title="No audiences yet" desc="Define retargeting and exclusion audiences — e.g. Landing Page Visitors - No Conversion, Converted Leads." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Audience</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Source Event</th>
                <th className="text-left px-4 py-3">Include</th>
                <th className="text-left px-4 py-3">Exclude</th>
                <th className="text-left px-4 py-3">Retention</th>
                <th className="text-left px-4 py-3">Funnel</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {audiences.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{a.audienceName}</td>
                  <td className="px-4 py-3 text-xs">{LABEL(a.audienceType)}</td>
                  <td className="px-4 py-3 text-xs font-mono">{a.sourceEvent || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(a.includeRulesJson?.events || []).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(a.excludeRulesJson?.events || []).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs">{a.retentionDays}d</td>
                  <td className="px-4 py-3 text-xs">{LABEL(a.funnelStage) || '—'}</td>
                  <td className="px-4 py-3 text-right"><IconBtn title="Delete" onClick={() => onDelete(a.id, a.audienceName)}><Trash2 className="w-4 h-4" /></IconBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page Rules tab ───────────────────────────────────────────────
function RulesTab({ routes, templates, onAddTemplate, onDelete }: any) {
  return (
    <div>
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Quick add default routing</p>
        <div className="flex flex-wrap gap-2">
          {templates.map((t: any) => (
            <button key={t.key} onClick={() => onAddTemplate(t.key)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:border-blue-400 hover:text-blue-700"><Plus className="w-3 h-3" /> {t.label}</button>
          ))}
        </div>
      </div>
      {routes.length === 0 ? (
        <EmptyState icon={Map} title="No page rules yet" desc="Define which events fire on which page types — landing pages, social landing pages, thank-you pages." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Page Type</th>
                <th className="text-left px-4 py-3">URL Pattern</th>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Platforms</th>
                <th className="text-left px-4 py-3">Fires On</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {routes.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{LABEL(r.pageType)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">{r.pageUrlPattern || '(all)'}</td>
                  <td className="px-4 py-3 text-xs font-mono">{r.eventName}</td>
                  <td className="px-4 py-3 text-xs">{Array.isArray(r.platformsJson) ? r.platformsJson.map((x: string) => LABEL(x)).join(', ') : '—'}</td>
                  <td className="px-4 py-3 text-xs">{LABEL(r.firesOn)}</td>
                  <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-gray-100'}`}>{LABEL(r.status)}</span></td>
                  <td className="px-4 py-3 text-right"><IconBtn title="Delete" onClick={() => onDelete(r.id, r.eventName)}><Trash2 className="w-4 h-4" /></IconBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Activity tab ─────────────────────────────────────────────────
function ActivityTab({ audit }: any) {
  if (!audit.length) return <EmptyState icon={Activity} title="No activity yet" desc="Pixel create/update/disable/verify events will appear here." />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
      {audit.map((a: any) => (
        <div key={a.id} className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5"><Activity className="w-4 h-4 text-gray-400" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900"><span className="font-semibold">{LABEL(a.action)}</span>{a.detailsJson?.name ? ` — ${a.detailsJson.name}` : ''}</p>
            {a.detailsJson && <p className="text-xs text-gray-400 truncate">{JSON.stringify(a.detailsJson)}</p>}
          </div>
          <div className="text-xs text-gray-400 whitespace-nowrap">{new Date(a.createdAt).toLocaleString('en-US')}</div>
        </div>
      ))}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────
function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={title} onClick={onClick} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">{children}</button>;
}

function EmptyState({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl py-16 text-center">
      <Icon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <h3 className="text-base font-semibold text-gray-700">{title}</h3>
      <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">{desc}</p>
    </div>
  );
}
