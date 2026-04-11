'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Globe, Loader2, Sparkles, ChevronRight,
  MapPin, Building2, Image as ImageIcon, FileText, Plus,
} from 'lucide-react';
import UrlInputForm from '../../components/url-input-form';

interface BusinessItem {
  id: string;
  websiteUrl: string;
  businessName: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { analyses: number };
  analyses: {
    id: string;
    status: string;
    createdAt: string;
    ads: { id: string }[];
    socialPosts: { id: string }[];
  }[];
}

export default function DashboardContent() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (sessionStatus === 'authenticated') {
      fetchBusinesses();
    }
  }, [sessionStatus, router]);

  const fetchBusinesses = async () => {
    try {
      const res = await fetch('/api/user/businesses');
      const data = await res.json().catch(() => ({}));
      setBusinesses(data?.businesses ?? []);
    } catch (err: any) {
      console.error('Fetch businesses error:', err);
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
        <button
          onClick={() => setShowNewAnalysis(!showNewAnalysis)}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Business
        </button>
      </div>

      {/* New Analysis — collapsible */}
      {showNewAnalysis && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-10"
        >
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" /> Analyze a New Business
          </h2>
          <UrlInputForm />
        </motion.div>
      )}

      {/* Business List */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">Your Businesses</h2>
      {businesses.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No businesses yet. Analyze a website URL to get started.</p>
          {!showNewAnalysis && (
            <button
              onClick={() => setShowNewAnalysis(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Your First Business
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {businesses.map((biz, i) => {
            const totalAds = biz.analyses.reduce((sum, a) => sum + (a.ads?.length ?? 0), 0);
            const totalPosts = biz.analyses.reduce((sum, a) => sum + (a.socialPosts?.length ?? 0), 0);
            const latestAnalysis = biz.analyses[0];
            const displayName = biz.businessName || new URL(biz.websiteUrl).hostname.replace('www.', '');
            const locationStr = [biz.businessCity, biz.businessState].filter(Boolean).join(', ');

            return (
              <motion.div
                key={biz.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => {
                  // Go to latest analysis result or analysis tracker
                  if (latestAnalysis) {
                    const route = latestAnalysis.status === 'completed'
                      ? `/results/${latestAnalysis.id}`
                      : `/analyze/${latestAnalysis.id}`;
                    router.push(route);
                  } else {
                    setShowNewAnalysis(true);
                  }
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base truncate">{displayName}</h3>
                      <p className="text-xs text-gray-400 truncate">{biz.websiteUrl.replace(/^https?:\/\//, '')}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors flex-shrink-0 mt-1" />
                </div>

                {/* Location */}
                {locationStr && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-3">
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    {locationStr}{biz.businessZip ? ` ${biz.businessZip}` : ''}
                  </div>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs text-gray-400 pt-3 border-t border-gray-100">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" /> {biz._count.analyses} {biz._count.analyses === 1 ? 'analysis' : 'analyses'}
                  </span>
                  {totalAds > 0 && (
                    <span className="flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {totalAds} ads
                    </span>
                  )}
                  {totalPosts > 0 && (
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" /> {totalPosts} posts
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
