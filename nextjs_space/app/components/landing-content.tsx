'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { Globe, ArrowRight, Loader2, AlertCircle, Newspaper, CalendarHeart, Building2, Sparkles, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

/* ───────────────────────── Types ───────────────────────── */
interface DemoPost {
  id: string;
  lane: 'website' | 'news' | 'holiday';
  headline: string;
  caption: string;
  imageUrl?: string;
  hashtags?: string[];
}

const LANE_META = {
  website:  { label: 'From Your Website',   icon: Building2,     gradient: 'from-blue-500 to-indigo-600',   badge: 'bg-blue-100 text-blue-700' },
  news:     { label: 'Local News & Events', icon: Newspaper,     gradient: 'from-emerald-500 to-teal-600', badge: 'bg-emerald-100 text-emerald-700' },
  holiday:  { label: 'Upcoming Holidays',   icon: CalendarHeart, gradient: 'from-amber-500 to-orange-600',  badge: 'bg-amber-100 text-amber-700' },
} as const;

const LANE_ORDER: Array<'website' | 'news' | 'holiday'> = ['website', 'news', 'holiday'];

/* ─────────────────── Hazy Placeholder Card ─────────────── */
function HazyCard({ laneIdx, cardIdx }: { laneIdx: number; cardIdx: number }) {
  return (
    <div className="relative rounded-2xl overflow-hidden aspect-[4/5] bg-gradient-to-br from-gray-200 via-gray-100 to-gray-200">
      {/* Animated shimmer */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
      {/* Blurry content ghost */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 gap-3">
        <div className="w-16 h-16 rounded-full bg-gray-300/60 blur-sm" />
        <div className="w-3/4 h-4 rounded-full bg-gray-300/50 blur-[2px]" />
        <div className="w-2/3 h-3 rounded-full bg-gray-300/40 blur-[2px]" />
        <div className="w-1/2 h-3 rounded-full bg-gray-300/30 blur-[2px]" />
        <div className="mt-4 w-3/5 h-8 rounded-lg bg-gray-300/40 blur-[3px]" />
      </div>
      {/* Slot number */}
      <div className="absolute bottom-3 right-3 w-7 h-7 rounded-full bg-white/60 backdrop-blur flex items-center justify-center text-xs font-bold text-gray-400">
        {laneIdx * 3 + cardIdx + 1}
      </div>
    </div>
  );
}

/* ─────────────────── Revealed Post Card ────────────────── */
function PostCard({ post }: { post: DemoPost }) {
  const meta = LANE_META[post.lane];
  const Icon = meta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, filter: 'blur(12px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="relative rounded-2xl overflow-hidden bg-white shadow-lg shadow-gray-200/80 border border-gray-100 group"
    >
      {/* Image */}
      <div className="relative aspect-[4/5] bg-gray-100 overflow-hidden">
        {post.imageUrl ? (
          <img
            src={post.imageUrl}
            alt={post.headline}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
            <Icon className="w-16 h-16 text-white/30" />
          </div>
        )}
        {/* Lane badge */}
        <div className={`absolute top-3 left-3 ${meta.badge} px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 backdrop-blur-sm`}>
          <Icon className="w-3.5 h-3.5" /> {meta.label}
        </div>
      </div>
      {/* Caption */}
      <div className="p-4">
        <h4 className="font-bold text-gray-900 text-sm leading-snug mb-1.5 line-clamp-2">{post.headline}</h4>
        <p className="text-gray-500 text-xs leading-relaxed line-clamp-3">{post.caption}</p>
        {post.hashtags && post.hashtags.length > 0 && (
          <p className="mt-2 text-xs text-blue-500 font-medium truncate">{post.hashtags.slice(0, 4).map(h => `#${h}`).join(' ')}</p>
        )}
      </div>
    </motion.div>
  );
}

/* ─────────────────── Main Landing Content ──────────────── */
export default function LandingContent() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [posts, setPosts] = useState<DemoPost[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState('');
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);

  /* ── Submit handler ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = url?.trim() ?? '';
    if (!trimmed) { setError('Please enter a website URL'); return; }

    setLoading(true);
    setGenerating(true);
    setPosts([]);

    // Scroll to grid
    setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);

    try {
      const res = await fetch('/api/demo-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Failed to generate posts');
        setLoading(false);
        setGenerating(false);
        return;
      }

      // Stream SSE for progressive reveal
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6);
              if (raw === '[DONE]') continue;
              try {
                const evt = JSON.parse(raw);
                if (evt.type === 'phase') {
                  setGenerationPhase(evt.message);
                } else if (evt.type === 'post') {
                  setPosts(prev => {
                    const idx = prev.findIndex(p => p.id === evt.post.id);
                    if (idx >= 0) {
                      const updated = [...prev];
                      updated[idx] = { ...updated[idx], ...evt.post };
                      return updated;
                    }
                    return [...prev, evt.post];
                  });
                } else if (evt.type === 'error') {
                  setError(evt.message);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Demo posts error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      setGenerating(false);
      setGenerationPhase('');
    }
  };

  /* ── Grid helpers ── */
  const getPostsForLane = (lane: 'website' | 'news' | 'holiday') =>
    posts.filter(p => p.lane === lane);

  const showGrid = generating || posts.length > 0;

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
              <Sparkles className="w-4 h-4" /> 9 sample posts · Completely free
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
              Turn Your Website Into a
              <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent block">
                Social Posting Factory
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              Enter your website URL and watch 9 ready-to-post social media posts appear — 
              3 from your website, 3 from local news, and 3 for upcoming holidays.
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
                  {loading ? 'Generating...' : 'Get 9 Posts'}
                </button>
              </div>
              {error && (
                <div className="mt-3 flex items-center gap-2 text-red-400 text-sm justify-center">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
            </form>
            <p className="text-center text-sm text-slate-500 mt-4">
              No signup required · See your posts in real time
            </p>
          </motion.div>
        </div>
      </section>

      {/* ═══ Post Grid ═══ */}
      <section
        ref={gridRef}
        className={`transition-all duration-500 ${
          showGrid ? 'py-16 bg-gray-50' : 'py-0 h-0 overflow-hidden'
        }`}
      >
        {showGrid && (
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
            {/* Phase indicator */}
            {generating && generationPhase && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center mb-8"
              >
                <div className="inline-flex items-center gap-3 bg-white px-6 py-3 rounded-full shadow-sm border border-gray-100">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="text-sm font-medium text-gray-700">{generationPhase}</span>
                </div>
              </motion.div>
            )}

            {/* 3-column lane layout */}
            <div className="grid md:grid-cols-3 gap-8">
              {LANE_ORDER.map((lane, laneIdx) => {
                const meta = LANE_META[lane];
                const Icon = meta.icon;
                const lanePosts = getPostsForLane(lane);

                return (
                  <div key={lane}>
                    {/* Lane header */}
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      <h3 className="font-bold text-gray-900 text-sm">{meta.label}</h3>
                      <span className="ml-auto text-xs text-gray-400 font-medium">{lanePosts.length}/3</span>
                    </div>

                    {/* 3 card slots */}
                    <div className="space-y-4">
                      {[0, 1, 2].map(cardIdx => {
                        const post = lanePosts[cardIdx];
                        return (
                          <div key={`${lane}-${cardIdx}`}>
                            <AnimatePresence mode="wait">
                              {post ? (
                                <PostCard key={post.id} post={post} />
                              ) : (
                                <HazyCard key={`hazy-${lane}-${cardIdx}`} laneIdx={laneIdx} cardIdx={cardIdx} />
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Completion CTA */}
            {!generating && posts.length >= 9 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-center mt-12"
              >
                <div className="inline-flex flex-col items-center gap-4 bg-white rounded-2xl px-8 py-6 shadow-lg border border-gray-100">
                  <p className="text-lg font-bold text-gray-900">Your posts are ready! 🎉</p>
                  <p className="text-sm text-gray-500">Sign up with your business email to unlock full posting schedules and more.</p>
                  <button
                    onClick={() => router.push('/signup')}
                    className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/25"
                  >
                    Get Started Free <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </section>

      {/* ═══ How It Works (shown when grid is not active) ═══ */}
      {!showGrid && (
        <>
          <section className="py-20 bg-white">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
              <div className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
                  9 Posts. 3 Angles. <span className="text-blue-600">Zero Effort.</span>
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
              <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">Enter your website above and watch 9 posts materialize in real time.</p>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-2 bg-white text-blue-700 px-8 py-4 rounded-xl font-bold hover:bg-blue-50 transition-all shadow-lg"
              >
                Try It Free <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
