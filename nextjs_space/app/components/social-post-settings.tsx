'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, Loader2, CheckCircle2, AlertCircle, Link2, ToggleLeft, ToggleRight, Save,
} from 'lucide-react';

interface SocialPostSettingsProps {
  businessId: string;
  businessName: string;
}

export default function SocialPostSettings({ businessId, businessName }: SocialPostSettingsProps) {
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [ctaText, setCtaText] = useState('Learn more here:');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/social-landing-page`);
      if (res.ok) {
        const data = await res.json();
        setUrl(data.defaultSocialLandingPageUrl || '');
        setEnabled(data.defaultSocialLandingPageEnabled || false);
        setCtaText(data.defaultSocialCtaText || 'Learn more here:');
      }
    } catch (err) {
      console.error('Failed to fetch social landing page settings:', err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const validateUrl = (value: string): boolean => {
    if (!value.trim()) {
      setUrlError(null);
      return true; // Empty is valid (just means disabled)
    }
    if (!/^https?:\/\//i.test(value.trim())) {
      setUrlError('Please enter a valid landing page URL (must start with https:// or http://).');
      return false;
    }
    try {
      const parsed = new URL(value.trim());
      if (!parsed.hostname || !parsed.hostname.includes('.')) {
        setUrlError('Please enter a valid landing page URL.');
        return false;
      }
      if (/[\s<>{}|\\^`]/.test(value.trim())) {
        setUrlError('URL contains invalid characters.');
        return false;
      }
    } catch {
      setUrlError('Please enter a valid landing page URL.');
      return false;
    }
    setUrlError(null);
    return true;
  };

  const handleSave = async () => {
    if (!validateUrl(url)) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/businesses/${businessId}/social-landing-page`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), enabled, ctaText: ctaText.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setUrl(data.defaultSocialLandingPageUrl || '');
        setEnabled(data.defaultSocialLandingPageEnabled || false);
        setCtaText(data.defaultSocialCtaText || 'Learn more here:');
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      } else {
        setError(data.error || 'Failed to save settings.');
        if (data.field === 'url') setUrlError(data.error);
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading social post settings…</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
            <Link2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Social Post Settings</h3>
            <p className="text-xs text-gray-500">{businessName}</p>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6 space-y-5">
        {/* Default Landing Page URL */}
        <div>
          <label htmlFor="social-landing-url" className="block text-sm font-medium text-gray-700 mb-1">
            Default social landing page
          </label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <Globe className="w-4 h-4 text-gray-400" />
            </div>
            <input
              id="social-landing-url"
              type="url"
              value={url}
              onChange={e => { setUrl(e.target.value); setUrlError(null); }}
              onBlur={() => url.trim() && validateUrl(url)}
              placeholder="https://example.com/offer"
              className={`w-full border rounded-lg pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${
                urlError ? 'border-red-300 bg-red-50' : 'border-gray-300'
              }`}
            />
          </div>
          {urlError ? (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {urlError}
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              This link will be added to scheduled social posts as the default destination for traffic from Facebook, Google Business Profile, LinkedIn, and other connected channels.
            </p>
          )}
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Add this link to social posts by default</p>
            <p className="text-xs text-gray-500 mt-0.5">When enabled, new social posts will include the landing page URL.</p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className="flex-shrink-0 ml-3"
            aria-label="Toggle default landing page"
          >
            {enabled ? (
              <ToggleRight className="w-10 h-10 text-indigo-600" />
            ) : (
              <ToggleLeft className="w-10 h-10 text-gray-300" />
            )}
          </button>
        </div>

        {/* CTA Text */}
        <div>
          <label htmlFor="social-cta-text" className="block text-sm font-medium text-gray-700 mb-1">
            Default CTA text <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="social-cta-text"
            type="text"
            value={ctaText}
            onChange={e => setCtaText(e.target.value)}
            placeholder="Learn more here:"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">This text appears before the URL in your social posts. Default: “Learn more here:”</p>
        </div>

        {/* Preview */}
        {url.trim() && enabled && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
            <p className="text-xs font-medium text-indigo-700 mb-1">Preview — post ending</p>
            <div className="bg-white rounded px-3 py-2 text-xs text-gray-700 font-mono whitespace-pre-wrap">
              {ctaText || 'Learn more here:'}{'\n'}{url.trim()}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Social post settings saved successfully.
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Social Settings'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
