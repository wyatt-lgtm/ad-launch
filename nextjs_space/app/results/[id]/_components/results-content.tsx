'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Mail, Sparkles, BarChart3, CalendarDays, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

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
            className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all overflow-hidden border border-gray-100"
          >
            <div className="relative aspect-[4/3] bg-gradient-to-br from-blue-50 to-indigo-50">
              {ad?.imageUrl ? (
                <img src={ad.imageUrl} alt={ad?.headline ?? `Ad ${i + 1}`} className="w-full h-full object-cover" onError={(e: any) => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-blue-300">
                  <ImageIcon className="w-16 h-16 mb-2" />
                  <span className="text-sm">Ad {i + 1}</span>
                </div>
              )}
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-2 text-sm">{ad?.headline ?? `Facebook Ad ${i + 1}`}</h3>
              <p className="text-gray-600 text-sm mb-4">{ad?.caption ?? 'Ad copy here.'}</p>
              <button
                onClick={() => {
                  if (ad?.imageUrl) {
                    const a = document.createElement('a');
                    a.href = ad.imageUrl;
                    a.download = `ad-${i + 1}.jpg`;
                    a.target = '_blank';
                    a.click();
                  }
                }}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
          </motion.div>
        )) : (
          [0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
              <div className="aspect-[4/3] bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center text-blue-300">
                <ImageIcon className="w-16 h-16" />
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-2 text-sm">Facebook Ad {i + 1}</h3>
                <p className="text-gray-600 text-sm">Your ad content is being prepared.</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* SEO Insights */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">SEO Insights</h2>
        </div>
        {seoData && typeof seoData === 'object' && Object.keys(seoData ?? {}).length > 0 ? (
          <div className="space-y-3">
            {Object.entries(seoData ?? {}).map(([key, value]: [string, any]) => (
              <div key={key} className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700 capitalize">{key?.replace?.(/_/g, ' ') ?? key}</p>
                <p className="text-sm text-gray-600 mt-1">{typeof value === 'string' ? value : JSON.stringify(value)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">SEO insights will be available once the full analysis completes.</p>
        )}
      </motion.div>

      {/* Posting Plan */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-purple-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">90-Day Posting Plan</h2>
        </div>
        {postingPlan && typeof postingPlan === 'object' && Object.keys(postingPlan ?? {}).length > 0 ? (
          <div className="space-y-3">
            {Object.entries(postingPlan ?? {}).map(([key, value]: [string, any]) => (
              <div key={key} className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700 capitalize">{key?.replace?.(/_/g, ' ') ?? key}</p>
                <p className="text-sm text-gray-600 mt-1">{typeof value === 'string' ? value : JSON.stringify(value)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Your 90-day posting plan will be available once the full analysis completes.</p>
        )}
      </motion.div>

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
