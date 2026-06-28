'use client';

import { useState } from 'react';
import {
  X, ArrowLeft, ArrowRight, Loader2, CheckCircle2, Sparkles, Target, Users,
  Map as MapIcon, ListChecks, Info, ExternalLink, Lightbulb,
} from 'lucide-react';
import {
  PLATFORM_CAPABILITIES, TRACKING_GOALS, getRecommendedPlan, getManualInstructions,
  getPlatformCapability, INSTALL_TARGET_LABELS, INSTALLATION_TARGETS, DISPLAY_COPY,
} from '@/lib/tracking-wizard';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const EVENT_LABELS: Record<string, string> = {
  page_view: 'PageView (all pages)',
  landing_page_view: 'Landing Page View',
  service_page_view: 'Service Page View',
  thank_you_page_view: 'Thank You Page View',
  lead: 'Lead conversion',
  phone_click: 'Phone Click',
  form_submit: 'Form Submit',
};

interface Props {
  businessId: string;
  businessName?: string;
  api: (path: string) => string;
  onClose: () => void;
  onCreated: () => void;
  showToast: (ok: boolean, msg: string) => void;
}

export default function PixelWizard({ businessId, businessName, api, onClose, onCreated, showToast }: Props) {
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<string>('');
  const [goal, setGoal] = useState<string>('');
  const [pixelId, setPixelId] = useState('');
  const [baseCode, setBaseCode] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [installationTarget, setInstallationTarget] = useState<string>('unknown');
  const [saving, setSaving] = useState(false);

  const cap = platform ? getPlatformCapability(platform) : undefined;
  const plan = platform ? getRecommendedPlan(platform) : undefined;
  const instructions = platform ? getManualInstructions(platform) : undefined;

  const canNext =
    (step === 1 && !!platform) ||
    (step === 2 && !!goal) ||
    step === 3 ||
    step === 4;

  const submit = async (mode: 'create_plan' | 'have_id' | 'save_setup_needed') => {
    setSaving(true);
    try {
      const res = await fetch(api('tracking-wizard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, goal, mode, pixelId, baseCode, websiteUrl, installationTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create plan');
      const c = data.counts || {};
      showToast(true, `Tracking plan created — 1 pixel, ${c.events || 0} events, ${c.audiences || 0} audiences, ${c.routes || 0} rules`);
      onCreated();
      onClose();
    } catch (e: any) {
      showToast(false, e.message || 'Failed to create plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Help Me Create a Pixel</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-6 pt-4">
          {['Platform', 'Goal', 'Plan', 'Instructions', 'Create'].map((s, i) => {
            const n = i + 1;
            return (
              <div key={s} className="flex items-center gap-1 flex-1 last:flex-none">
                <div className={`flex items-center gap-1.5 ${step === n ? 'text-blue-700' : step > n ? 'text-green-600' : 'text-gray-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${step === n ? 'bg-blue-600 text-white' : step > n ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {step > n ? <CheckCircle2 className="w-4 h-4" /> : n}
                  </span>
                  <span className="text-xs font-medium hidden sm:inline">{s}</span>
                </div>
                {n < 5 && <div className={`h-px flex-1 ${step > n ? 'bg-green-300' : 'bg-gray-200'}`} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[55vh] overflow-y-auto">
          {/* One-pixel rule banner */}
          <div className="flex items-start gap-2 mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-900">{DISPLAY_COPY.one_pixel_rule}</p>
          </div>

          {step === 1 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Step 1 — Select a platform</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {PLATFORM_CAPABILITIES.map((p) => (
                  <button key={p.key} onClick={() => setPlatform(p.key)}
                    className={`text-left p-3 rounded-lg border transition-colors ${platform === p.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-gray-900">{p.label}</span>
                      {platform === p.key && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.guidesManualCreation && <Flag text="Guided setup" tone="blue" />}
                      {p.requiresManualPaste && <Flag text="Manual paste" tone="amber" />}
                      {p.requiresCustomerLogin && <Flag text="Your login" tone="gray" />}
                      {p.canAutoCreate && <Flag text="Auto-create" tone="green" />}
                      {p.canDetectExisting && <Flag text="Detect existing" tone="green" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Step 2 — What do you want to track?</h3>
              <div className="space-y-2">
                {TRACKING_GOALS.map((g) => (
                  <button key={g.key} onClick={() => setGoal(g.key)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${goal === g.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-gray-900">{g.label}</span>
                      {goal === g.key && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{g.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && plan && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Step 3 — Recommended setup for {cap?.label}</h3>
              <p className="text-sm text-gray-700 mb-3">{plan.summary}</p>
              {DISPLAY_COPY[platform] && (
                <div className="flex items-start gap-2 mb-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-900">{DISPLAY_COPY[platform]}</p>
                </div>
              )}
              <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs font-semibold text-gray-700 mb-1">Base pixel ({plan.pixelCount})</p>
                <p className="text-xs text-gray-600">{plan.pixelPurpose}</p>
              </div>
              <PlanList icon={Target} title="Events" items={plan.eventKeys.map((k) => EVENT_LABELS[k] || LABEL(k))} />
              <PlanList icon={Users} title="Audiences" items={plan.audienceKeys.map((k) => LABEL(k.replace(/_/g, ' ')))} />
              {plan.notes.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-700 mb-1">Notes</p>
                  <ul className="list-disc list-inside space-y-1">
                    {plan.notes.map((n, i) => <li key={i} className="text-xs text-gray-600">{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {step === 4 && instructions && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Step 4 — Create it on {cap?.label}</h3>
              {cap?.setupUrl && (
                <a href={cap.setupUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline mb-3">
                  Open {cap.label} <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {instructions.steps.length > 0 && (
                <ol className="list-decimal list-inside space-y-1.5 mb-4">
                  {instructions.steps.map((s, i) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
                </ol>
              )}
              {instructions.ghlPlacementGuide && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">Where to paste it in Launch CRM</p>
                  <ol className="list-decimal list-inside space-y-1">
                    {instructions.ghlPlacementGuide.map((s, i) => <li key={i} className="text-xs text-gray-600">{s}</li>)}
                  </ol>
                </div>
              )}

              {/* Inputs */}
              <div className="space-y-3">
                <Field label={cap?.idLabel || 'Pixel / Tag ID'}>
                  <input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Paste the ID here (optional now)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </Field>
                <Field label="Base install snippet (optional)">
                  <textarea value={baseCode} onChange={(e) => setBaseCode(e.target.value)} rows={3} placeholder="Paste the full base code snippet (stored for reference, never executed here)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Website URL (optional)">
                    <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </Field>
                  <Field label="Install method">
                    <select value={installationTarget} onChange={(e) => setInstallationTarget(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                      {INSTALLATION_TARGETS.map((t) => <option key={t} value={t}>{INSTALL_TARGET_LABELS[t]}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Step 5 — Create your Tombstone tracking plan</h3>
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mb-4 space-y-1">
                <Row label="Platform" value={cap?.label || platform} />
                <Row label="Goal" value={TRACKING_GOALS.find((g) => g.key === goal)?.label || goal} />
                <Row label="Base pixels" value="1" />
                <Row label="Events" value={String(plan?.eventKeys.length || 0)} />
                <Row label="Audiences" value={String(plan?.audienceKeys.length || 0)} />
                <Row label="Pixel / Tag ID" value={pixelId || 'Not provided yet'} />
                <Row label="Install method" value={INSTALL_TARGET_LABELS[installationTarget]} />
              </div>
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <ListChecks className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-900">
                  {pixelId
                    ? 'Your ID will be saved and the pixel marked ready to install. Tombstone maps it to all the events, audiences and page rules above.'
                    : 'No ID yet? Save the plan as “setup needed”. We create the events, audiences and page rules now, mark it as needing your action, and you can paste the ID later. We never inject an incomplete pixel.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          <button
            onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" /> {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 5 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => submit('save_setup_needed')} disabled={saving}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                Save as setup needed
              </button>
              {pixelId ? (
                <button onClick={() => submit('have_id')} disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} I already have the Pixel ID
                </button>
              ) : (
                <button onClick={() => submit('create_plan')} disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create Tombstone Tracking Plan
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Flag({ text, tone }: { text: string; tone: 'blue' | 'amber' | 'gray' | 'green' }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-100 text-green-700',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tones[tone]}`}>{text}</span>;
}

function PlanList({ icon: Icon, title, items }: { icon: any; title: string; items: string[] }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-4 h-4 text-blue-600" />
        <p className="text-xs font-semibold text-gray-700">{title} ({items.length})</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => <span key={i} className="text-[11px] px-2 py-1 bg-white border border-gray-200 rounded-md text-gray-700">{it}</span>)}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
