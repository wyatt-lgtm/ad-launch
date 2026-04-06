'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Sparkles, Image as ImageIcon, Loader2, AlertCircle, Globe, ThumbsUp, MessageCircle, Share2, MoreHorizontal } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import SeoInsights from '../../../components/seo-insights';
import PostingPlan from '../../../components/posting-plan';
import GoogleAdsCopy from '../../../components/google-ads-copy';
import WebsiteConcept from '../../../components/website-concept';
import BudgetRecommendations from '../../../components/budget-recommendations';

interface Ad {
  id: string;
  imageUrl: string | null;
  caption: string | null;
  headline: string | null;
  watermarked: boolean;
}

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
  const angleLabels = ['Awareness', 'Conversion', 'Trust'];
  const angleColors = ['bg-blue-500', 'bg-orange-500', 'bg-green-500'];

  const businessName = seoData?.businessName ?? 'Your Business';
  const websiteUrl = analysis?.websiteUrl ?? '';
  const displayDomain = (() => { try { return new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const initials = businessName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('');

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Your Ad Assets</h1>
        <p className="text-gray-500">Analysis of <span className="font-medium text-blue-600">{analysis?.websiteUrl ?? 'your website'}</span></p>
      </div>

      {/* Ads */}
      <div className="grid md:grid-cols-3 gap-6 mb-12">
        {ads.length > 0 ? ads.map((ad: Ad, i: number) => (
          <motion.div
            key={ad?.id ?? i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 max-w-[400px] mx-auto"
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
              <p className="text-[13px] text-gray-800 leading-snug line-clamp-2">{ad?.caption ?? 'Ad copy here.'}</p>
            </div>
            {/* Ad Image */}
            <div className="relative bg-gray-100">
              {ad?.imageUrl ? (
                <img src={ad.imageUrl} alt={ad?.headline ?? `Ad ${i + 1}`} className="w-full h-auto block" onError={(e: any) => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-full aspect-[4/5] flex flex-col items-center justify-center text-gray-300">
                  <ImageIcon className="w-16 h-16 mb-2" />
                  <span className="text-sm">Ad {i + 1}</span>
                </div>
              )}
              <div className="absolute top-3 left-3">
                <span className={`${angleColors[i] ?? 'bg-gray-500'} text-white text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide shadow-sm`}>
                  {angleLabels[i] ?? `Ad ${i + 1}`}
                </span>
              </div>
            </div>
            {/* Link preview */}
            {displayDomain && (
              <div className="mx-4 mt-2 mb-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{displayDomain}</div>
                <div className="text-[13px] font-semibold text-gray-900 truncate">{ad?.headline || `Facebook Ad ${i + 1}`}</div>
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
                onClick={() => {
                  if (ad?.imageUrl) {
                    const a = document.createElement('a');
                    a.href = ad.imageUrl;
                    a.download = `ad-${i + 1}.png`;
                    a.target = '_blank';
                    a.click();
                  }
                }}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Download Ad
              </button>
            </div>
          </motion.div>
        )) : (
          [0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 max-w-[400px] mx-auto">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div className="flex-1"><div className="h-3 bg-gray-200 rounded w-24 mb-1.5" /><div className="h-2 bg-gray-100 rounded w-16" /></div>
              </div>
              <div className="aspect-[4/5] bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-gray-300">
                <ImageIcon className="w-16 h-16" />
              </div>
              <div className="p-4">
                <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
                <div className="h-2 bg-gray-100 rounded w-full" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Google Search Ad Copy */}
      <div className="mb-8">
        <GoogleAdsCopy data={googleAdsData} locked={false} />
      </div>

      {/* SEO Insights */}
      <div className="mb-8">
        <SeoInsights data={seoData} locked={false} />
      </div>

      {/* Website Concept */}
      <div className="mb-8">
        <WebsiteConcept data={websiteConceptData} locked={false} />
      </div>

      {/* 90-Day Posting Plan */}
      <div className="mb-8">
        <PostingPlan data={postingPlan} locked={false} />
      </div>

      {/* Budget Recommendations */}
      <div className="mb-12">
        <BudgetRecommendations data={budgetData} locked={false} />
      </div>

      {/* Generate More CTA */}
      <div className="text-center bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-8">
        <Sparkles className="w-8 h-8 text-white mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white mb-2">Want More Ads?</h2>
        <p className="text-blue-100 mb-6">Generate additional sets of 3 ads for your business.</p>
        <button className="px-8 py-3 bg-white text-blue-700 rounded-xl font-bold hover:bg-blue-50 transition-all">
          Generate More Ads
        </button>
      </div>
    </div>
  );
}
