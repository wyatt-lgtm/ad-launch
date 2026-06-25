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
  defaultSocialLandingPageUrl: string | null;
  defaultSocialLandingPageEnabled: boolean;
  defaultSocialCtaText: string;
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
  const [linkApiToken, setLinkApiToken] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkShowToken, setLinkShowToken] = useState(false);
  const linkBizIdHasAt = linkLocationId.includes('@');
  const [crmDropdownId, setCrmDropdownId] = useState<string | null>(null);

  // Social landing page edit modal
  const [slpModalBizId, setSlpModalBizId] = useState<string | null>(null);
  const [slpUrl, setSlpUrl] = useState('');
  const [slpEnabled, setSlpEnabled] = useState(false);
  const [slpCtaText, setSlpCtaText] = useState('Learn more here:');
  const [slpSaving, setSlpSaving] = useState(false);
  const [slpError, setSlpError] = useState<string | null>(null);
  const [slpUrlError, setSlpUrlError] = useState<string | null>(null);
  const [slpApplyTo, setSlpApplyTo] = useState<'future' | 'drafts' | 'scheduled'>('future');

  const openSlpModal = (biz: BusinessItem) => {
    setSlpModalBizId(biz.id);
    setSlpUrl(biz.defaultSocialLandingPageUrl || '');
    setSlpEnabled(biz.defaultSocialLandingPageEnabled || false);
    setSlpCtaText(biz.defaultSocialCtaText || 'Learn more here:');
    setSlpSaving(false);
    setSlpError(null);
    setSlpUrlError(null);
    setSlpApplyTo('future');
  };

  const validateSlpUrl = (value: string): boolean => {
    if (!value.trim()) { setSlpUrlError(null); return true; }
    if (!/^https?:\/\//i.test(value.trim())) {
      setSlpUrlError('URL must start with https:// or http://');
      return false;
    }
    try {
      const parsed = new URL(value.trim());
      if (!parsed.hostname || !parsed.hostname.includes('.')) throw new Error();
      if (/[\s<>{}|\\^`]/.test(value.trim())) throw new Error();
    } catch {
      setSlpUrlError('Please enter a valid landing page URL.');
      return false;
    }
    setSlpUrlError(null);
    return true;
  };

  const handleSlpSave = async () => {
    if (!slpModalBizId) return;
    if (!validateSlpUrl(slpUrl)) return;
    setSlpSaving(true);
    setSlpError(null);
    try {
      const res = await fetch(`/api/businesses/${slpModalBizId}/social-landing-page`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: slpUrl.trim(),
          enabled: slpEnabled,
          ctaText: slpCtaText.trim(),
          applyTo: slpApplyTo,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSlpModalBizId(null);
        setToastMsg('Social post settings saved!');
        setTimeout(() => setToastMsg(null), 4000);
        await fetchBusinesses();
      } else {
        setSlpError(data.error || 'Failed to save settings.');
        if (data.field === 'url') setSlpUrlError(data.error);
      }
    } catch {
      setSlpError('Network error. Please try again.');
    }
    setSlpSaving(false);
  };

  const getShortDomain = (url: string) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return parsed.hostname.replace(/^www\./, '') + (path.length > 20 ? path.slice(0, 20) + '…' : path);
    } catch { return url.slice(0, 30); }
  };

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
    if (!linkModalBizId || !linkLocationId.trim() || !linkApiToken.trim() || linkBizIdHasAt) return;
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/businesses/${linkModalBizId}/ghl/link-existing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: linkLocationId.trim(),
          apiToken: linkApiToken.trim(),
          notes: linkNotes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToastMsg(data.alreadyLinked ? 'Launch CRM already linked' : 'Launch CRM account linked!');
        setLinkModalBizId(null);
        setLinkLocationId('');
        setLinkApiToken('');
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
                            onClick={(e) => { e.stopPropagation(); setCrmDropdownId(null); setLinkModalBizId(biz.id); setLinkLocationId(''); setLinkApiToken(''); setLinkNotes(''); setLinkError(null); setLinkShowToken(false); }}
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

                {/* Social Landing Page Status */}
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  {biz.defaultSocialLandingPageEnabled && biz.defaultSocialLandingPageUrl ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5">
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Social Link: <span className="font-semibold">Set</span></span>
                        <span className="text-indigo-400 font-normal truncate max-w-[120px]">{getShortDomain(biz.defaultSocialLandingPageUrl)}</span>
                      </div>
                      <button
                        onClick={() => openSlpModal(biz)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
                      >Edit</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5">
                        <Link2 className="w-3.5 h-3.5 text-gray-400" />
                        Social Link: <span className="text-amber-600">Missing</span>
                      </div>
                      <button
                        onClick={() => openSlpModal(biz)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                      >Add</button>
                    </div>
                  )}
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
            <form autoComplete="off" onSubmit={e => { e.preventDefault(); handleLinkExisting(); }}>
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
            {/* Hidden honeypot fields absorb browser autofill so real fields stay empty */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
              <input type="text" name="fake_email_trap" tabIndex={-1} autoComplete="username" />
              <input type="password" name="fake_pw_trap" tabIndex={-1} autoComplete="current-password" />
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="crm-biz-id" className="block text-sm font-medium text-gray-700 mb-1">Launch CRM Business ID <span className="text-red-500">*</span></label>
                <input
                  id="crm-biz-id"
                  type="text"
                  name="crm_location_identifier"
                  value={linkLocationId}
                  onChange={e => setLinkLocationId(e.target.value)}
                  placeholder="Paste the Launch CRM Business ID"
                  autoComplete="one-time-code"
                  data-lpignore="true"
                  data-form-type="other"
                  data-1p-ignore="true"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder:text-gray-400 placeholder:opacity-100"
                />
                {linkBizIdHasAt ? (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    The Launch CRM Business ID is not an email address. Copy the Business ID from Launch CRM Business Profile Settings.
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Find this ID in Launch CRM under Business Profile Settings. It is not an email address.</p>
                )}
              </div>
              <div>
                <label htmlFor="crm-api-token" className="block text-sm font-medium text-gray-700 mb-1">Launch CRM API Token <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    id="crm-api-token"
                    type="text"
                    name="crm_bearer_credential"
                    value={linkApiToken}
                    onChange={e => setLinkApiToken(e.target.value)}
                    placeholder="Paste the Launch CRM API Token"
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-form-type="other"
                    data-1p-ignore="true"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono placeholder:text-gray-400 placeholder:opacity-100 placeholder:font-sans"
                    style={!linkShowToken && linkApiToken ? { WebkitTextSecurity: 'disc', textSecurity: 'disc' } as React.CSSProperties : undefined}
                  />
                  {linkApiToken && (
                    <button
                      type="button"
                      onClick={() => setLinkShowToken(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      tabIndex={-1}
                    >
                      {linkShowToken ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">The API token is stored securely and is never displayed after saving.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name / Notes <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={linkNotes}
                  onChange={e => setLinkNotes(e.target.value)}
                  placeholder="e.g. Existing Blazing Hog Launch CRM account"
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
                type="submit"
                disabled={linkLoading || !linkLocationId.trim() || !linkApiToken.trim() || linkBizIdHasAt}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {linkLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {linkLoading ? 'Validating...' : 'Link CRM Account'}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {/* Social Landing Page Edit Modal */}
      {slpModalBizId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSlpModalBizId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Social Post Settings</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {businesses.find(b => b.id === slpModalBizId)?.businessName || 'Business'}
                </p>
              </div>
              <button onClick={() => setSlpModalBizId(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default social landing page</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Globe className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    type="url"
                    value={slpUrl}
                    onChange={e => { setSlpUrl(e.target.value); setSlpUrlError(null); }}
                    onBlur={() => slpUrl.trim() && validateSlpUrl(slpUrl)}
                    placeholder="https://example.com/offer"
                    className={`w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${
                      slpUrlError ? 'border-red-300 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                </div>
                {slpUrlError ? (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />{slpUrlError}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">This link will be added to scheduled social posts as the default destination for traffic from Facebook, Google Business Profile, LinkedIn, and other connected channels.</p>
                )}
              </div>

              {/* Toggle */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                <p className="text-sm font-medium text-gray-700">Add this link to social posts by default</p>
                <button type="button" onClick={() => setSlpEnabled(!slpEnabled)} className="flex-shrink-0 ml-3">
                  {slpEnabled ? (
                    <div className="w-9 h-5 bg-indigo-600 rounded-full relative transition-colors">
                      <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
                    </div>
                  ) : (
                    <div className="w-9 h-5 bg-gray-300 rounded-full relative transition-colors">
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
                    </div>
                  )}
                </button>
              </div>

              {/* CTA Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default CTA text <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={slpCtaText}
                  onChange={e => setSlpCtaText(e.target.value)}
                  placeholder="Learn more here:"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>

              {/* Apply To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Apply this to</label>
                <div className="space-y-1.5">
                  {[
                    { value: 'future' as const, label: 'Future posts only', desc: 'New posts will use this setting' },
                    { value: 'drafts' as const, label: 'Existing drafts', desc: 'Update pending and approved drafts too' },
                    { value: 'scheduled' as const, label: 'Existing scheduled posts', desc: 'Update already-scheduled posts too' },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input
                        type="radio"
                        name="slp-apply-to"
                        checked={slpApplyTo === opt.value}
                        onChange={() => setSlpApplyTo(opt.value)}
                        className="mt-0.5 w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-700">{opt.label}</p>
                        <p className="text-xs text-gray-400">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {slpUrl.trim() && slpEnabled && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-700 mb-1">Preview — post ending</p>
                  <div className="bg-white rounded px-3 py-2 text-xs text-gray-700 font-mono whitespace-pre-wrap">{slpCtaText || 'Learn more here:'}{'\n'}{slpUrl.trim()}</div>
                </div>
              )}

              {slpError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{slpError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setSlpModalBizId(null)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={handleSlpSave}
                disabled={slpSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
              >
                {slpSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {slpSaving ? 'Saving…' : 'Save Social Settings'}
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
