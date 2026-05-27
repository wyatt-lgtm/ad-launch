'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Sparkles, Image as ImageIcon, Loader2, AlertCircle, Globe, ThumbsUp, MessageCircle, Share2, MoreHorizontal, Building2, Newspaper, CalendarHeart } from 'lucide-react';
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

  const ads: Ad[] = analysis?.ads ?? [];
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

  // Group ads by lane
  const adsByLane: Record<string, Ad[]> = { website: [], news: [], holiday: [] };
  for (const ad of ads) {
    // Normalize seasonal → holiday
    let lane = ad.lane;
    if (lane === 'seasonal') lane = 'holiday';
    if (lane && adsByLane[lane]) {
      adsByLane[lane].push(ad);
    } else {
      // Legacy fallback
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
                      className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" /> Download Post
                    </button>
                  </div>
                </motion.div>
              )) : (
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
                  <Icon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No post generated</p>
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
        <WebsiteConcept data={websiteConceptData} locked={false} collapsed={true} />
      </div>

      {/* Google Search Ad Copy — collapsed */}
      <div className="mb-12">
        <GoogleAdsCopy data={googleAdsData} locked={false} collapsed={true} />
      </div>

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
