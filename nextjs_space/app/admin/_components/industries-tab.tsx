'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Plus, ChevronRight, ChevronDown, Edit3, Trash2, X,
  Building2, Wrench, Check, AlertTriangle,
} from 'lucide-react';

interface IndustryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  matchKeywords: string[];
  gbpCategories: string[];
  serviceCount: number;
  offeringCount: number;
}

interface ServiceRow {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  conditional: boolean;
  enabled: boolean;
  sortOrder: number;
}

export default function IndustriesTab() {
  const [industries, setIndustries] = useState<IndustryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [services, setServices] = useState<Record<string, ServiceRow[]>>({});
  const [loadingSvc, setLoadingSvc] = useState<string | null>(null);
  const [showAddIndustry, setShowAddIndustry] = useState(false);
  const [editIndustry, setEditIndustry] = useState<IndustryRow | null>(null);
  const [addServiceFor, setAddServiceFor] = useState<IndustryRow | null>(null);

  const fetchIndustries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/industries');
      if (res.ok) { const d = await res.json(); setIndustries(d.industries || []); }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchIndustries(); }, [fetchIndustries]);

  const fetchServices = useCallback(async (industryId: string) => {
    setLoadingSvc(industryId);
    try {
      const res = await fetch(`/api/admin/industries/${industryId}/services`);
      if (res.ok) { const d = await res.json(); setServices(p => ({ ...p, [industryId]: d.services || [] })); }
    } catch {}
    setLoadingSvc(null);
  }, []);

  const toggleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!services[id]) fetchServices(id);
  };

  const toggleIndustryEnabled = async (ind: IndustryRow) => {
    await fetch(`/api/admin/industries/${ind.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !ind.enabled }),
    });
    fetchIndustries();
  };

  const toggleServiceEnabled = async (industryId: string, svc: ServiceRow) => {
    await fetch(`/api/admin/industries/${industryId}/services/${svc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !svc.enabled }),
    });
    fetchServices(industryId);
  };

  const deleteService = async (industryId: string, svc: ServiceRow) => {
    if (!confirm(`Disable service "${svc.name}"? It will be hidden from new checklists.`)) return;
    await fetch(`/api/admin/industries/${industryId}/services/${svc.id}`, { method: 'DELETE' });
    fetchServices(industryId);
    fetchIndustries();
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> Industry Taxonomy</h2>
          <p className="text-sm text-gray-500">Reusable industries and their service catalogs. Edits here affect new service checklists across all businesses.</p>
        </div>
        <button onClick={() => setShowAddIndustry(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add industry
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {industries.map(ind => (
            <div key={ind.id}>
              <div className="flex items-center gap-3 p-4 hover:bg-gray-50">
                <button onClick={() => toggleExpand(ind.id)} className="text-gray-400">
                  {expanded === ind.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{ind.name}</span>
                    {!ind.enabled && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-600">DISABLED</span>}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">{ind.serviceCount} services</span>
                    {ind.offeringCount > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">{ind.offeringCount} in use</span>}
                  </div>
                  {ind.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{ind.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleIndustryEnabled(ind)} className="px-2 py-1 text-xs rounded hover:bg-gray-100 text-gray-600">{ind.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => setEditIndustry(ind)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Edit3 className="w-4 h-4" /></button>
                </div>
              </div>
              {expanded === ind.id && (
                <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Services</span>
                    <button onClick={() => setAddServiceFor(ind)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"><Plus className="w-3 h-3" /> Add service</button>
                  </div>
                  {loadingSvc === ind.id ? (
                    <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 text-blue-600 animate-spin" /></div>
                  ) : (services[ind.id]?.length || 0) === 0 ? (
                    <p className="text-xs text-gray-400 py-2">No services defined for this industry yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {services[ind.id].map(svc => (
                        <div key={svc.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                          <Wrench className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${svc.enabled ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{svc.name}</span>
                              {svc.conditional && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700">conditional</span>}
                            </div>
                            {svc.shortDescription && <p className="text-xs text-gray-400 truncate">{svc.shortDescription}</p>}
                          </div>
                          <button onClick={() => toggleServiceEnabled(ind.id, svc)} className="px-2 py-0.5 text-[11px] rounded hover:bg-gray-100 text-gray-500">{svc.enabled ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => deleteService(ind.id, svc)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddIndustry && <IndustryModal onClose={() => setShowAddIndustry(false)} onSaved={() => { setShowAddIndustry(false); fetchIndustries(); }} />}
      {editIndustry && <IndustryModal industry={editIndustry} onClose={() => setEditIndustry(null)} onSaved={() => { setEditIndustry(null); fetchIndustries(); }} />}
      {addServiceFor && <ServiceModal industry={addServiceFor} onClose={() => setAddServiceFor(null)} onSaved={() => { const id = addServiceFor.id; setAddServiceFor(null); fetchServices(id); fetchIndustries(); }} />}
    </div>
  );
}

function IndustryModal({ industry, onClose, onSaved }: { industry?: IndustryRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(industry?.name || '');
  const [description, setDescription] = useState(industry?.description || '');
  const [keywords, setKeywords] = useState((industry?.matchKeywords || []).join(', '));
  const [gbp, setGbp] = useState((industry?.gbpCategories || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      matchKeywords: keywords.split(',').map(s => s.trim()).filter(Boolean),
      gbpCategories: gbp.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      const res = industry
        ? await fetch(`/api/admin/industries/${industry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/admin/industries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) onSaved();
      else { const e = await res.json().catch(() => ({})); setErr(e.error || 'Save failed'); setSaving(false); }
    } catch { setErr('Save failed'); setSaving(false); }
  };

  return (
    <ModalShell title={industry ? 'Edit industry' : 'Add industry'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name *"><input value={name} onChange={e => setName(e.target.value)} autoFocus className="inp" /></Field>
        <Field label="Description"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="inp" /></Field>
        <Field label="Match keywords (comma-separated)"><input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="auto repair, mechanic, brakes" className="inp" /></Field>
        <Field label="GBP categories (comma-separated)"><input value={gbp} onChange={e => setGbp(e.target.value)} placeholder="Auto repair shop, Car repair" className="inp" /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} label={industry ? 'Save changes' : 'Add industry'} />
    </ModalShell>
  );
}

function ServiceModal({ industry, onClose, onSaved }: { industry: IndustryRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [customerProblem, setCustomerProblem] = useState('');
  const [conditional, setConditional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/admin/industries/${industry.id}/services`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), shortDescription: shortDescription.trim() || null, customerProblem: customerProblem.trim() || null, conditional }),
      });
      if (res.ok) onSaved();
      else { const e = await res.json().catch(() => ({})); setErr(e.error || 'Save failed'); setSaving(false); }
    } catch { setErr('Save failed'); setSaving(false); }
  };

  return (
    <ModalShell title={`Add service to ${industry.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Service name *"><input value={name} onChange={e => setName(e.target.value)} autoFocus className="inp" /></Field>
        <Field label="Short description"><textarea value={shortDescription} onChange={e => setShortDescription(e.target.value)} rows={2} className="inp" /></Field>
        <Field label="Customer problem it solves"><textarea value={customerProblem} onChange={e => setCustomerProblem(e.target.value)} rows={2} className="inp" /></Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={conditional} onChange={e => setConditional(e.target.checked)} className="rounded" />
          Conditional (only suggested when there&apos;s evidence)
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} label="Add service" />
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      <style jsx>{`:global(.inp){width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.875rem}:global(.inp:focus){outline:none;box-shadow:0 0 0 2px #3b82f6;border-color:#3b82f6}`}</style>
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function ModalActions({ onClose, onSubmit, saving, label }: { onClose: () => void; onSubmit: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 mt-6">
      <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button onClick={onSubmit} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} {label}
      </button>
    </div>
  );
}
