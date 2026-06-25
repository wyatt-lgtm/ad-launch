'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Globe, Loader2, Sparkles, ChevronRight,
  MapPin, Building2, Image as ImageIcon, FileText, Plus,
  Zap, CheckCircle2, AlertCircle, Link2, ChevronDown, X,
} from 'lucide-react';
import UrlInputForm from '../../components/url-input-form';
import CreditBadge from '../../components/credit-badge';
import BillingSection from '../../components/billing-section';
import { useActiveBusiness } from '@/hooks/use-active-business';

const STORAGE_KEY = 'adlaunch_active_business_id';

interface BusinessItem {
  id: string;
  websiteUrl: string;
  businessName: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  ghlLocationId: string | null;
  ghlSubtenantId: string | null;
  ghlProvisioningStatus: string | null;
  ghlProvisionedAt: string | null;
  ghlProvisioningError: string | null;
  ghlConnectionType: string | null;
  ghlLinkedAt: string | null;
  ghlLinkNotes: string | null;
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
  const bizCtx = useActiveBusiness();
  const [businesses, setBusinesses] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [provisioningIds, setProvisioningIds] = useState<Set<string>>(new Set());
  const [linkModalBizId, setLinkModalBizId] = useState<string | null>(null);
  const [linkLocationId, setLinkLocationId] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [crmDropdownId, setCrmDropdownId] = useState<string | null>(null);

  const handleProvisionGhl = async (bizId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCrmDropdownId(null);
    setProvisioningIds(prev => new Set(prev).add(bizId));
    try {
      const res = await fetch(`/api/businesses/${bizId}/ghl/provision`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToastMsg(data.alreadyProvisioned ? 'Launch CRM already connected' : 'Launch CRM account created!');
        await fetchBusinesses();
      } else {
        setToastMsg(`Launch CRM setup failed: ${data.detail || data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setToastMsg('Launch CRM setup failed: Network error');
    }
    setProvisioningIds(prev => { const s = new Set(prev); s.delete(bizId); return s; });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const handleLinkExisting = async () => {
    if (!linkModalBizId || !linkLocationId.trim()) return;
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/businesses/${linkModalBizId}/ghl/link-existing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghlLocationId: linkLocationId.trim(),
          notes: linkNotes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToastMsg(data.alreadyLinked ? 'Launch CRM already linked' : 'Launch CRM account linked!');
        setLinkModalBizId(null);
        setLinkLocationId('');
        setLinkNotes('');
        await fetchBusinesses();
      } else if (res.status === 409) {
        setLinkError(data.message || 'This CRM location is already linked to another business.');
      } else if (res.status === 422) {
        setLinkError(data.message || 'Could not verify this CRM location ID.');
      } else {
        setLinkError(data.message || data.error || 'Failed to link CRM account.');
      }
    } catch (err: any) {
      setLinkError('Network error. Please try again.');
    }
    setLinkLoading(false);
    setTimeout(() => setToastMsg(null), 5000);
  };

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
                className={`bg-white rounded-xl p-5 shadow-sm border-2 transition-all cursor-pointer group ${
                  bizCtx.activeBusiness?.id === biz.id
                    ? 'border-blue-500 ring-2 ring-blue-200 shadow-blue-100'
                    : 'border-gray-100 hover:shadow-md hover:border-gray-200'
                }`}
                onClick={() => {
                  // Set active business via hook (handles localStorage + cross-tab sync)
                  bizCtx.setActiveBusiness({
                    id: biz.id,
                    websiteUrl: biz.websiteUrl,
                    businessName: biz.businessName,
                    businessDomain: (() => { try { return new URL(biz.websiteUrl.startsWith('http') ? biz.websiteUrl : `https://${biz.websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return biz.websiteUrl; } })(),
                    businessCity: biz.businessCity,
                    businessState: biz.businessState,
                    businessZip: biz.businessZip,
                    tombstoneBusinessId: (biz as any).tombstoneBusinessId ?? null,
                    createdAt: biz.createdAt,
                    updatedAt: biz.updatedAt,
                    _count: biz._count,
                  });
                  // Show toast
                  setToastMsg(`Current Business set to ${displayName}`);
                  setTimeout(() => setToastMsg(null), 3000);
                  // Navigate
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

                {/* Launch CRM Status */}
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  {biz.ghlProvisioningStatus === 'provisioned' ? (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5 w-fit">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Launch CRM Connected
                    </div>
                  ) : biz.ghlProvisioningStatus === 'failed' ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Launch CRM Failed
                      </div>
                      <button
                        onClick={(e) => handleProvisionGhl(biz.id, e)}
                        disabled={provisioningIds.has(biz.id)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : provisioningIds.has(biz.id) || biz.ghlProvisioningStatus === 'pending' ? (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 w-fit">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Provisioning Launch CRM…
                    </div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setCrmDropdownId(crmDropdownId === biz.id ? null : biz.id); }}
                        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5 transition-colors"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Launch CRM Setup
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {crmDropdownId === biz.id && (
                        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
                          <button
                            onClick={(e) => { handleProvisionGhl(biz.id, e); }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Zap className="w-3.5 h-3.5 text-blue-500" />
                            Create New CRM Account
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCrmDropdownId(null); setLinkModalBizId(biz.id); setLinkLocationId(''); setLinkNotes(''); setLinkError(null); }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                            Link Existing CRM Account
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Credits */}
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  <CreditBadge businessId={biz.id} />
                </div>

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

      {/* Billing section for first business */}
      {businesses.length > 0 && (
        <div className="mt-8">
          <BillingSection businessId={businesses[0].id} />
        </div>
      )}

      {/* Link Existing CRM Modal */}
      {linkModalBizId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setLinkModalBizId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Link Existing Launch CRM Account</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {businesses.find(b => b.id === linkModalBizId)?.businessName || 'Business'}
                </p>
              </div>
              <button onClick={() => setLinkModalBizId(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 pb-2">
              <p className="text-sm text-gray-600">
                Link an existing Launch CRM account to this business. This will not create a new CRM account. Use this when the business already has a Launch CRM location.
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CRM Location ID <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={linkLocationId}
                  onChange={e => setLinkLocationId(e.target.value)}
                  placeholder="e.g. abc123xyz"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={linkNotes}
                  onChange={e => setLinkNotes(e.target.value)}
                  placeholder="e.g. Existing Blazing Hog CRM account"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              {linkError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {linkError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => setLinkModalBizId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLinkExisting}
                disabled={linkLoading || !linkLocationId.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {linkLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {linkLoading ? 'Validating...' : 'Link CRM Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 animate-fade-in-up">
          <Building2 className="w-4 h-4" />
          {toastMsg}
        </div>
      )}
    </div>
  );
}
