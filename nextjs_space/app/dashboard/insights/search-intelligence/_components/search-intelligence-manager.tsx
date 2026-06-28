'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Lock, LogIn, Search, BarChart3, KeyRound, MapPin, TrendingUp,
  Megaphone, MapPinned, Compass, ArrowLeftRight, Lightbulb, Settings as SettingsIcon,
  Plus, Trash2, Gauge,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import BusinessIntelligencePanel from './business-intelligence-panel';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }); }
  catch { return '—'; }
}

type Tab =
  | 'overview' | 'keywords' | 'locations' | 'organic' | 'paid'
  | 'localpack' | 'competitors' | 'movements' | 'recommendations' | 'settings';

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
          {tab === 'keywords' && <KeywordsTab keywords={keywords} onAdd={addKeywords} onDelete={deleteKeyword} />}
          {tab === 'locations' && <LocationsTab locations={locations} onAdd={addLocation} onDelete={deleteLocation} />}
          {tab === 'organic' && <OrganicTab data={organic} />}
          {tab === 'paid' && <PaidTab paidAds={paidAds} />}
          {tab === 'localpack' && <LocalPackTab observations={localPack} />}
          {tab === 'competitors' && <CompetitorsTab competitors={competitors} onAdd={addCompetitor} />}
          {tab === 'movements' && <MovementsTab movements={movements} />}
          {tab === 'recommendations' && <RecommendationsTab recommendations={recommendations} onUpdate={updateRecommendation} />}
          {tab === 'settings' && <SettingsTab settings={settings} providerAccounts={providerAccounts} onSave={saveSettings} />}
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
function KeywordsTab({ keywords, onAdd, onDelete }: any) {
  const [val, setVal] = useState('');
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Add keywords (comma or newline separated)</label>
        <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3}
          placeholder="emergency plumber denver, water heater repair, drain cleaning near me"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end mt-2">
          <button onClick={() => { onAdd(val); setVal(''); }} disabled={!val.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"><Plus className="w-4 h-4" /> Add Keywords</button>
        </div>
      </div>
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
function SettingsTab({ settings, providerAccounts, onSave }: any) {
  const s = settings || {};
  const Toggle = ({ field, label, desc }: { field: string; label: string; desc?: string }) => (
    <label className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div><div className="text-sm font-medium text-gray-800">{label}</div>{desc && <div className="text-xs text-gray-500">{desc}</div>}</div>
      <input type="checkbox" checked={!!s[field]} onChange={(e) => onSave({ [field]: e.target.checked })} className="mt-1 h-4 w-4" />
    </label>
  );
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
        <h3 className="font-semibold text-gray-900 mb-2">Data Providers</h3>
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
