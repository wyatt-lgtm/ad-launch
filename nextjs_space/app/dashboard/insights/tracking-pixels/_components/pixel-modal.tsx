'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Info } from 'lucide-react';

const PLATFORMS = [
  { value: 'meta', label: 'Meta (Facebook)' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'ga4', label: 'Google Analytics 4 (GA4)' },
  { value: 'google_tag', label: 'Google Tag' },
  { value: 'google_tag_manager', label: 'Google Tag Manager' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'bing', label: 'Bing / Microsoft Ads' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'choozle', label: 'Choozle' },
  { value: 'custom', label: 'Custom' },
];

const PIXEL_TYPES = ['base_pixel', 'remarketing_pixel', 'conversion_pixel', 'analytics_tag', 'tag_manager', 'custom_script', 'custom_html', 'event_snippet'];
const TRACKING_METHODS = ['browser', 'server', 'hybrid'];
const PLACEMENTS = ['head', 'body_start', 'body_end', 'event_only'];
const SCOPES = ['all_pages', 'selected_pages', 'landing_pages', 'social_landing_pages', 'blog_pages', 'service_pages', 'thank_you_pages', 'checkout_or_conversion_pages', 'custom_rules'];
const CONSENT_CATEGORIES = ['essential', 'analytics', 'advertising', 'remarketing', 'conversion_tracking'];

const LABEL = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export interface PixelDraft {
  id?: string;
  name: string;
  platform: string;
  pixelType: string;
  trackingMethod: string;
  pixelId: string;
  scriptSnippet: string;
  placement: string;
  scope: string;
  status: string;
  consentRequired: boolean;
  consentCategory: string;
  firesBeforeConsent: boolean;
  cookieBannerRequired: boolean;
  // platform-specific
  ga4MeasurementId: string;
  enhancedMeasurementEnabled: boolean;
  defaultPageViewEnabled: boolean;
  gtmContainerId: string;
  googleTagId: string;
  googleAdsConversionId: string;
  googleAdsConversionLabel: string;
  metaPixelId: string;
  metaConversionsApiEnabled: boolean;
  tiktokPixelId: string;
  linkedinPartnerId: string;
  bingUetTagId: string;
  choozleAdvertiserId: string;
  choozlePixelId: string;
  choozleConversionId: string;
  serverEventEnabled: boolean;
}

export const EMPTY_PIXEL: PixelDraft = {
  name: '', platform: 'meta', pixelType: 'base_pixel', trackingMethod: 'browser',
  pixelId: '', scriptSnippet: '', placement: 'head', scope: 'all_pages', status: 'draft',
  consentRequired: false, consentCategory: 'analytics', firesBeforeConsent: false,
  cookieBannerRequired: false, ga4MeasurementId: '', enhancedMeasurementEnabled: true,
  defaultPageViewEnabled: true, gtmContainerId: '', googleTagId: '', googleAdsConversionId: '',
  googleAdsConversionLabel: '', metaPixelId: '', metaConversionsApiEnabled: false, tiktokPixelId: '',
  linkedinPartnerId: '', bingUetTagId: '', choozleAdvertiserId: '', choozlePixelId: '',
  choozleConversionId: '', serverEventEnabled: false,
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none';

export default function PixelModal({
  initial, onClose, onSave, saving,
}: {
  initial: PixelDraft;
  onClose: () => void;
  onSave: (draft: PixelDraft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<PixelDraft>(initial);
  useEffect(() => setDraft(initial), [initial]);

  const set = (patch: Partial<PixelDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const p = draft.platform;
  const isCustom = p === 'custom' || ['custom_script', 'custom_html', 'event_snippet'].includes(draft.pixelType);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h3 className="text-lg font-bold text-gray-900">{draft.id ? 'Edit Pixel' : 'Add Pixel'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Pixel Name *">
              <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Meta Base Pixel" />
            </Field>
            <Field label="Platform *">
              <select className={inputCls} value={draft.platform} onChange={(e) => set({ platform: e.target.value })}>
                {PLATFORMS.map((pl) => <option key={pl.value} value={pl.value}>{pl.label}</option>)}
              </select>
            </Field>
            <Field label="Pixel Type">
              <select className={inputCls} value={draft.pixelType} onChange={(e) => set({ pixelType: e.target.value })}>
                {PIXEL_TYPES.map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
              </select>
            </Field>
            <Field label="Tracking Method">
              <select className={inputCls} value={draft.trackingMethod} onChange={(e) => set({ trackingMethod: e.target.value })}>
                {TRACKING_METHODS.map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
              </select>
            </Field>
          </div>

          {/* Guided platform-specific setup */}
          {(p === 'ga4') && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-blue-800 text-sm font-semibold"><Info className="w-4 h-4" /> GA4 Guided Setup</div>
              <p className="text-xs text-blue-700">Enter your GA4 Measurement ID — no need to paste the full script.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="GA4 Measurement ID" hint="e.g. G-XXXXXXXXXX">
                  <input className={inputCls} value={draft.ga4MeasurementId} onChange={(e) => set({ ga4MeasurementId: e.target.value })} placeholder="G-XXXXXXXXXX" />
                </Field>
                <Field label="GTM Container ID (optional)" hint="e.g. GTM-XXXXXXX">
                  <input className={inputCls} value={draft.gtmContainerId} onChange={(e) => set({ gtmContainerId: e.target.value })} placeholder="GTM-XXXXXXX" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs text-blue-800"><input type="checkbox" checked={draft.defaultPageViewEnabled} onChange={(e) => set({ defaultPageViewEnabled: e.target.checked })} /> Enable page_view tracking</label>
                <label className="flex items-center gap-2 text-xs text-blue-800"><input type="checkbox" checked={draft.enhancedMeasurementEnabled} onChange={(e) => set({ enhancedMeasurementEnabled: e.target.checked })} /> Enhanced measurement</label>
              </div>
            </div>
          )}

          {(p === 'google_tag_manager') && (
            <Field label="GTM Container ID" hint="e.g. GTM-XXXXXXX">
              <input className={inputCls} value={draft.gtmContainerId} onChange={(e) => set({ gtmContainerId: e.target.value })} placeholder="GTM-XXXXXXX" />
            </Field>
          )}

          {(p === 'google_ads' || p === 'google_tag') && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Google Tag ID"><input className={inputCls} value={draft.googleTagId} onChange={(e) => set({ googleTagId: e.target.value })} placeholder="AW-XXXXXXXXX" /></Field>
              <Field label="Conversion ID"><input className={inputCls} value={draft.googleAdsConversionId} onChange={(e) => set({ googleAdsConversionId: e.target.value })} /></Field>
              <Field label="Conversion Label"><input className={inputCls} value={draft.googleAdsConversionLabel} onChange={(e) => set({ googleAdsConversionLabel: e.target.value })} /></Field>
            </div>
          )}

          {(p === 'meta' || p === 'facebook') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Meta Pixel ID"><input className={inputCls} value={draft.metaPixelId} onChange={(e) => set({ metaPixelId: e.target.value })} placeholder="15-16 digit ID" /></Field>
              <Field label=" "><label className="flex items-center gap-2 text-xs text-gray-700 mt-2"><input type="checkbox" checked={draft.metaConversionsApiEnabled} onChange={(e) => set({ metaConversionsApiEnabled: e.target.checked })} /> Conversions API enabled</label></Field>
            </div>
          )}

          {p === 'tiktok' && <Field label="TikTok Pixel ID"><input className={inputCls} value={draft.tiktokPixelId} onChange={(e) => set({ tiktokPixelId: e.target.value })} /></Field>}
          {p === 'linkedin' && <Field label="LinkedIn Partner ID"><input className={inputCls} value={draft.linkedinPartnerId} onChange={(e) => set({ linkedinPartnerId: e.target.value })} /></Field>}
          {(p === 'bing' || p === 'microsoft_ads') && <Field label="Bing UET Tag ID"><input className={inputCls} value={draft.bingUetTagId} onChange={(e) => set({ bingUetTagId: e.target.value })} /></Field>}

          {p === 'choozle' && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-purple-800 text-sm font-semibold"><Info className="w-4 h-4" /> Choozle Universal Pixel</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Advertiser ID"><input className={inputCls} value={draft.choozleAdvertiserId} onChange={(e) => set({ choozleAdvertiserId: e.target.value })} /></Field>
                <Field label="Pixel ID"><input className={inputCls} value={draft.choozlePixelId} onChange={(e) => set({ choozlePixelId: e.target.value })} /></Field>
                <Field label="Conversion ID"><input className={inputCls} value={draft.choozleConversionId} onChange={(e) => set({ choozleConversionId: e.target.value })} /></Field>
              </div>
              <p className="text-xs text-purple-700">Or paste your approved Choozle snippet below.</p>
            </div>
          )}

          {/* Generic pixel id for any platform */}
          {!['ga4', 'google_tag_manager', 'choozle'].includes(p) && (
            <Field label="Pixel ID / Tag ID (generic)" hint="Optional fallback identifier">
              <input className={inputCls} value={draft.pixelId} onChange={(e) => set({ pixelId: e.target.value })} />
            </Field>
          )}

          {/* Custom snippet */}
          {isCustom && (
            <Field label="Script / Snippet (custom)" hint="Stored securely. This code is NEVER executed inside the admin UI.">
              <textarea className={`${inputCls} font-mono text-xs`} rows={5} value={draft.scriptSnippet} onChange={(e) => set({ scriptSnippet: e.target.value })} placeholder="<!-- paste custom pixel/script here -->" />
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Placement">
              <select className={inputCls} value={draft.placement} onChange={(e) => set({ placement: e.target.value })}>
                {PLACEMENTS.map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
              </select>
            </Field>
            <Field label="Scope">
              <select className={inputCls} value={draft.scope} onChange={(e) => set({ scope: e.target.value })}>
                {SCOPES.map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
              </select>
            </Field>
            <Field label="Consent Category">
              <select className={inputCls} value={draft.consentCategory} onChange={(e) => set({ consentCategory: e.target.value })}>
                {CONSENT_CATEGORIES.map((t) => <option key={t} value={t}>{LABEL(t)}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={draft.status === 'active'} onChange={(e) => set({ status: e.target.checked ? 'active' : 'inactive' })} /> Active</label>
            <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={draft.consentRequired} onChange={(e) => set({ consentRequired: e.target.checked })} /> Consent required</label>
            <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={draft.cookieBannerRequired} onChange={(e) => set({ cookieBannerRequired: e.target.checked })} /> Cookie banner required</label>
            <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={draft.serverEventEnabled} onChange={(e) => set({ serverEventEnabled: e.target.checked })} /> Server-side events</label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</button>
          <button
            onClick={() => onSave(draft)}
            disabled={saving || !draft.name.trim()}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {draft.id ? 'Save Changes' : 'Add Pixel'}
          </button>
        </div>
      </div>
    </div>
  );
}
