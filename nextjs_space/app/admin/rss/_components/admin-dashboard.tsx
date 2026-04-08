'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Rss, FileText, Shield, Download, Search, RefreshCw,
  ChevronLeft, ChevronRight, Edit3, Trash2, Eye, Check, X, Filter,
  AlertTriangle, CheckCircle2, Clock, XCircle, Globe, MapPin,
} from 'lucide-react';

type Tab = 'overview' | 'feeds' | 'items' | 'policies' | 'export';

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'feeds', label: 'Feeds', icon: Rss },
    { id: 'items', label: 'Items', icon: FileText },
    { id: 'policies', label: 'Policies', icon: Shield },
    { id: 'export', label: 'Export', icon: Download },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Rss className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">RSS Intelligence</h1>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Admin QA</span>
            </div>
          </div>
          <div className="flex gap-1 -mb-px">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'feeds' && <FeedsTab />}
        {tab === 'items' && <ItemsTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'export' && <ExportTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Overview Tab
// ═══════════════════════════════════════════════════════════

function OverviewTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/rss/admin/stats').then(r => r.json()).then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (!stats) return <ErrorMessage message="Failed to load stats" />;

  const o = stats.overview;
  const cards = [
    { label: 'Total Feeds', value: o.totalFeeds, icon: Rss, color: 'blue' },
    { label: 'Active Feeds', value: o.activeFeeds, icon: CheckCircle2, color: 'green' },
    { label: 'Stale Feeds', value: o.staleFeeds, icon: Clock, color: 'yellow' },
    { label: 'Broken Feeds', value: o.brokenFeeds, icon: XCircle, color: 'red' },
    { label: 'Total Items', value: o.totalItems, icon: FileText, color: 'blue' },
    { label: 'Approved', value: o.approvedItems, icon: CheckCircle2, color: 'green' },
    { label: 'Blocked', value: o.blockedItems, icon: X, color: 'red' },
    { label: 'Manual Review', value: o.manualReviewItems, icon: AlertTriangle, color: 'yellow' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  const iconColorMap: Record<string, string> = {
    blue: 'text-blue-500', green: 'text-green-500', yellow: 'text-amber-500', red: 'text-red-500',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${colorMap[c.color]}`}>
            <div className="flex items-center justify-between mb-2">
              <c.icon className={`w-5 h-5 ${iconColorMap[c.color]}`} />
            </div>
            <div className="text-2xl font-bold">{c.value.toLocaleString()}</div>
            <div className="text-xs opacity-75 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BreakdownCard title="Feeds by Type" data={stats.feedsByType} labelKey="type" />
        <BreakdownCard title="Feeds by State" data={stats.feedsByState} labelKey="state" />
        <BreakdownCard title="Feeds by Status" data={stats.feedsByStatus} labelKey="status" />
        <BreakdownCard title="Feeds by Geo Scope" data={stats.feedsByScope} labelKey="scope" />
      </div>

      <div className="flex gap-4 text-sm text-gray-500">
        <span>Geo Mappings: <strong>{o.totalGeoMappings.toLocaleString()}</strong></span>
        <span>Content Policies: <strong>{o.totalPolicies}</strong></span>
      </div>
    </div>
  );
}

function BreakdownCard({ title, data, labelKey }: { title: string; data: any[]; labelKey: string }) {
  const max = Math.max(...data.map((d: any) => d.count), 1);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-2">
        {data.map((d: any, i: number) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-28 truncate font-mono">{d[labelKey] || 'null'}</span>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-700 w-10 text-right">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Feeds Tab
// ═══════════════════════════════════════════════════════════

function FeedsTab() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', sourceType: '', pilotState: '', search: '' });
  const [editingFeed, setEditingFeed] = useState<any>(null);

  const loadFeeds = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30' });
    if (filters.status) params.set('status', filters.status);
    if (filters.sourceType) params.set('sourceType', filters.sourceType);
    if (filters.pilotState) params.set('pilotState', filters.pilotState);
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/rss/admin/feeds?${params}`);
    const data = await res.json();
    setFeeds(data.feeds || []);
    setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
    setLoading(false);
  }, [filters]);

  useEffect(() => { loadFeeds(); }, [loadFeeds]);

  const handleSave = async (id: string, updates: any) => {
    await fetch(`/api/rss/admin/feeds/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
    });
    setEditingFeed(null);
    loadFeeds(pagination.page);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this feed and all its items?')) return;
    await fetch(`/api/rss/admin/feeds/${id}`, { method: 'DELETE' });
    loadFeeds(pagination.page);
  };

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    stale: 'bg-amber-100 text-amber-700',
    broken: 'bg-red-100 text-red-700',
    blocked: 'bg-gray-100 text-gray-700',
    pending: 'bg-blue-100 text-blue-700',
    retired: 'bg-gray-200 text-gray-500',
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search feeds..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && loadFeeds()}
            />
          </div>
          <FilterSelect label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}
            options={['', 'active', 'stale', 'broken', 'blocked', 'pending', 'retired']} />
          <FilterSelect label="Type" value={filters.sourceType} onChange={v => setFilters(f => ({ ...f, sourceType: v }))}
            options={['', 'local_news', 'gov_meeting', 'weather', 'community', 'event', 'school', 'npr', 'unknown']} />
          <FilterSelect label="State" value={filters.pilotState} onChange={v => setFilters(f => ({ ...f, pilotState: v }))}
            options={['', 'CO', 'TX', 'FL', 'NC', 'MT']} />
          <button onClick={() => loadFeeds()} className="p-2 text-gray-500 hover:text-blue-600 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500">
        {pagination.total.toLocaleString()} feeds found
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Feed</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">State</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Scope</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Items</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Geos</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : feeds.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No feeds found</td></tr>
              ) : feeds.map(f => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="max-w-xs">
                      <div className="font-medium text-gray-900 truncate" title={f.title}>{f.title || '(no title)'}</div>
                      <div className="text-xs text-gray-400 truncate" title={f.url}>{f.url}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{f.sourceType}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[f.status] || 'bg-gray-100'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-600">{f.pilotState || '—'}</td>
                  <td className="px-3 py-3 text-xs text-gray-600">{f.geoScope || '—'}</td>
                  <td className="px-3 py-3 text-center text-xs">{f._count?.items || 0}</td>
                  <td className="px-3 py-3 text-center text-xs">{f._count?.feedGeos || 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditingFeed(f)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors" title="Edit">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(f.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-500">Page {pagination.page} of {pagination.pages}</div>
            <div className="flex gap-1">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadFeeds(pagination.page - 1)}
                className="p-1.5 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadFeeds(pagination.page + 1)}
                className="p-1.5 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingFeed && (
        <EditFeedModal feed={editingFeed} onClose={() => setEditingFeed(null)} onSave={handleSave} />
      )}
    </div>
  );
}

function EditFeedModal({ feed, onClose, onSave }: { feed: any; onClose: () => void; onSave: (id: string, updates: any) => void }) {
  const [form, setForm] = useState({
    status: feed.status || '',
    sourceType: feed.sourceType || '',
    sourceQuality: feed.sourceQuality || '',
    geoScope: feed.geoScope || '',
    pilotState: feed.pilotState || '',
    notes: feed.notes || '',
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Edit Feed</h3>
        <p className="text-sm text-gray-500 mb-4 truncate">{feed.title}</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {['pending', 'active', 'stale', 'broken', 'blocked', 'retired'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Source Type</label>
            <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" value={form.sourceType}
              onChange={e => setForm(f => ({ ...f, sourceType: e.target.value }))}>
              {['local_news', 'gov_meeting', 'weather', 'community', 'event', 'school', 'npr', 'unknown'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quality</label>
            <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" value={form.sourceQuality}
              onChange={e => setForm(f => ({ ...f, sourceQuality: e.target.value }))}>
              {['official', 'trusted', 'community', 'aggregator', 'unverified'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Geo Scope</label>
            <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" value={form.geoScope}
              onChange={e => setForm(f => ({ ...f, geoScope: e.target.value }))}>
              {['local', 'state', 'national', 'weather'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
            <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" value={form.pilotState}
              onChange={e => setForm(f => ({ ...f, pilotState: e.target.value }))}>
              <option value="">—</option>
              {['CO', 'TX', 'FL', 'NC', 'MT'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 h-20 resize-none"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={() => onSave(feed.id, form)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-700"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">All {label}</option>
      {options.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ═══════════════════════════════════════════════════════════
// Items Tab
// ═══════════════════════════════════════════════════════════

function ItemsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  const loadItems = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30' });
    if (filterStatus) params.set('filterStatus', filterStatus);
    if (search) params.set('search', search);
    const res = await fetch(`/api/rss/admin/items?${params}`);
    const data = await res.json();
    setItems(data.items || []);
    setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
    setLoading(false);
  }, [filterStatus, search]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleOverride = async (itemId: string, newStatus: string) => {
    await fetch('/api/rss/admin/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, filterStatus: newStatus, reason: 'admin_override' }),
    });
    loadItems(pagination.page);
  };

  const auditColors: Record<string, string> = {
    approved: 'bg-green-100 text-green-700',
    blocked: 'bg-red-100 text-red-700',
    manual_review: 'bg-amber-100 text-amber-700',
    pending: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="Search items..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadItems()}
            />
          </div>
          <FilterSelect label="Audit Status" value={filterStatus} onChange={setFilterStatus}
            options={['', 'approved', 'blocked', 'manual_review']} />
          <button onClick={() => loadItems()} className="p-2 text-gray-500 hover:text-blue-600"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="text-sm text-gray-500">{pagination.total.toLocaleString()} items found</div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Item</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Feed</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Published</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Audit</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Override</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No items found</td></tr>
              ) : items.map(item => {
                const audit = item.itemAudits?.[0];
                const currentStatus = item.filterStatus || 'pending';
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="max-w-sm">
                        <div className="font-medium text-gray-900 truncate">{item.title || '(no title)'}</div>
                        {item.link && (
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate block">
                            {item.link}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-gray-600 truncate max-w-[120px]">{item.feed?.title || '—'}</div>
                      <div className="text-xs text-gray-400">{item.feed?.sourceType}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${auditColors[currentStatus] || 'bg-gray-100'}`}>
                        {currentStatus}
                      </span>
                      {audit?.category && (
                        <span className="text-xs text-gray-400 ml-1">{audit.category}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {currentStatus !== 'approved' && (
                          <button onClick={() => handleOverride(item.id, 'approved')}
                            className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Approve">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {currentStatus !== 'blocked' && (
                          <button onClick={() => handleOverride(item.id, 'blocked')}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Block">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-500">Page {pagination.page} of {pagination.pages}</div>
            <div className="flex gap-1">
              <button disabled={pagination.page <= 1} onClick={() => loadItems(pagination.page - 1)} className="p-1.5 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={pagination.page >= pagination.pages} onClick={() => loadItems(pagination.page + 1)} className="p-1.5 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Policies Tab
// ═══════════════════════════════════════════════════════════

function PoliciesTab() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editKeywords, setEditKeywords] = useState('');

  useEffect(() => {
    fetch('/api/rss/admin/policies').then(r => r.json()).then(data => {
      setPolicies(Array.isArray(data) ? data : []);
    }).finally(() => setLoading(false));
  }, []);

  const togglePolicy = async (id: string, isActive: boolean) => {
    await fetch('/api/rss/admin/policies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: isActive }),
    });
    setPolicies(ps => ps.map(p => p.id === id ? { ...p, isActive } : p));
  };

  const saveKeywords = async (id: string) => {
    const keywords = editKeywords.split(',').map(k => k.trim()).filter(Boolean);
    await fetch('/api/rss/admin/policies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, keywords }),
    });
    setPolicies(ps => ps.map(p => p.id === id ? { ...p, keywords } : p));
    setEditId(null);
  };

  const actionColors: Record<string, string> = {
    hard_block: 'bg-red-100 text-red-700',
    soft_filter: 'bg-amber-100 text-amber-700',
    allow: 'bg-green-100 text-green-700',
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500">{policies.length} content policies</div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {policies.map(p => (
              <div key={p.id} className={`px-5 py-4 flex items-start gap-4 ${!p.isActive ? 'opacity-50' : ''}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">{p.category}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionColors[p.action] || 'bg-gray-100'}`}>{p.action}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">{p.description}</div>
                  {editId === p.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
                        value={editKeywords}
                        onChange={e => setEditKeywords(e.target.value)}
                        placeholder="keyword1, keyword2, ..."
                      />
                      <button onClick={() => saveKeywords(p.id)} className="text-xs text-blue-600 hover:underline">Save</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(p.keywords || []).slice(0, 10).map((k: string, i: number) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{k}</span>
                      ))}
                      {p.keywords?.length > 10 && <span className="text-xs text-gray-400">+{p.keywords.length - 10} more</span>}
                      <button
                        onClick={() => { setEditId(p.id); setEditKeywords((p.keywords || []).join(', ')); }}
                        className="text-xs text-blue-500 hover:underline ml-1"
                      >edit</button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => togglePolicy(p.id, !p.isActive)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    p.isActive ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    p.isActive ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Export Tab
// ═══════════════════════════════════════════════════════════

function ExportTab() {
  const [webhookZip, setWebhookZip] = useState('');
  const [webhookRadius, setWebhookRadius] = useState('25');
  const [webhookResult, setWebhookResult] = useState<any>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);

  const exportData = (type: string, format: string) => {
    const url = `/api/rss/admin/export?type=${type}&format=${format}`;
    if (format === 'csv') {
      const a = document.createElement('a');
      a.href = url;
      a.click();
    } else {
      window.open(url, '_blank');
    }
  };

  const testWebhook = async () => {
    if (!webhookZip) return;
    setWebhookLoading(true);
    setWebhookResult(null);
    try {
      const res = await fetch('/api/rss/admin/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip: webhookZip, radius: parseInt(webhookRadius) }),
      });
      setWebhookResult(await res.json());
    } catch (err: any) {
      setWebhookResult({ error: err.message });
    } finally {
      setWebhookLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Bulk Export */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Bulk Export</h3>
        <p className="text-sm text-gray-500 mb-4">Download feed and item data in JSON or CSV format.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => exportData('feeds', 'csv')} className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" /> Feeds CSV
          </button>
          <button onClick={() => exportData('feeds', 'json')} className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" /> Feeds JSON
          </button>
          <button onClick={() => exportData('items', 'csv')} className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" /> Items CSV
          </button>
          <button onClick={() => exportData('items', 'json')} className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" /> Items JSON
          </button>
        </div>
      </div>

      {/* Clark Kent Webhook Tester */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Clark Kent Webhook</h3>
        <p className="text-sm text-gray-500 mb-4">
          Test the content brief webhook that Clark Kent calls for local posting material.
          <br />
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded mt-1 inline-block">POST /api/rss/admin/export</code>
        </p>

        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ZIP Code</label>
            <input
              type="text" placeholder="80202"
              className="w-32 text-sm border border-gray-300 rounded-lg px-3 py-2"
              value={webhookZip} onChange={e => setWebhookZip(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Radius (mi)</label>
            <input
              type="number" placeholder="25"
              className="w-20 text-sm border border-gray-300 rounded-lg px-3 py-2"
              value={webhookRadius} onChange={e => setWebhookRadius(e.target.value)}
            />
          </div>
          <button
            onClick={testWebhook}
            disabled={webhookLoading || !webhookZip}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {webhookLoading ? 'Fetching...' : 'Test Webhook'}
          </button>
        </div>

        {webhookResult && (
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-96">
            {JSON.stringify(webhookResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Webhook Integration Guide */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Integration Guide</h3>
        <div className="text-sm text-gray-600 space-y-3">
          <div>
            <h4 className="font-medium text-gray-800">Clark Kent Agent</h4>
            <pre className="bg-gray-50 p-3 rounded-lg text-xs mt-1 overflow-auto">{`// Hourly sweep for local content
const brief = await fetch('${typeof window !== 'undefined' ? window.location.origin : ''}/api/rss/admin/export', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    zip: '80202',
    radius: 25,
    days: 7,
    limit: 20
  })
}).then(r => r.json());`}</pre>
          </div>
          <div>
            <h4 className="font-medium text-gray-800">Trade Area API</h4>
            <pre className="bg-gray-50 p-3 rounded-lg text-xs mt-1 overflow-auto">{`// Direct trade area query
GET /api/rss/trade-area?zip=80202&radius=25&days=7`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-white rounded-xl h-24 animate-pulse border border-gray-200" />
      ))}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
      <p className="text-sm text-red-600">{message}</p>
    </div>
  );
}
