'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Check, Rss, ArrowRight, Sparkles } from 'lucide-react';

interface Industry {
  key: string;
  label: string;
  description: string;
  icon: string;
  feedCount: number;
  enabled: boolean;
}

export default function FeedPreferences() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/user/feed-preferences')
      .then((r) => r.json())
      .then((data) => {
        setIndustries(data.industries ?? []);
        const enabled = new Set<string>(
          (data.industries ?? []).filter((i: Industry) => i.enabled).map((i: Industry) => i.key)
        );
        setSelected(enabled);
      })
      .catch(() => setError('Failed to load feed options'))
      .finally(() => setLoading(false));
  }, [status]);

  const toggle = (key: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/user/feed-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industries: Array.from(selected) }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Rss className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          Choose Your Content Feeds
        </h1>
        <p className="text-gray-500 max-w-lg mx-auto">
          Select the national content categories that match your audience. These feeds power the news & trending content in your generated posts.
        </p>
      </div>

      {/* Industry Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {industries.map((ind) => {
          const isActive = selected.has(ind.key);
          return (
            <button
              key={ind.key}
              onClick={() => toggle(ind.key)}
              className={`relative text-left p-5 rounded-xl border-2 transition-all duration-200 group hover:shadow-md ${
                isActive
                  ? 'border-blue-500 bg-blue-50/60 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {/* Checkmark */}
              <div
                className={`absolute top-4 right-4 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  isActive ? 'bg-blue-600 scale-100' : 'bg-gray-100 scale-90 group-hover:scale-100'
                }`}
              >
                {isActive && <Check className="w-4 h-4 text-white" />}
              </div>

              <div className="flex items-start gap-3">
                <span className="text-2xl">{ind.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-base">{ind.label}</h3>
                  <p className="text-sm text-gray-500 mt-0.5 leading-snug">{ind.description}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {ind.feedCount} active {ind.feedCount === 1 ? 'source' : 'sources'}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selection summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-gray-700">
              {selected.size === 0
                ? 'No categories selected'
                : `${selected.size} ${selected.size === 1 ? 'category' : 'categories'} selected`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                <Check className="w-4 h-4" /> Saved!
              </span>
            )}
            {error && <span className="text-sm text-red-500">{error}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>

      {/* Explanation */}
      <p className="text-center text-xs text-gray-400">
        Your selected feeds will be mixed into the &ldquo;Local News&rdquo; lane of future posts, giving your content a national-trending angle alongside hyper-local stories.
      </p>
    </div>
  );
}
