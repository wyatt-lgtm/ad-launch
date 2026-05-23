'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, ArrowRight, Loader2, AlertCircle, Newspaper, CalendarHeart, Building2, Sparkles, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

const LANE_META = {
  website:  { label: 'From Your Website',   icon: Building2,     gradient: 'from-blue-500 to-indigo-600' },
  news:     { label: 'Local News & Events', icon: Newspaper,     gradient: 'from-emerald-500 to-teal-600' },
  holiday:  { label: 'Upcoming Holidays',   icon: CalendarHeart, gradient: 'from-amber-500 to-orange-600' },
} as const;

const LANE_ORDER: Array<'website' | 'news' | 'holiday'> = ['website', 'news', 'holiday'];

/* ─────────────────── Main Landing Content ──────────────── */
export default function LandingContent() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  /* ── Submit handler — calls /api/analyze and redirects to /analyze/[id] ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = url?.trim() ?? '';
    if (!trimmed) { setError('Please enter a website URL'); return; }

    setLoading(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || 'Failed to analyze website');
        setLoading(false);
        return;
      }

      if (data?.analysisId) {
        // Cache scraped address / places in sessionStorage so /analyze/[id] picks them up
        if (data.scrapedAddress) {
          sessionStorage.setItem(`scraped_${data.analysisId}`, JSON.stringify(data.scrapedAddress));
        }
        if (data.places && data.places.length > 0) {
          sessionStorage.setItem(`places_${data.analysisId}`, JSON.stringify(data.places));
        }
        // Redirect to the unified analysis/tracking page
        router.push(`/analyze/${data.analysisId}`);
      } else {
        setError('Unexpected response. Please try again.');
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Analyze error:', err);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <main className="flex-1">
      {/* ═══ Hero ═══ */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-conic from-blue-500/5 via-transparent to-indigo-500/5 rounded-full blur-2xl" />
        </div>

        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-24 pb-28 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 bg-white/10 text-blue-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6 backdrop-blur-sm border border-white/10">
              <Sparkles className="w-4 h-4" /> 3 ready-to-post creatives · Completely free
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
              Turn Your Website Into a
              <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent block">
                Social Posting Factory
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              Enter your website URL and our AI agents will analyze your business, 
              craft copy, and generate 3 ready-to-post social media creatives.
            </p>
          </motion.div>

          {/* ── URL Input ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
              <div className="relative flex items-center bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 hover:border-blue-400/40 transition-all focus-within:border-blue-400/60 focus-within:bg-white/[0.12] overflow-hidden">
                <div className="pl-5">
                  <Globe className="w-5 h-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(''); }}
                  placeholder="yourwebsite.com"
                  className="flex-1 px-4 py-4 bg-transparent outline-none text-white placeholder-slate-500 text-base"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="m-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition-all disabled:opacity-50 flex items-center gap-2 text-sm whitespace-nowrap shadow-lg shadow-blue-600/25"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {loading ? 'Analyzing...' : 'Get 3 Posts'}
                </button>
              </div>
              {error && (
                <div className="mt-3 flex items-center gap-2 text-red-400 text-sm justify-center">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
            </form>
            <p className="text-center text-sm text-slate-500 mt-4">
              No signup required · Confirm your location · Watch posts generate live
            </p>
          </motion.div>
        </div>
      </section>

      {/* ═══ How It Works ═══ */}
      <section className="py-20 bg-white">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              9 Posts. 3 Angles. <span className="text-blue-600">2 Easy.</span>
            </h2>
            <p className="text-gray-600 max-w-xl mx-auto">We scan your website, pull local news, and match upcoming holidays to create a complete social calendar.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {LANE_ORDER.map((lane, i) => {
              const meta = LANE_META[lane];
              const Icon = meta.icon;
              const descriptions = {
                website: 'We extract your brand voice, offers, and services to craft promotional posts that sound like you.',
                news: 'We pull local headlines, community events, and trending stories relevant to your area.',
                holiday: 'We match upcoming holidays and seasonal moments to create timely, engaging content.',
              };
              return (
                <motion.div
                  key={lane}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-gray-50 rounded-2xl p-6 hover:shadow-lg transition-all group h-full"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{meta.label}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{descriptions[lane]}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to Fill Your Social Feed?</h2>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">Enter your website above and watch our AI agents craft 9 posts in real time.</p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-2 bg-white text-blue-700 px-8 py-4 rounded-xl font-bold hover:bg-blue-50 transition-all shadow-lg"
          >
            Try It Free <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </section>
    </main>
  );
}
