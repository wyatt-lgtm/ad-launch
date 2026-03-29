'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Globe, Image as ImageIcon, Loader2, AlertCircle, ExternalLink, Sparkles, ChevronRight } from 'lucide-react';
import UrlInputForm from '../../components/url-input-form';

interface Analysis {
  id: string;
  websiteUrl: string;
  status: string;
  createdAt: string;
  ads: { id: string; headline: string | null; caption: string | null; imageUrl: string | null }[];
}

export default function DashboardContent() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (sessionStatus === 'authenticated') {
      fetchAnalyses();
    }
  }, [sessionStatus, router]);

  const fetchAnalyses = async () => {
    try {
      const res = await fetch('/api/user/analyses');
      const data = await res.json().catch(() => ({}));
      setAnalyses(data?.analyses ?? []);
    } catch (err: any) {
      console.error('Fetch analyses error:', err);
    }
    setLoading(false);
  };

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const userEmail = session?.user?.email ?? '';
  const freeUsed = analyses?.length ?? 0;
  const freeRemaining = Math.max(0, 3 - freeUsed);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-10 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <LayoutDashboard className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          </div>
          <p className="text-gray-500 text-sm">{userEmail}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-blue-50 rounded-lg text-sm">
            <span className="text-blue-600 font-bold">{freeRemaining}</span>
            <span className="text-gray-600"> free analyses remaining</span>
          </div>
        </div>
      </div>

      {/* New Analysis */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-10"
      >
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" /> New Analysis
        </h2>
        <UrlInputForm />
      </motion.div>

      {/* History */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">Analysis History</h2>
      {analyses.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100 text-center">
          <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No analyses yet. Enter a website URL above to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {analyses.map((analysis: Analysis, i: number) => (
            <motion.div
              key={analysis?.id ?? i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer"
              onClick={() => {
                const route = analysis?.status === 'completed' ? `/results/${analysis.id}` : `/analyze/${analysis.id}`;
                router.push(route);
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Globe className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{analysis?.websiteUrl ?? 'Unknown URL'}</p>
                    <p className="text-xs text-gray-400">
                      {analysis?.createdAt ? new Date(analysis.createdAt).toLocaleDateString() : ''}
                      {' \u00b7 '}
                      <span className={`font-medium ${
                        analysis?.status === 'completed' ? 'text-green-600' :
                        analysis?.status === 'error' ? 'text-red-500' : 'text-yellow-600'
                      }`}>
                        {(analysis?.status ?? 'unknown')?.charAt?.(0)?.toUpperCase?.() + (analysis?.status ?? 'unknown')?.slice?.(1)}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <ImageIcon className="w-3 h-3" /> {analysis?.ads?.length ?? 0} ads
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
