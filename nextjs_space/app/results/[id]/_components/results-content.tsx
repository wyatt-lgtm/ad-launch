'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Sparkles, Image as ImageIcon, Loader2, AlertCircle, Globe, ThumbsUp, MessageCircle, Share2, MoreHorizontal, Building2, Newspaper, CalendarHeart, Calendar, CheckCircle2, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';

const SchedulingWizard = dynamic(() => import('../../../components/scheduling-wizard'), { ssr: false });
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import SeoInsights from '../../../components/seo-insights';
import PostingPlan from '../../../components/posting-plan';
import GoogleAdsCopy from '../../../components/google-ads-copy';
import WebsiteConcept from '../../../components/website-concept';
// BudgetRecommendations removed per user request

interface Ad {
  id: string;
  imageUrl: string | null;
  caption: string | null;
  headline: string | null;
  watermarked: boolean;
  lane?: string | null;
}

const LANE_CONFIG: Record<string, { label: string; description: string; icon: React.ElementType; color: string; bgColor: string; badgeColor: string }> = {
  website: { label: 'Website / Brand', description: 'Created from your website content', icon: Building2, color: 'text-blue-600', bgColor: 'bg-blue-50', badgeColor: 'bg-blue-500' },
  news:    { label: 'Local News', description: 'Tied to local news in your area', icon: Newspaper, color: 'text-amber-600', bgColor: 'bg-amber-50', badgeColor: 'bg-amber-500' },
  holiday:  { label: 'Upcoming Holiday', description: 'Tied to upcoming calendar events', icon: CalendarHeart, color: 'text-rose-600', bgColor: 'bg-rose-50', badgeColor: 'bg-rose-500' },
  seasonal: { label: 'Upcoming Holiday', description: 'Tied to upcoming calendar events', icon: CalendarHeart, color: 'text-rose-600', bgColor: 'bg-rose-50', badgeColor: 'bg-rose-500' },
};

export default function ResultsContent({ analysisId }: { analysisId: string }) {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const [localAds, setLocalAds] = useState<Ad[]>([]);
  const [regenLoading, setRegenLoading] = useState<Record<string, boolean>>({});
  const [regenError, setRegenError] = useState<Record<string, string | null>>({});

  // Keep ads in sync when analysis loads/refetches
  useEffect(() => {
    if (analysis?.ads) setLocalAds(analysis.ads);
  }, [analysis]);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setAnalysis(data?.analysis ?? null);
        } else {
          setError(data?.error ?? 'Failed to load results');
        }
      } catch (err: any) {
        console.error('Fetch error:', err);
        setError('Failed to load results');
      }
      setLoading(false);
    };
    if (analysisId && sessionStatus === 'authenticated') fetchAnalysis();
  }, [analysisId, sessionStatus, router]);

  // Safety net: if analysis loaded but some lanes are empty, retry up to 3 times
  // This catches ads created by the completion path just after initial fetch,
  // or lanes still being processed by the async pipeline
  const retryCountRef = React.useRef(0);
  const MAX_LANE_RETRIES = 3;
  const RETRY_DELAYS = [4000, 8000, 15000]; // escalating delays
  useEffect(() => {
    if (!analysis || retryCountRef.current >= MAX_LANE_RETRIES) return;
    const currentAds: Ad[] = analysis?.ads ?? [];
    const lanes = new Set(currentAds.map((a: Ad) => a.lane === 'seasonal' ? 'holiday' : a.lane).filter(Boolean));
    if (lanes.size < 3 && analysis?.status === 'completed') {
      const delay = RETRY_DELAYS[retryCountRef.current] ?? 15000;
      retryCountRef.current += 1;
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/analysis/${analysisId}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.analysis) {
            const newAds: Ad[] = data.analysis.ads ?? [];
            const newLanes = new Set(newAds.map((a: Ad) => a.lane === 'seasonal' ? 'holiday' : a.lane).filter(Boolean));
            // Only update if we gained new lanes or ads
            if (newLanes.size > lanes.size || newAds.length > currentAds.length) {
              setAnalysis(data.analysis);
            }
          }
        } catch { /* ignore */ }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [analysis, analysisId]);

  if (loading || sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  // If analysis isn't completed yet, redirect back to the tracker page
  if (analysis && analysis.status !== 'completed') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Still Generating Your Posts</h2>
        <p className="text-gray-500 mb-6">Your posts are still being created. You&apos;ll be redirected when they&apos;re ready.</p>
        <button
          onClick={() => router.push(`/analyze/${analysisId}`)}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Back to Progress Tracker
        </button>
      </div>
    );
  }

  const ads = localAds;

  // Analysis is completed but zero ads exist — something went wrong in generation
  if (analysis && ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Posts Still Finalizing</h2>
        <p className="text-gray-500 mb-6 max-w-md">Your analysis completed but the post images are still being processed. Please check back in a moment.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Refresh Results
        </button>
      </div>
    );
  }

  const seoData = analysis?.seoData ?? null;
  const postingPlan = analysis?.postingPlan ?? null;
  const cachedResults = analysis?.results ?? {};
  const googleAdsData = (cachedResults as any)?.googleAds ?? null;
  const websiteConceptData = (cachedResults as any)?.websiteConcept ?? null;
  const budgetData = (cachedResults as any)?.budget ?? null;

  const businessName = seoData?.businessName ?? 'Your Business';
  const websiteUrl = analysis?.websiteUrl ?? '';
  const displayDomain = (() => { try { return new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const initials = businessName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('');

  const handleRegenerateLane = async (lane: string, existingAdId?: string) => {
    setRegenLoading(prev => ({ ...prev, [lane]: true }));
    setRegenError(prev => ({ ...prev, [lane]: null }));
    try {
      const res = await fetch('/api/post-assets/regenerate-lane', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: analysisId,
          lane_type: lane,
          existing_asset_id: existingAdId,
          reason: 'user_requested_regeneration',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRegenError(prev => ({ ...prev, [lane]: data.error || 'Regeneration failed' }));
        return;
      }
      // Replace the ad in local state — only this lane
      setLocalAds(prevAds => {
        const newAd: Ad = data.ad;
        if (existingAdId) {
          return prevAds.map(a => a.id === existingAdId ? newAd : a);
        }
        // Remove old ads for this lane and add the new one
        const withoutLane = prevAds.filter(a => {
          const aLane = a.lane === 'seasonal' ? 'holiday' : a.lane;
          return aLane !== lane;
        });
        return [...withoutLane, newAd];
      });
      // Show image_missing warning if applicable
      if (data.asset_status === 'image_missing') {
        setRegenError(prev => ({ ...prev, [lane]: 'Post regenerated but the image is still generating. Try again in a moment.' }));
      }
    } catch (err: any) {
      setRegenError(prev => ({ ...prev, [lane]: err.message || 'Regeneration failed' }));
    } finally {
      setRegenLoading(prev => ({ ...prev, [lane]: false }));
    }
  };

  // Group ads by lane (deduplicated: latest per lane wins)
  const adsByLane: Record<string, Ad[]> = { website: [], news: [], holiday: [] };
  const seenLanes = new Set<string>();
  const sortedAds = [...ads].sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''));
  for (const ad of sortedAds) {
    let lane = ad.lane;
    if (lane === 'seasonal') lane = 'holiday';
    const dedupeKey = lane || `fallback-${ad.imageUrl}-${ad.headline}`;
    if (seenLanes.has(dedupeKey)) continue;
    seenLanes.add(dedupeKey);
    if (lane && adsByLane[lane]) {
      adsByLane[lane].push(ad);
    } else {
      if (adsByLane.website.length === 0) adsByLane.website.push(ad);
      else if (adsByLane.news.length === 0) adsByLane.news.push(ad);
      else if (adsByLane.holiday.length === 0) adsByLane.holiday.push(ad);
      else adsByLane.website.push(ad);
    }
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Your Post Assets</h1>
        <p className="text-gray-500">Analysis of <span className="font-medium text-blue-600">{analysis?.websiteUrl ?? 'your website'}</span></p>
      </div>

      {/* Posts by Lane */}
      <div className="grid md:grid-cols-3 gap-8 mb-12">
        {(['website', 'news', 'holiday'] as const).map((lane) => {
          const config = LANE_CONFIG[lane];
          const laneAds = adsByLane[lane] ?? [];
          const Icon = config.icon;

          return (
            <div key={lane} className="space-y-4">
              {/* Lane Header */}
              <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl ${config.bgColor}`}>
                <Icon className={`w-5 h-5 ${config.color}`} />
                <div>
                  <h3 className={`text-sm font-bold ${config.color}`}>{config.label}</h3>
                  <p className="text-xs text-gray-500">
                    {laneAds.length > 0 && laneAds[0].headline
                      ? laneAds[0].headline
                      : config.description}
                  </p>
                </div>
              </div>

              {/* Posts in this lane */}
              {laneAds.length > 0 ? laneAds.map((ad: Ad, i: number) => (
                <motion.div
                  key={ad?.id ?? `${lane}-${i}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200"
                >
                  {/* FB Header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {initials || 'BZ'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[13px] text-gray-900 truncate">{businessName}</div>
                      <div className="flex items-center gap-1 text-[11px] text-gray-500">
                        <span>Sponsored</span><span>&middot;</span><Globe className="w-3 h-3" />
                      </div>
                    </div>
                    <MoreHorizontal className="w-5 h-5 text-gray-400 shrink-0" />
                  </div>
                  {/* Caption */}
                  <div className="px-4 pb-2">
                    <p className="text-[13px] text-gray-800 leading-snug line-clamp-2">{ad?.caption ?? 'Post copy here.'}</p>
                  </div>
                  {/* Image */}
                  <div className="relative bg-gray-100">
                    {ad?.imageUrl ? (
                      <img src={ad.imageUrl} alt={ad?.headline ?? `${config.label} post`} className="w-full h-auto block" onError={(e: any) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full aspect-[4/5] flex flex-col items-center justify-center text-gray-300">
                        <ImageIcon className="w-16 h-16 mb-2" />
                        <span className="text-sm">{config.label}</span>
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <span className={`${config.badgeColor} text-white text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide shadow-sm`}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                  {/* Link preview */}
                  {displayDomain && (
                    <div className="mx-4 mt-2 mb-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{displayDomain}</div>
                      <div className="text-[13px] font-semibold text-gray-900 truncate">{ad?.headline || config.label}</div>
                    </div>
                  )}
                  {/* Engagement bar */}
                  <div className="flex items-center justify-around border-t border-gray-200 px-2 py-2">
                    <span className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500"><ThumbsUp className="w-4 h-4" /><span className="text-xs font-medium">Like</span></span>
                    <span className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500"><MessageCircle className="w-4 h-4" /><span className="text-xs font-medium">Comment</span></span>
                    <span className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500"><Share2 className="w-4 h-4" /><span className="text-xs font-medium">Share</span></span>
                  </div>
                  {/* Download */}
                  <div className="px-4 py-3 border-t border-gray-100">
                    <button
                      onClick={async () => {
                        if (!ad?.imageUrl) return;
                        try {
                          const res = await fetch(ad.imageUrl);
                          const blob = await res.blob();
                          const blobUrl = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = blobUrl;
                          a.download = `${lane}-post-${i + 1}.png`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(blobUrl);
                        } catch {
                          // Fallback: open in new tab
                          window.open(ad.imageUrl, '_blank');
                        }
                      }}
                      className={`w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 ${!ad?.imageUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={!ad?.imageUrl}
                    >
                      <Download className="w-4 h-4" /> Download Post
                    </button>
                    <button
                      onClick={() => handleRegenerateLane(lane, ad?.id)}
                      disabled={!!regenLoading[lane]}
                      className="w-full py-2 mt-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {regenLoading[lane] ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Regenerating…</>
                      ) : (
                        <><RefreshCw className="w-4 h-4" /> Regenerate This Post</>
                      )}
                    </button>
                    {regenError[lane] && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{regenError[lane]}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )) : (
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
                  <Icon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">This lane didn&apos;t produce a post this time</p>
                  <button
                    onClick={() => handleRegenerateLane(lane)}
                    disabled={!!regenLoading[lane]}
                    className="mt-3 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {regenLoading[lane] ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Generate This Post</>
                    )}
                  </button>
                  {regenError[lane] && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{regenError[lane]}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 90-Day Posting Plan — right after Register CTA */}
      <div className="mb-8">
        <PostingPlan data={postingPlan} locked={false} />
      </div>

      {/* SEO Insights */}
      <div className="mb-8">
        <SeoInsights data={seoData} locked={false} />
      </div>

      {/* Website Concept — collapsed by default */}
      <div className="mb-8">
        <WebsiteConcept data={websiteConceptData} locked={false} analysisId={analysisId} collapsed={true} />
      </div>

      {/* Google Search Ad Copy — collapsed */}
      <div className="mb-12">
        <GoogleAdsCopy data={googleAdsData} locked={false} collapsed={true} />
      </div>

      {/* Schedule Posts CTA */}
      <SchedulePostsCTA
        ads={ads}
        analysis={analysis}
        businessName={businessName}
      />

      {/* Generate More CTA */}
      <div className="text-center bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-8">
        <Sparkles className="w-8 h-8 text-white mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white mb-2">Want More Posts?</h2>
        <p className="text-blue-100 mb-6">Generate additional posts for each content lane.</p>
        <button className="px-8 py-3 bg-white text-blue-700 rounded-xl font-bold hover:bg-blue-50 transition-all">
          Generate More Posts
        </button>
      </div>
    </div>
  );
}

// ─── Schedule Posts CTA Component ────────────────────────────────

function SchedulePostsCTA({ ads, analysis, businessName }: { ads: Ad[]; analysis: any; businessName: string }) {
  const [showWizard, setShowWizard] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const router = useRouter();

  const businessId = analysis?.businessId;
  if (!businessId || ads.length === 0) return null;

  // Convert ads to the format the wizard expects (using socialPost IDs if available)
  const wizardPosts = ads.filter(a => a.imageUrl).map(a => ({
    id: a.id,
    caption: a.caption ?? '',
    imageUrl: a.imageUrl,
    hashtags: [] as string[],
    cta: a.headline ?? null,
    lane: a.lane ?? null,
    sourceType: 'generation' as const,
  }));

  if (scheduled) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-8"
      >
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {scheduledCount} Post{scheduledCount > 1 ? 's' : ''} Scheduled!
        </h2>
        <p className="text-gray-600 mb-6">
          Your AI marketing team has your schedule locked in. You can review and manage posts from your dashboard.
        </p>
        <button
          onClick={() => router.push('/dashboard/social/schedule')}
          className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all shadow-sm"
        >
          View Schedule Dashboard
        </button>
      </motion.div>
    );
  }

  return (
    <>
      <div className="mb-8 text-center bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-8">
        <Calendar className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Ready to put these posts to work?
        </h2>
        <p className="text-gray-600 mb-6">
          Your AI marketing team created {ads.length} post{ads.length > 1 ? 's' : ''} for <span className="font-medium">{businessName}</span>.
          Let us schedule them so you don&apos;t have to think about it.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => setShowWizard(true)}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-sm flex items-center gap-2"
          >
            <Calendar className="w-5 h-5" />
            Schedule These Posts
          </button>
          <span className="text-sm text-gray-400">or download them above</span>
        </div>
      </div>

      <AnimatePresence>
        {showWizard && (
          <SchedulingWizard
            businessId={businessId}
            businessName={businessName}
            posts={wizardPosts}
            onComplete={(result) => {
              setShowWizard(false);
              setScheduled(true);
              setScheduledCount(result.scheduledCount);
            }}
            onCancel={() => setShowWizard(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
