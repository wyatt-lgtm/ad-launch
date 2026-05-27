'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertTriangle, Brain, BookOpen, MapPin,
  Activity, ChevronDown, ChevronUp, RefreshCw, Database,
} from 'lucide-react';

// ── helpers ──
function api(endpoint: string) {
  return fetch(`/api/admin/defensibility?endpoint=${encodeURIComponent(endpoint)}`, { cache: 'no-store' }).then(r => r.json());
}
function apiPost(endpoint: string, body: object = {}) {
  return fetch(`/api/admin/defensibility?endpoint=${encodeURIComponent(endpoint)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

// ── PlaybooksSection ──
function PlaybooksSection() {
  const [playbooks, setPlaybooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api('/industry-playbooks')
      .then(d => setPlaybooks(d.playbooks || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    await apiPost('/seed-playbooks');
    await load();
    setSeeding(false);
  };

  if (loading) return <div className="flex items-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /><span className="ml-2 text-gray-500">Loading playbooks…</span></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5 text-indigo-600" /> Industry Playbooks ({playbooks.length})</h3>
        <button onClick={seed} disabled={seeding} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
          {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
          {seeding ? 'Seeding…' : 'Seed All Playbooks'}
        </button>
      </div>
      {playbooks.length === 0 ? (
        <p className="text-gray-500 text-sm">No playbooks found. Click &quot;Seed All Playbooks&quot; to create the 10 MVP playbooks.</p>
      ) : (
        <div className="grid gap-2">
          {playbooks.map((pb: any) => (
            <div key={pb.industry} className="border border-gray-200 rounded-lg bg-white">
              <button
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50"
                onClick={() => setExpanded(expanded === pb.industry ? null : pb.industry)}
              >
                <span className="font-medium text-gray-800">{pb.display_name || pb.industry}</span>
                {expanded === pb.industry ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {expanded === pb.industry && (
                <div className="px-3 pb-3 text-sm text-gray-600 space-y-1">
                  {pb.allowed_ctas && <p><strong>Allowed CTAs:</strong> {Array.isArray(pb.allowed_ctas) ? pb.allowed_ctas.join(', ') : pb.allowed_ctas}</p>}
                  {pb.forbidden_ctas && <p><strong>Forbidden CTAs:</strong> {Array.isArray(pb.forbidden_ctas) ? pb.forbidden_ctas.join(', ') : pb.forbidden_ctas}</p>}
                  {pb.content_pillars && <p><strong>Content Pillars:</strong> {Array.isArray(pb.content_pillars) ? pb.content_pillars.join(', ') : pb.content_pillars}</p>}
                  {pb.nav_patterns && <p><strong>Nav Patterns:</strong> {Array.isArray(pb.nav_patterns) ? pb.nav_patterns.join(', ') : pb.nav_patterns}</p>}
                  {pb.visual_style_rules && <p><strong>Visual Style:</strong> {pb.visual_style_rules}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BusinessMemorySection ──
function BusinessMemorySection() {
  const [businessId, setBusinessId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!businessId.trim()) return;
    setLoading(true);
    const d = await api(`/business-memory/${encodeURIComponent(businessId.trim())}`);
    setData(d);
    setLoading(false);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><Brain className="w-5 h-5 text-purple-600" /> Business Memory</h3>
      <div className="flex gap-2 mb-4">
        <input
          value={businessId}
          onChange={e => setBusinessId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="Enter business ID or slug…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />
        <button onClick={lookup} disabled={loading} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lookup'}
        </button>
      </div>

      {data && !data.error && (
        <div className="space-y-4">
          {/* Memory items */}
          {data.memory && Object.keys(data.memory).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Memory ({Object.values(data.memory as Record<string, any[]>).flat().length} items)</h4>
              {Object.entries(data.memory as Record<string, any[]>).map(([type, items]) => (
                <div key={type} className="mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase">{type}</span>
                  <div className="ml-2">
                    {items.map((item: any, i: number) => (
                      <div key={i} className="text-sm text-gray-700">
                        <span className="font-medium">{item.key}</span>: {item.value}
                        <span className="text-gray-400 ml-1">(conf: {item.confidence?.toFixed(2)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Brand assets */}
          {data.brand_assets?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Brand Assets ({data.brand_assets.length})</h4>
              {data.brand_assets.map((a: any, i: number) => (
                <div key={i} className="text-sm text-gray-700">{a.type}: {a.value || a.url} <span className="text-gray-400">(quality: {a.quality})</span></div>
              ))}
            </div>
          )}

          {/* Creative history */}
          {data.creative_history?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Creative History ({data.creative_history.length})</h4>
              {data.creative_history.map((h: any, i: number) => (
                <div key={i} className="text-sm text-gray-700 border-b border-gray-100 py-1">
                  <span className="font-medium">{h.territory_name || 'unnamed'}</span>
                  {h.headline && <span className="text-gray-500 ml-1">— {h.headline}</span>}
                  {h.cta && <span className="text-blue-600 ml-1">[{h.cta}]</span>}
                </div>
              ))}
            </div>
          )}

          {Object.keys(data.memory || {}).length === 0 && !data.brand_assets?.length && !data.creative_history?.length && (
            <p className="text-gray-500 text-sm">No memory found for this business.</p>
          )}
        </div>
      )}

      {data?.error && <p className="text-red-600 text-sm">{data.error}</p>}
    </div>
  );
}

// ── FeedbackSection ──
function FeedbackSection() {
  const [businessId, setBusinessId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!businessId.trim()) return;
    setLoading(true);
    const d = await api(`/feedback-events/${encodeURIComponent(businessId.trim())}`);
    setData(d);
    setLoading(false);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><Activity className="w-5 h-5 text-green-600" /> Feedback &amp; Learning</h3>
      <div className="flex gap-2 mb-4">
        <input
          value={businessId}
          onChange={e => setBusinessId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="Enter business ID or slug…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        <button onClick={lookup} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lookup'}
        </button>
      </div>

      {data && !data.error && (
        <div className="space-y-4">
          {data.summary && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Summary</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(data.summary as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="text-center bg-gray-50 rounded-lg p-2">
                    <div className="text-lg font-bold text-gray-800">{v}</div>
                    <div className="text-xs text-gray-500">{k.replace(/_/g, ' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.events?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Recent Events ({data.events.length})</h4>
              <div className="space-y-1">
                {data.events.map((ev: any, i: number) => (
                  <div key={i} className="text-sm text-gray-700 flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-32 shrink-0">{ev.created_at?.slice(0, 16)}</span>
                    <span className="font-medium text-blue-700">{ev.event_type}</span>
                    {ev.source && <span className="text-gray-400">via {ev.source}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!data.events?.length && <p className="text-gray-500 text-sm">No feedback events yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── LocalIntelSection ──
function LocalIntelSection() {
  const [businessId, setBusinessId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!businessId.trim()) return;
    setLoading(true);
    const d = await api(`/local-intelligence/${encodeURIComponent(businessId.trim())}`);
    setData(d);
    setLoading(false);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><MapPin className="w-5 h-5 text-red-600" /> Local Intelligence</h3>
      <div className="flex gap-2 mb-4">
        <input
          value={businessId}
          onChange={e => setBusinessId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="Enter business ID or slug…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
        <button onClick={lookup} disabled={loading} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lookup'}
        </button>
      </div>

      {data && !data.error && (
        <div className="space-y-4">
          {data.location && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Location</h4>
              <div className="text-sm text-gray-700 space-y-1">
                {data.location.city && <p><strong>City:</strong> {data.location.city}, {data.location.state}</p>}
                {data.location.address && <p><strong>Address:</strong> {data.location.address}</p>}
                {data.location.service_area && <p><strong>Service Area:</strong> {data.location.service_area}</p>}
              </div>
            </div>
          )}
          {data.competitors?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Competitors ({data.competitors.length})</h4>
              {data.competitors.map((c: any, i: number) => (
                <div key={i} className="text-sm text-gray-700 border-b border-gray-100 py-1">
                  <span className="font-medium">{c.competitor_name}</span>
                  {c.website_url && <span className="text-blue-600 ml-1">({c.website_url})</span>}
                </div>
              ))}
            </div>
          )}
          {data.seo_patterns?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">SEO Patterns ({data.seo_patterns.length})</h4>
              {data.seo_patterns.map((p: any, i: number) => (
                <div key={i} className="text-sm text-gray-700">
                  <span className="font-medium">{p.keyword}</span>
                  {p.monthly_volume && <span className="text-gray-400 ml-1">({p.monthly_volume} searches/mo)</span>}
                </div>
              ))}
            </div>
          )}
          {!data.location && !data.competitors?.length && !data.seo_patterns?.length && (
            <p className="text-gray-500 text-sm">No local intelligence found for this business.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main DefensibilityTab ──
export default function DefensibilityTab() {
  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-1">Defensibility Layers</h2>
        <p className="text-sm text-gray-600">Business Memory · Industry Playbooks · Local Intelligence · Performance Learning</p>
      </div>
      <PlaybooksSection />
      <BusinessMemorySection />
      <LocalIntelSection />
      <FeedbackSection />
    </div>
  );
}
