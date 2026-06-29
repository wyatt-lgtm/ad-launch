'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Lock, LogIn, Search, BarChart3, KeyRound, MapPin, TrendingUp,
  Megaphone, MapPinned, Compass, ArrowLeftRight, Lightbulb, Settings as SettingsIcon,
  Plus, Trash2, Gauge, Upload, FileText,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import BusinessIntelligencePanel from './business-intelligence-panel';
import KeywordUploadModal from './keyword-upload-modal';
import PageBriefsTab from './page-briefs-tab';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }); }
  catch { return '—'; }
}

type Tab =
  | 'overview' | 'keywords' | 'locations' | 'organic' | 'paid'
  | 'localpack' | 'competitors' | 'movements' | 'recommendations' | 'pagebriefs' | 'settings';

export default function SearchIntelligenceManager() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx?.activeBusiness?.id;
  const businessName = bizCtx?.activeBusiness?.businessName;

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [organic, setOrganic] = useState<any>({ history: [], observations: [] });
  const [paidAds, setPaidAds] = useState<any[]>([]);
  const [localPack, setLocalPack] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [providerAccounts, setProviderAccounts] = useState<any[]>([]);

  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const showToast = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3000); };

  const api = (path: string) => `/api/businesses/${businessId}/search-intelligence/${path}`;

  const loadAll = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [ov, kw, loc, org, pd, lp, comp, mov, rec, set] = await Promise.all([
        fetch(api('overview')).then((r) => r.json()),
        fetch(api('keywords')).then((r) => r.json()),
        fetch(api('locations')).then((r) => r.json()),
        fetch(api('organic')).then((r) => r.json()),
        fetch(api('paid')).then((r) => r.json()),
        fetch(api('local-pack')).then((r) => r.json()),
        fetch(api('competitors')).then((r) => r.json()),
        fetch(api('movements')).then((r) => r.json()),
        fetch(api('recommendations')).then((r) => r.json()),
        fetch(api('settings')).then((r) => r.json()),
      ]);
      setOverview(ov || null);
      setKeywords(kw?.keywords || []);
      setLocations(loc?.locations || []);
      setOrganic({ history: org?.history || [], observations: org?.observations || [] });
      setPaidAds(pd?.paidAds || []);
      setLocalPack(lp?.observations || []);
      setCompetitors(comp?.competitors || []);
      setMovements(mov?.movements || []);
      setRecommendations(rec?.recommendations || []);
      setSettings(set?.settings || null);
      setProviderAccounts(set?.providerAccounts || []);
    } catch (e) {
      console.error('[search-intelligence] load error', e);
    }
    setLoading(false);
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (businessId) loadAll(); }, [businessId, loadAll]);

  // ── Actions ────────────────────────────────────────────────────
  const addKeywords = async (raw: string) => {
    const items = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    try {
      const res = await fetch(api('keywords'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: items.map((keyword) => ({ keyword })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      showToast(true, `${json.created} keyword(s) added`);
      await loadAll();
    } catch (e: any) { showToast(false, e.message || 'Failed'); }
  };
  const deleteKeyword = async (kid: string) => {
    try {
      const res = await fetch(api(`keywords/${kid}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      showToast(true, 'Keyword removed'); await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const addLocation = async (payload: any) => {
    try {
      const res = await fetch(api('locations'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      showToast(true, 'Service area added'); await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const deleteLocation = async (lid: string) => {
    try {
      const res = await fetch(api(`locations/${lid}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      showToast(true, 'Service area removed'); await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const addCompetitor = async (payload: any) => {
    try {
      const res = await fetch(api('competitors'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      showToast(true, 'Competitor added'); await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const updateRecommendation = async (id: string, status: string) => {
    try {
      const res = await fetch(api('recommendations'), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast(true, 'Recommendation updated'); await loadAll();
    } catch (e: any) { showToast(false, e.message); }
  };
  const saveSettings = async (patch: any) => {
    try {
      const res = await fetch(api('settings'), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed');
      setSettings(json.settings); showToast(true, 'Settings saved');
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
        <p className="text-gray-500 mb-6">Search intelligence is only available for registered business owners.</p>
        <button onClick={() => router.push('/login')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"><LogIn className="w-4 h-4" /> Log In or Register</button>
      </div>
    );
  }
  if (!businessId) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Selected</h2>
        <p className="text-gray-500 mb-6">Select a business from your dashboard to view search intelligence.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Go to Dashboard</button>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'keywords', label: 'Keywords', icon: KeyRound, count: keywords.length },
    { key: 'locations', label: 'Service Areas', icon: MapPin, count: locations.length },
    { key: 'organic', label: 'Organic', icon: TrendingUp },
    { key: 'paid', label: 'Paid Ads', icon: Megaphone, count: paidAds.length },
    { key: 'localpack', label: 'Local Pack', icon: MapPinned, count: localPack.length },
    { key: 'competitors', label: 'Competitors', icon: Compass, count: competitors.length },
    { key: 'movements', label: 'Movements', icon: ArrowLeftRight, count: movements.length },
    { key: 'recommendations', label: 'Recommendations', icon: Lightbulb, count: recommendations.length },
    { key: 'pagebriefs', label: 'Page Briefs', icon: FileText },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      {toast && (
        <div className={`fixed top-20 right-6 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Search Intelligence</h1>
        </div>
        <p className="text-gray-500 text-sm">{businessName || 'Your Business'}</p>
        <p className="text-gray-600 text-sm mt-3 max-w-3xl">
          Ongoing keyword, rank, paid, local-pack and competitor tracking powered by compliant data
          providers (Ahrefs, Google Search Console, Google Ads, Google Business Profile, approved SERP
          providers and manual import). This runs on a weekly schedule or on demand &mdash; it is separate
          from the preview generation flow.
        </p>
      </div>

      {/* Business Intelligence status panel */}
      <div className="mb-8">
        <BusinessIntelligencePanel businessId={businessId} businessName={businessName ?? undefined} showToast={showToast} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
            {typeof t.count === 'number' && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab overview={overview} />}
          {tab === 'keywords' && <KeywordsTab keywords={keywords} onAdd={addKeywords} onDelete={deleteKeyword} businessId={businessId} onReload={loadAll} showToast={showToast} />}
          {tab === 'locations' && <LocationsTab locations={locations} onAdd={addLocation} onDelete={deleteLocation} />}
          {tab === 'organic' && <OrganicTab data={organic} />}
          {tab === 'paid' && <PaidTab paidAds={paidAds} />}
          {tab === 'localpack' && <LocalPackTab observations={localPack} />}
          {tab === 'competitors' && <CompetitorsTab competitors={competitors} onAdd={addCompetitor} />}
          {tab === 'movements' && <MovementsTab movements={movements} />}
          {tab === 'recommendations' && <RecommendationsTab recommendations={recommendations} onUpdate={updateRecommendation} />}
          {tab === 'pagebriefs' && <PageBriefsTab businessId={businessId} />}
          {tab === 'settings' && <SettingsTab settings={settings} providerAccounts={providerAccounts} onSave={saveSettings} api={api} businessId={businessId} showToast={showToast} />}
        </>
      )}
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────
function EmptyState({ icon: Icon, title, desc }: any) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl py-16 text-center">
      <Icon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{desc}</p>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: any) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────
function OverviewTab({ overview }: any) {
  if (!overview) return <EmptyState icon={BarChart3} title="No data yet" desc="Run search intelligence to populate your visibility metrics." />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Visibility Score" value={overview.visibilityScore ?? '—'} icon={Gauge} />
        <Stat label="Tracked Keywords" value={overview.trackedKeywordCount ?? 0} icon={KeyRound} />
        <Stat label="Service Areas" value={overview.trackedLocationCount ?? 0} icon={MapPin} />
        <Stat label="Competitor Alerts" value={overview.competitorMovementAlerts ?? 0} icon={Compass} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
        <div className="flex items-center justify-between py-1"><span className="text-gray-500">Tracking enabled</span><span>{overview.enabled ? 'Yes' : 'No'}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-gray-500">Last run</span><span>{fmt(overview.lastRunAt)}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-gray-500">Last run status</span><span>{LABEL(overview.lastRunStatus) || '—'}</span></div>
        <div className="flex items-center justify-between py-1"><span className="text-gray-500">Next scheduled run</span><span>{fmt(overview.nextRunAt)}</span></div>
      </div>
    </div>
  );
}

// ── Keywords ────────────────────────────────────────────────────
function KeywordsTab({ keywords, onAdd, onDelete, businessId, onReload, showToast }: any) {
  const [val, setVal] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Add keywords (comma or newline separated)</label>
          <button onClick={() => setUploadOpen(true)} disabled={!businessId}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"><Upload className="w-4 h-4" /> Upload File</button>
        </div>
        <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3}
          placeholder="emergency plumber denver, water heater repair, drain cleaning near me"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end mt-2">
          <button onClick={() => { onAdd(val); setVal(''); }} disabled={!val.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"><Plus className="w-4 h-4" /> Add Keywords</button>
        </div>
      </div>
      {uploadOpen && businessId && (
        <KeywordUploadModal
          businessId={businessId}
          onClose={() => setUploadOpen(false)}
          onImported={() => { onReload?.(); }}
          showToast={showToast}
        />
      )}
      {keywords.length === 0 ? (
        <EmptyState icon={KeyRound} title="No keywords tracked" desc="Add the search terms your customers use. Keywords are also seeded automatically from deep research." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
              <th className="text-left px-4 py-3">Keyword</th><th className="text-left px-4 py-3">Service Line</th>
              <th className="text-left px-4 py-3">Market</th><th className="text-left px-4 py-3">Intent</th>
              <th className="text-left px-4 py-3">Priority</th><th className="text-left px-4 py-3">Source</th>
              <th className="text-left px-4 py-3">Status</th><th className="text-right px-4 py-3">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {keywords.map((k: any) => (
                <tr key={k.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{k.keyword}</td>
                  <td className="px-4 py-3 text-gray-600">{k.serviceLine || '—'}</td>
                  <td className="px-4 py-3">{LABEL(k.marketOrientation)}</td>
                  <td className="px-4 py-3">{LABEL(k.keywordIntent) || '—'}</td>
                  <td className="px-4 py-3">{LABEL(k.priority)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{LABEL(k.source) || '—'}</td>
                  <td className="px-4 py-3">{LABEL(k.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onDelete(k.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Locations ───────────────────────────────────────────────────
function LocationsTab({ locations, onAdd, onDelete }: any) {
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const submit = () => {
    if (!city && !zip && !state) return;
    onAdd({ city: city || undefined, state: state || undefined, zip: zip || undefined, locationType: zip ? 'zip' : 'city' });
    setCity(''); setState(''); setZip('');
  };
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">City</label><input value={city} onChange={(e) => setCity(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Denver" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">State</label><input value={state} onChange={(e) => setState(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24" placeholder="CO" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">ZIP</label><input value={zip} onChange={(e) => setZip(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28" placeholder="80202" /></div>
        <button onClick={submit} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Area</button>
      </div>
      {locations.length === 0 ? (
        <EmptyState icon={MapPin} title="No service areas" desc="Add the cities, ZIPs or counties you serve to track local rankings." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
              <th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">City</th>
              <th className="text-left px-4 py-3">State</th><th className="text-left px-4 py-3">ZIP</th>
              <th className="text-left px-4 py-3">Priority</th><th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {locations.map((l: any) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{LABEL(l.locationType)}</td>
                  <td className="px-4 py-3 text-gray-900">{l.city || '—'}</td>
                  <td className="px-4 py-3">{l.state || '—'}</td>
                  <td className="px-4 py-3">{l.zip || '—'}</td>
                  <td className="px-4 py-3">{LABEL(l.serviceAreaPriority)}</td>
                  <td className="px-4 py-3">{LABEL(l.status)}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => onDelete(l.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Organic ─────────────────────────────────────────────────────
function OrganicTab({ data }: any) {
  const history = data?.history || [];
  if (history.length === 0) return <EmptyState icon={TrendingUp} title="No organic data yet" desc="Organic ranking history will appear here after your first search intelligence run." />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
          <th className="text-left px-4 py-3">Observed</th><th className="text-left px-4 py-3">Your Position</th>
          <th className="text-left px-4 py-3">Rank Bucket</th><th className="text-left px-4 py-3">Best Competitor</th>
          <th className="text-left px-4 py-3">Local Pack</th><th className="text-left px-4 py-3">Source</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {history.map((h: any) => (
            <tr key={h.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">{fmt(h.observedAt)}</td>
              <td className="px-4 py-3 font-medium">{h.selfPosition ?? '—'}</td>
              <td className="px-4 py-3">{LABEL(h.organicRankBucket) || '—'}</td>
              <td className="px-4 py-3">{h.bestCompetitorPosition ?? '—'}</td>
              <td className="px-4 py-3">{h.localPackPosition ?? '—'}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{LABEL(h.dataSource) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Paid ────────────────────────────────────────────────────────
function PaidTab({ paidAds }: any) {
  if (paidAds.length === 0) return <EmptyState icon={Megaphone} title="No paid ads observed" desc="Competitor and your own paid ad observations will appear here after a run." />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
          <th className="text-left px-4 py-3">Observed</th><th className="text-left px-4 py-3">Advertiser</th>
          <th className="text-left px-4 py-3">Headline</th><th className="text-left px-4 py-3">Display URL</th>
          <th className="text-left px-4 py-3">Position</th><th className="text-left px-4 py-3">Self?</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {paidAds.map((a: any) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">{fmt(a.observedAt)}</td>
              <td className="px-4 py-3 font-medium">{a.advertiserName || '—'}</td>
              <td className="px-4 py-3 max-w-xs truncate">{a.headlineText || '—'}</td>
              <td className="px-4 py-3 text-xs text-blue-600">{a.displayUrl || '—'}</td>
              <td className="px-4 py-3">{a.position ?? '—'}</td>
              <td className="px-4 py-3">{a.isSelf ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Local Pack ──────────────────────────────────────────────────
function LocalPackTab({ observations }: any) {
  if (observations.length === 0) return <EmptyState icon={MapPinned} title="No local pack data" desc="Local map pack positions will appear here after a run." />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
          <th className="text-left px-4 py-3">Observed</th><th className="text-left px-4 py-3">Business</th>
          <th className="text-left px-4 py-3">Position</th><th className="text-left px-4 py-3">Match</th>
          <th className="text-left px-4 py-3">Self?</th><th className="text-left px-4 py-3">Source</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {observations.map((o: any) => (
            <tr key={o.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">{fmt(o.observedAt)}</td>
              <td className="px-4 py-3 font-medium">{o.title || o.domain || '—'}</td>
              <td className="px-4 py-3">{o.position ?? '—'}</td>
              <td className="px-4 py-3">{LABEL(o.businessMatchType) || '—'}</td>
              <td className="px-4 py-3">{o.isSelf ? 'Yes' : 'No'}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{LABEL(o.dataSource) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Competitors ─────────────────────────────────────────────────
function CompetitorsTab({ competitors, onAdd }: any) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const submit = () => { if (!name && !domain) return; onAdd({ competitorName: name || domain, domain: domain || undefined }); setName(''); setDomain(''); };
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">Competitor name</label><input value={name} onChange={(e) => setName(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Ace Plumbing" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Domain</label><input value={domain} onChange={(e) => setDomain(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="aceplumbing.com" /></div>
        <button onClick={submit} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Competitor</button>
      </div>
      {competitors.length === 0 ? (
        <EmptyState icon={Compass} title="No competitors tracked" desc="Competitors are discovered during deep research and can also be added manually." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
              <th className="text-left px-4 py-3">Competitor</th><th className="text-left px-4 py-3">Domain</th>
              <th className="text-left px-4 py-3">Source</th><th className="text-left px-4 py-3">First Seen</th>
              <th className="text-left px-4 py-3">Last Seen</th><th className="text-left px-4 py-3">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {competitors.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.competitorName}</td>
                  <td className="px-4 py-3 text-blue-600">{c.domain || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{LABEL(c.source) || '—'}</td>
                  <td className="px-4 py-3">{fmt(c.firstSeenAt)}</td>
                  <td className="px-4 py-3">{fmt(c.lastSeenAt)}</td>
                  <td className="px-4 py-3">{LABEL(c.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Movements ───────────────────────────────────────────────────
function MovementsTab({ movements }: any) {
  if (movements.length === 0) return <EmptyState icon={ArrowLeftRight} title="No movements detected" desc="Competitor rank changes between runs will appear here." />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
          <th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Type</th>
          <th className="text-left px-4 py-3">Previous</th><th className="text-left px-4 py-3">Current</th>
          <th className="text-left px-4 py-3">Summary</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {movements.map((m: any) => (
            <tr key={m.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-xs">{fmt(m.periodStart)} – {fmt(m.periodEnd)}</td>
              <td className="px-4 py-3">{LABEL(m.movementType)}</td>
              <td className="px-4 py-3">{m.previousPosition ?? '—'}</td>
              <td className="px-4 py-3">{m.currentPosition ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{m.changeSummary || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Recommendations ─────────────────────────────────────────────
function RecommendationsTab({ recommendations, onUpdate }: any) {
  if (recommendations.length === 0) return <EmptyState icon={Lightbulb} title="No recommendations" desc="Actionable opportunities will appear here after analysis." />;
  return (
    <div className="space-y-3">
      {recommendations.map((r: any) => (
        <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-gray-900">{r.title}</h4>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{LABEL(r.priority)}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{LABEL(r.recommendationType)}</span>
              </div>
              {r.suggestedAction && <p className="text-sm text-gray-600 mt-1">{r.suggestedAction}</p>}
              <p className="text-xs text-gray-400 mt-1">Status: {LABEL(r.status)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {r.status !== 'done' && <button onClick={() => onUpdate(r.id, 'done')} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">Mark Done</button>}
              {r.status !== 'dismissed' && <button onClick={() => onUpdate(r.id, 'dismissed')} className="px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">Dismiss</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────
function SettingsTab({ settings, providerAccounts, onSave, api, businessId, showToast }: any) {
  const s = settings || {};
  const Toggle = ({ field, label, desc }: { field: string; label: string; desc?: string }) => (
    <label className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div><div className="text-sm font-medium text-gray-800">{label}</div>{desc && <div className="text-xs text-gray-500">{desc}</div>}</div>
      <input type="checkbox" checked={!!s[field]} onChange={(e) => onSave({ [field]: e.target.checked })} className="mt-1 h-4 w-4" />
    </label>
  );

  const PROVIDER_OPTIONS = [
    { value: 'manual_import', label: 'Manual import' },
    { value: 'dataforseo', label: 'DataForSEO (live SEO/SERP)' },
    { value: 'ahrefs', label: 'Ahrefs API' },
    { value: 'google_search_console', label: 'Google Search Console' },
    { value: 'google_ads', label: 'Google Ads API' },
    { value: 'google_business_profile', label: 'Google Business Profile' },
    { value: 'approved_serp_provider', label: 'Approved SERP provider' },
  ];

  // ── DataForSEO provider status ───────────────────────────────
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const loadHealth = useCallback(async () => {
    if (!businessId) return;
    setHealthLoading(true);
    try {
      const res = await fetch(api('provider-health'));
      const data = await res.json();
      setHealth(data?.dataforseo || null);
    } catch { setHealth(null); }
    finally { setHealthLoading(false); }
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadHealth(); }, [loadHealth]);

  const MODE_BADGE: Record<string, { label: string; cls: string }> = {
    disabled: { label: 'Disabled', cls: 'bg-gray-100 text-gray-600' },
    missing_credentials: { label: 'Missing credentials', cls: 'bg-amber-100 text-amber-700' },
    sandbox: { label: 'Sandbox enabled', cls: 'bg-blue-100 text-blue-700' },
    live: { label: 'Live enabled', cls: 'bg-green-100 text-green-700' },
  };
  const badge = health ? (MODE_BADGE[health.mode] || MODE_BADGE.disabled) : null;

  // Most-recent-request classification badge (distinct from connection mode).
  const REQUEST_STATE_BADGE: Record<string, { label: string; cls: string }> = {
    never: { label: 'No request yet', cls: 'bg-gray-100 text-gray-600' },
    ok_results: { label: 'API OK · results', cls: 'bg-green-100 text-green-700' },
    ok_zero_items: { label: 'API OK · 0 items', cls: 'bg-amber-100 text-amber-700' },
    error: { label: 'API error', cls: 'bg-red-100 text-red-700' },
    disabled: { label: 'Disabled', cls: 'bg-gray-100 text-gray-600' },
    missing_credentials: { label: 'Missing credentials', cls: 'bg-amber-100 text-amber-700' },
  };
  const reqBadge = health?.requestState ? (REQUEST_STATE_BADGE[health.requestState] || null) : null;

  // ── Manual test search ───────────────────────────────────────
  const [kw, setKw] = useState('transmission flush');
  const [loc, setLoc] = useState('Houston, TX');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const runTest = async () => {
    if (!kw.trim()) { showToast?.(false, 'Enter a keyword to test'); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(api('test-run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw.trim(), location: loc.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        showToast?.(false, data?.error || 'Test search failed');
        setTestResult({ error: data?.error || 'Test search failed' });
      } else {
        setTestResult(data);
        showToast?.(true, `Test run complete — ${(data.observations || []).length} result(s)`);
      }
      loadHealth();
    } catch (e: any) {
      showToast?.(false, 'Test search failed');
      setTestResult({ error: String(e?.message || e) });
    } finally { setTesting(false); }
  };

  const organicResults = (testResult?.observations || []).filter((o: any) => o.resultType === 'organic');
  const paidResults = (testResult?.observations || []).filter((o: any) => o.resultType === 'paid_ad');
  const otherResults = (testResult?.observations || []).filter((o: any) => o.resultType !== 'organic' && o.resultType !== 'paid_ad');

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-2">Tracking</h3>
        <Toggle field="enabled" label="Enable ongoing search intelligence" desc="Run weekly tracking and keep historical data fresh." />
        <Toggle field="includeOrganic" label="Track organic rankings" />
        <Toggle field="includePaidAds" label="Track paid ads" />
        <Toggle field="includeLocalPack" label="Track local map pack" />
        <Toggle field="includeCompetitors" label="Track competitors" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-2">Active data provider</h3>
        <p className="text-xs text-gray-500 mb-3">The provider used when a search intelligence run executes. Providers without configured credentials are skipped gracefully.</p>
        <select
          value={s.defaultProvider || 'manual_import'}
          onChange={(e) => onSave({ defaultProvider: e.target.value })}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
        >
          {PROVIDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* DataForSEO status + manual test */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900">DataForSEO</h3>
          {badge && <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>}
        </div>
        {healthLoading && !health ? (
          <div className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Checking status…</div>
        ) : health ? (
          <div className="text-sm text-gray-600 space-y-1">
            <div>{health.message}</div>
            {/* Most-recent-request status — reflects the latest call, not a stale error. */}
            {reqBadge && (
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${reqBadge.cls}`}>{reqBadge.label}</span>
                {health.lastProviderStatusCode != null && (
                  <span className="text-xs text-gray-400">status {health.lastProviderStatusCode}</span>
                )}
                {health.lastRequestAt && (
                  <span className="text-xs text-gray-400">{fmt(health.lastRequestAt)}</span>
                )}
              </div>
            )}
            {health.lastRequestSummary && (
              <div className={`text-xs mt-1 ${health.requestState === 'error' ? 'text-red-500' : health.requestState === 'ok_zero_items' ? 'text-amber-600' : 'text-gray-500'}`}>
                {health.lastRequestSummary}
                {(health.lastRequestKeyword || health.lastRequestLocation) && (
                  <span className="text-gray-400"> (“{health.lastRequestKeyword}” — {health.lastRequestLocation})</span>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500 mt-2">
              <div>Last successful request: <span className="text-gray-700">{fmt(health.lastSuccessAt)}</span></div>
              <div>Last error: <span className="text-gray-700">{fmt(health.lastErrorAt)}</span></div>
              <div className="sm:col-span-2">Credentials: <span className="text-gray-700">{health.credentialsRef}</span></div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">Status unavailable.</div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="text-sm font-medium text-gray-800 mb-2">Run a test search</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs text-gray-500 mb-1">Keyword</label>
              <input value={kw} onChange={(e) => setKw(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full" placeholder="transmission flush" />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <input value={loc} onChange={(e) => setLoc(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full" placeholder="Houston, TX" />
            </div>
            <div className="sm:col-span-1 flex items-end">
              <button onClick={runTest} disabled={testing} className="inline-flex items-center justify-center gap-2 bg-gray-900 text-white text-sm font-medium rounded-lg px-4 py-2 w-full disabled:opacity-50">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {testing ? 'Running…' : 'Run test'}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">Language: en. One keyword × one location. Results below reflect the active provider &amp; sandbox/live mode.</p>

          {testResult?.error && <div className="mt-3 text-sm text-red-600">{testResult.error}</div>}

          {testResult && !testResult.error && (
            <div className="mt-4 space-y-4">
              <div className="text-xs text-gray-500">
                Provider: <span className="text-gray-700">{LABEL(testResult.providerType)}</span>
                {testResult.isSandbox && <span className="ml-2 inline-block bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Sandbox / test data</span>}
                {!testResult.health?.configured && <span className="ml-2 text-amber-600">{testResult.health?.message}</span>}
              </div>
              <SerpAuditPanel meta={testResult.meta} />

              <ResultBlock title={`Organic results (${organicResults.length})`} rows={organicResults} />
              <ResultBlock title={`Paid ads (${paidResults.length})`} rows={paidResults} />
              {otherResults.length > 0 && <ResultBlock title={`Other features (${otherResults.length})`} rows={otherResults} />}
              {(testResult.observations || []).length === 0 && (
                <div className="text-sm text-gray-400">No results returned{testResult.isSandbox ? ' (sandbox responses are often empty).' : '.'}</div>
              )}
              <ManualNoteForm
                api={api}
                runId={testResult.runId ?? null}
                keyword={kw.trim()}
                location={loc.trim()}
                showToast={showToast}
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-2">Other data sources</h3>
        <p className="text-xs text-gray-500 mb-3">Enable the compliant data sources you have access to. Providers without configured credentials are skipped gracefully.</p>
        <Toggle field="includeAhrefs" label="Ahrefs API" desc="Keyword & backlink data via the Ahrefs (hrefs) API." />
        <Toggle field="includeSearchConsole" label="Google Search Console" />
        <Toggle field="includeGoogleAds" label="Google Ads API" />
        {providerAccounts && providerAccounts.length > 0 && (
          <div className="mt-4 text-xs text-gray-600">
            <div className="font-medium text-gray-700 mb-1">Connected accounts</div>
            {providerAccounts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between py-1 border-t border-gray-100">
                <span>{LABEL(p.provider)}</span><span className="text-gray-400">{LABEL(p.status) || 'configured'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Schedule</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Weekly run day</label>
            <select value={s.weeklyRunDay ?? 1} onChange={(e) => onSave({ weeklyRunDay: parseInt(e.target.value, 10) })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full">
              {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Run time (HH:MM)</label>
            <input value={s.weeklyRunTime || '03:00'} onChange={(e) => onSave({ weeklyRunTime: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full" placeholder="03:00" />
          </div>
        </div>
      </div>
    </div>
  );
}

const RESULT_TYPE_LABEL: Record<string, string> = {
  organic: 'Organic',
  paid_ad: 'Paid ad',
  local_pack: 'Local pack',
  map_result: 'Map result',
  featured_snippet: 'Featured snippet',
  people_also_ask: 'People also ask',
  related_searches: 'Related searches',
  shopping: 'Shopping',
  video: 'Video',
  image: 'Images',
  ai_overview: 'AI overview',
  unknown: 'Other',
};

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
      }}
      className="ml-1 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Provider audit / verification panel. Surfaces the DataForSEO request id
 * (copyable), the check_url (openable to re-inspect the SERP), the captured
 * datetime, resolved location code/name, device, language, status and cost so
 * each test run is independently verifiable. Treats results as an observed
 * snapshot of the SERP at a point in time — not a single absolute ranking truth.
 */
function SerpAuditPanel({ meta }: { meta: any }) {
  if (!meta) return null;
  const taskId: string | null = meta.taskId ?? meta.providerTaskId ?? null;
  const checkUrl: string | null = meta.checkUrl ?? null;
  const datetime: string | null = meta.providerDatetime ?? null;
  const locName: string | null = meta.locationName ?? meta.resolvedLocation?.location_name ?? null;
  const locCode: number | null =
    (typeof meta.locationCode === 'number' ? meta.locationCode : null) ??
    meta.resolvedLocation?.location_code ?? null;
  const device: string | null = meta.device ?? null;
  const language: string | null = meta.languageCode ?? null;
  const statusCode: number | null =
    (typeof meta.taskStatusCode === 'number' ? meta.taskStatusCode : null) ??
    (typeof meta.topStatusCode === 'number' ? meta.topStatusCode : null);
  const cost: number | null =
    (typeof meta.providerCost === 'number' ? meta.providerCost : null) ??
    (typeof meta.cost === 'number' ? meta.cost : null);
  const serpItemTypes: Record<string, number> | null =
    meta.serpItemTypes && typeof meta.serpItemTypes === 'object' ? meta.serpItemTypes : null;

  const hasAny = taskId || checkUrl || datetime || locName || statusCode != null;
  if (!hasAny) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-700">Provider verification</div>
        <span className="text-[10px] text-gray-400">Observed SERP snapshot — not an absolute ranking truth</span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs text-gray-500 sm:grid-cols-2">
        {taskId && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Task ID</span>
            <code className="select-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{taskId}</code>
            <CopyButton value={taskId} />
          </div>
        )}
        {checkUrl && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Check URL</span>
            <a href={checkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Open SERP</a>
            <CopyButton value={checkUrl} />
          </div>
        )}
        {datetime && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Captured at</span>
            <span className="text-gray-700">{datetime}</span>
          </div>
        )}
        {locName && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Location</span>
            <span className="text-gray-700">{locName}{locCode != null ? ` (code ${locCode})` : ''}</span>
          </div>
        )}
        {device && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Device</span>
            <span className="text-gray-700">{device}</span>
          </div>
        )}
        {language && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Language</span>
            <span className="text-gray-700">{language}</span>
          </div>
        )}
        {statusCode != null && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Provider status</span>
            <span className="text-gray-700">{statusCode}</span>
          </div>
        )}
        {cost != null && (
          <div className="flex items-center">
            <span className="w-28 shrink-0 text-gray-400">Cost</span>
            <span className="text-gray-700">${cost.toFixed(4)}</span>
          </div>
        )}
      </div>
      {serpItemTypes && Object.keys(serpItemTypes).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-gray-400">SERP item types:</span>
          {Object.entries(serpItemTypes).map(([t, n]) => (
            <span key={t} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px] text-gray-600">
              {(RESULT_TYPE_LABEL[t] || t)} · {n as number}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Manual comparison note. Lets an admin record an observation made manually
 * (e.g. "my local browser showed different local-pack results"). This records
 * a human observation only — it performs no scraping or automated fetching.
 */
function ManualNoteForm({ api, runId, keyword, location, showToast }: {
  api: (p: string) => string; runId: string | null; keyword: string; location: string;
  showToast?: (ok: boolean, msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const q = runId ? `manual-notes?runId=${encodeURIComponent(runId)}` : 'manual-notes';
      const res = await fetch(api(q));
      const data = await res.json();
      if (res.ok && Array.isArray(data?.notes)) setSaved(data.notes);
    } catch { /* ignore */ }
  }, [api, runId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const submit = async () => {
    if (!notes.trim()) { showToast?.(false, 'Enter a note to save'); return; }
    setSaving(true);
    try {
      const res = await fetch(api('manual-notes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId, keyword, location,
          manualNotes: notes.trim(),
          manualObservedAt: observedAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        showToast?.(false, data?.error || 'Could not save note');
      } else {
        showToast?.(true, 'Manual comparison note saved');
        setNotes(''); setObservedAt('');
        load();
      }
    } catch (e: any) {
      showToast?.(false, 'Could not save note');
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-gray-700 hover:text-gray-900">
        {open ? '−' : '+'} Manual comparison note
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-gray-400">
            Record what you observed manually (e.g. a different local browser result). This stores a human observation only — it does not fetch or scrape Google.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. My local browser in Houston showed rjsrepair.com in the local pack at position 2, but this run did not."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-gray-400">Observed at</label>
            <input
              type="datetime-local"
              value={observedAt}
              onChange={(e) => setObservedAt(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="ml-auto rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
          {saved.length > 0 && (
            <div className="mt-2 space-y-2">
              {saved.map((n: any) => (
                <div key={n.id} className="rounded border border-gray-100 bg-gray-50 p-2 text-[11px] text-gray-600">
                  <div className="whitespace-pre-wrap text-gray-700">{n.manualNotes}</div>
                  <div className="mt-1 text-gray-400">
                    {n.keyword ? `“${n.keyword}” · ` : ''}{n.location ? `${n.location} · ` : ''}
                    observed {n.manualObservedAt ? new Date(n.manualObservedAt).toLocaleString('en-US') : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultBlock({ title, rows }: { title: string; rows: any[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <div className="text-sm font-medium text-gray-800 mb-2">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="py-1 pr-3" title="Position within its own result block (e.g. organic rank)">Group rank</th>
              <th className="py-1 pr-3" title="Absolute position across all SERP blocks">Absolute pos</th>
              <th className="py-1 pr-3">Result type</th>
              <th className="py-1 pr-3">Domain</th>
              <th className="py-1 pr-3">Title</th>
              <th className="py-1 pr-3">URL</th>
              <th className="py-1 pr-3">Self</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => {
              const grp = r.rankGroup ?? null;
              const abs = r.rankAbsolute ?? (typeof r.position === 'number' ? r.position : null);
              return (
                <tr key={i} className="border-b border-gray-50 align-top">
                  <td className="py-1 pr-3 text-gray-500">{grp ?? '—'}</td>
                  <td className="py-1 pr-3 text-gray-500">{abs ?? '—'}</td>
                  <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">{RESULT_TYPE_LABEL[r.resultType] || r.resultType || '—'}</td>
                  <td className="py-1 pr-3 text-gray-700 whitespace-nowrap">{r.domain || '—'}</td>
                  <td className="py-1 pr-3 text-gray-700 max-w-xs truncate">{r.title || '—'}</td>
                  <td className="py-1 pr-3 text-blue-600 max-w-xs truncate">{r.url || '—'}</td>
                  <td className="py-1 pr-3">{r.isSelf ? <span className="text-green-600 font-medium">Yes</span> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}