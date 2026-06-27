'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, FolderOpen, Upload, Search, Image as ImageIcon,
  FileText, Shield, MapPin, Users, Palette, Megaphone, Video, Music, Scale,
  X, Check, AlertCircle, Trash2, Edit3, Ban, Archive, Star,
  Lock, LogIn, ChevronDown, Package, Globe, BookOpen,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import {
  ASSET_CATEGORIES, ASSET_TYPES, CATEGORY_LABELS,
  APPROVAL_STATUS_LABELS, TEXT_ASSET_TYPES,
  type AssetCategory, type ApprovalStatus,
} from '@/lib/asset-validation';
import AssetUploadModal from './asset-upload-modal';
import AssetEditModal from './asset-edit-modal';
import BrandReadiness from './brand-readiness';
import GuidedEmptyState from './guided-empty-state';
import BusinessProfileInterview from './business-profile-interview';
import SharedAssetsTab from './shared-assets-tab';
import ApprovedPacksTab from './approved-packs-tab';
import UsageRulesTab from './usage-rules-tab';

const CATEGORY_ICONS: Record<AssetCategory, any> = {
  brand: Palette,
  business_profile: FileText,
  products_services: ImageIcon,
  people_trust: Users,
  location_service_area: MapPin,
  proof_social_proof: Shield,
  video_clips: Video,
  audio_files: Music,
  compliance: Scale,
  creative_examples: Megaphone,
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-orange-100 text-orange-800',
  do_not_use: 'bg-red-200 text-red-900',
  archived: 'bg-gray-200 text-gray-600',
};

interface AssetRecord {
  id: string;
  assetType: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  duration?: number | null;
  approvalStatus: string;
  usageRights: string | null;
  priorityScore: number;
  textContent: string | null;
  sourcePlatform: string | null;
  customerPermission: string | null;
  approvedForAds: boolean;
  approvedForAI?: boolean;
  intendedUses?: string[];
  qualityWarnings?: string[];
  exampleType: string | null;
  pairTag: string | null;
  pairRole: string | null;
  expirationDate: string | null;
  createdAt: string;
  resolvedUrl: string | null;
  publicUrl: string | null;
  uploadedBy?: { email: string };
}

export default function AssetsContent() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();

  const [eligible, setEligible] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<AssetCategory | undefined>(undefined);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showInterview, setShowInterview] = useState(false);
  const [existingInterview, setExistingInterview] = useState<any>(null);
  const [hasProfileDocs, setHasProfileDocs] = useState(false);
  const [activeTab, setActiveTab] = useState<'business' | 'shared' | 'packs' | 'rules'>('business');

  const userRole = (session?.user as any)?.role || 'user';
  const isAdminUser = userRole === 'admin';

  const businessId = bizCtx?.activeBusiness?.id;
  const businessName = bizCtx?.activeBusiness?.businessName;

  useEffect(() => {
    if (!businessId || sessionStatus !== 'authenticated') {
      setEligible(false);
      setLoading(false);
      return;
    }
    fetch(`/api/assets/eligibility?businessId=${businessId}`)
      .then(r => r.json())
      .then(d => { setEligible(d.eligible); if (d.eligible) { fetchAssets(); fetchInterview(); } else setLoading(false); })
      .catch(() => { setEligible(false); setLoading(false); });
  }, [businessId, sessionStatus]);

  const fetchAssets = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ businessId });
      if (filterCategory) params.set('category', filterCategory);
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`/api/assets?${params}`);
      const data = await res.json();
      setAssets(data.assets ?? []);
    } catch (err) {
      console.error('Failed to fetch assets:', err);
    }
    setLoading(false);
  }, [businessId, filterCategory, filterStatus]);

  const fetchInterview = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`/api/businesses/${businessId}/business-profile/interview`);
      const data = await res.json();
      if (data.interview) {
        setExistingInterview(data.interview);
        if (data.interview.generatedDocuments?.length > 0) setHasProfileDocs(true);
      }
    } catch { /* no interview yet */ }
  }, [businessId]);

  useEffect(() => {
    if (eligible) fetchAssets();
  }, [eligible, fetchAssets]);

  const handleStatusChange = async (assetId: string, newStatus: string) => {
    setActionLoading(assetId);
    try {
      await fetch(`/api/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalStatus: newStatus }),
      });
      await fetchAssets();
    } catch (err) { console.error('Status change failed:', err); }
    setActionLoading(null);
  };

  const handleDelete = async (assetId: string) => {
    if (!confirm('Delete this asset permanently?')) return;
    setActionLoading(assetId);
    try {
      await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
      await fetchAssets();
    } catch (err) { console.error('Delete failed:', err); }
    setActionLoading(null);
  };

  const handleUploadWithCategory = (cat?: AssetCategory) => {
    setUploadCategory(cat);
    setShowUploadModal(true);
  };

  // Auth gate
  if (sessionStatus === 'loading') {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>;
  }
  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-500 mb-6">Creative Assets are only available for registered business owners.</p>
        <button onClick={() => router.push('/login')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
          <LogIn className="w-4 h-4" /> Log In or Register
        </button>
      </div>
    );
  }
  if (!businessId) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <FolderOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No Business Selected</h2>
        <p className="text-gray-500 mb-6">Select a business from your dashboard to manage creative assets.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">Go to Dashboard</button>
      </div>
    );
  }
  if (eligible === false) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Creative Assets Not Available</h2>
        <p className="text-gray-500 mb-6">Creative Assets are only available for businesses claimed by a registered owner.</p>
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">Go to Dashboard</button>
      </div>
    );
  }

  // Compute asset counts per category
  const assetCounts: Record<string, number> = {};
  for (const cat of ASSET_CATEGORIES) {
    assetCounts[cat] = assets.filter(a => a.category === cat).length;
  }
  const totalAssets = assets.length;

  // Filter assets by search
  const filtered = assets.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) ||
      a.assetType.toLowerCase().includes(q) || a.tags.some(t => t.toLowerCase().includes(q));
  });

  // Group by category
  const grouped = ASSET_CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(a => a.category === cat);
    if (items.length > 0 || (!filterCategory && !searchQuery)) acc[cat] = items;
    return acc;
  }, {} as Record<string, AssetRecord[]>);

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Creative Assets</h1>
          </div>
          <p className="text-gray-500 text-sm">
            {businessName || 'Your Business'} — Upload and manage brand assets for creative workflows
          </p>
        </div>
        <button
          onClick={() => handleUploadWithCategory(undefined)}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4" /> Upload Asset
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0 -mb-px overflow-x-auto">
          {[
            { key: 'business' as const, label: 'Business Assets', icon: FolderOpen },
            { key: 'shared' as const, label: 'Shared Assets', icon: Globe },
            { key: 'packs' as const, label: 'Approved Asset Packs', icon: Package },
            { key: 'rules' as const, label: 'Usage Rules', icon: BookOpen },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Shared Assets Tab */}
      {activeTab === 'shared' && businessId && (
        <SharedAssetsTab businessId={businessId} isAdmin={isAdminUser} />
      )}

      {/* Approved Packs Tab */}
      {activeTab === 'packs' && businessId && (
        <ApprovedPacksTab businessId={businessId} />
      )}

      {/* Usage Rules Tab */}
      {activeTab === 'rules' && businessId && (
        <UsageRulesTab businessId={businessId} />
      )}

      {/* Business Assets Tab (existing content) */}
      {activeTab === 'business' && (loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
      ) : totalAssets === 0 && !filterCategory && !filterStatus && !searchQuery ? (
        /* Empty State - Show Guided Onboarding */
        <GuidedEmptyState
          onUpload={handleUploadWithCategory}
          onBuildProfile={() => setShowInterview(true)}
          assetCounts={assetCounts}
        />
      ) : (
        /* Asset Library View */
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: Readiness Panel */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="sticky top-24 space-y-4">
              <BrandReadiness
                assetCounts={assetCounts}
                hasProfileDocs={hasProfileDocs}
                onCategoryClick={(cat) => setFilterCategory(cat)}
              />

              {/* Business Profile Quick Card */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-semibold text-gray-900">Business Profile</h4>
                </div>
                {existingInterview?.status === 'approved' ? (
                  <div>
                    <p className="text-xs text-green-600 font-medium mb-2">✓ Profile Complete</p>
                    <p className="text-xs text-gray-500 mb-2">Last updated: {new Date(existingInterview.updatedAt).toLocaleDateString()}</p>
                    <button onClick={() => setShowInterview(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit / Regenerate</button>
                  </div>
                ) : existingInterview?.status === 'draft' ? (
                  <div>
                    <p className="text-xs text-amber-600 font-medium mb-2">Draft in progress</p>
                    <button onClick={() => setShowInterview(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Continue Interview →</button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Don't have these documents yet? Answer a guided interview and Launch OS will build them for you.</p>
                    <button onClick={() => setShowInterview(true)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      <Star className="w-3 h-3" /> Help Me Build It
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Asset Grid */}
          <div className="flex-1 min-w-0">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Search assets..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">All Categories</option>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">All Statuses</option>
                {Object.entries(APPROVAL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <p className="text-xs text-gray-400 mb-4">
              {filtered.length} asset{filtered.length !== 1 ? 's' : ''}
              {filterCategory || filterStatus || searchQuery ? ' (filtered)' : ''}
            </p>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100 text-center">
                <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">{searchQuery || filterCategory || filterStatus ? 'No assets match your filters.' : 'No assets yet. Upload your first creative asset to get started.'}</p>
                <button onClick={() => handleUploadWithCategory(undefined)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors">
                  <Upload className="w-4 h-4" /> Upload Asset
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {ASSET_CATEGORIES.map(cat => {
                  const items = grouped[cat];
                  if (!items || items.length === 0) return null;
                  const Icon = CATEGORY_ICONS[cat];
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-5 h-5 text-blue-600" />
                          <h2 className="text-lg font-semibold text-gray-900">{CATEGORY_LABELS[cat]}</h2>
                          <span className="text-xs text-gray-400">({items.length})</span>
                        </div>
                        <button onClick={() => handleUploadWithCategory(cat)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                          <Upload className="w-3 h-3" /> Add
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {items.map(asset => (
                          <AssetCard key={asset.id} asset={asset} onStatusChange={handleStatusChange}
                            onDelete={handleDelete} onEdit={() => setEditingAsset(asset)} loading={actionLoading === asset.id} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Upload Modal */}
      {showUploadModal && (
        <AssetUploadModal
          businessId={businessId}
          defaultCategory={uploadCategory}
          onClose={() => { setShowUploadModal(false); setUploadCategory(undefined); }}
          onUploaded={() => { setShowUploadModal(false); setUploadCategory(undefined); fetchAssets(); }}
        />
      )}

      {/* Edit Modal */}
      {editingAsset && (
        <AssetEditModal asset={editingAsset} onClose={() => setEditingAsset(null)} onUpdated={() => { setEditingAsset(null); fetchAssets(); }} />
      )}

      {/* Business Profile Interview */}
      {showInterview && businessId && (
        <BusinessProfileInterview
          businessId={businessId}
          existingInterview={existingInterview}
          onClose={() => setShowInterview(false)}
          onComplete={() => { setShowInterview(false); setHasProfileDocs(true); fetchInterview(); fetchAssets(); }}
        />
      )}
    </div>
  );
}

/* ─── Asset Card ────────────────────────────────────────────────────── */

function AssetCard({
  asset, onStatusChange, onDelete, onEdit, loading,
}: {
  asset: AssetRecord;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  loading: boolean;
}) {
  const isText = TEXT_ASSET_TYPES.includes(asset.assetType);
  const isImage = asset.mimeType?.startsWith('image/') && !isText;
  const isVideo = asset.mimeType?.startsWith('video/');
  const isAudio = asset.mimeType?.startsWith('audio/');
  const statusLabel = APPROVAL_STATUS_LABELS[asset.approvalStatus as ApprovalStatus] || asset.approvalStatus;
  const statusColor = STATUS_COLORS[asset.approvalStatus] || 'bg-gray-100 text-gray-700';

  const allTypes = Object.values(ASSET_TYPES).flat();
  const typeLabel = allTypes.find(t => t.value === asset.assetType)?.label || asset.assetType;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
      <div className="aspect-[4/3] bg-gray-50 relative overflow-hidden">
        {isImage && asset.resolvedUrl ? (
          <img src={asset.resolvedUrl} alt={asset.title} className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : isText ? (
          <div className="flex items-center justify-center h-full p-4">
            <p className="text-sm text-gray-500 line-clamp-4 text-center italic">
              &ldquo;{asset.textContent?.substring(0, 150)}{(asset.textContent?.length ?? 0) > 150 ? '...' : ''}&rdquo;
            </p>
          </div>
        ) : isVideo ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Video className="w-10 h-10 text-rose-400" />
            {asset.duration && <p className="text-xs text-gray-500 mt-1">{Math.round(asset.duration)}s</p>}
          </div>
        ) : isAudio ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Music className="w-10 h-10 text-orange-400" />
            {asset.duration && <p className="text-xs text-gray-500 mt-1">{Math.round(asset.duration)}s</p>}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <FileText className="w-10 h-10 text-gray-300" />
          </div>
        )}

        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>{statusLabel}</div>
        {asset.priorityScore > 0 && (
          <div className="absolute top-2 left-2 flex items-center gap-0.5 bg-white/90 rounded-full px-1.5 py-0.5">
            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
            <span className="text-xs font-medium text-gray-700">{asset.priorityScore}</span>
          </div>
        )}

        {/* Quality warnings indicator */}
        {asset.qualityWarnings && asset.qualityWarnings.length > 0 && (
          <div className="absolute bottom-2 left-2 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {asset.qualityWarnings.length} warning{asset.qualityWarnings.length > 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 truncate" title={asset.title}>{asset.title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{typeLabel}</p>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {asset.tags.slice(0, 3).map(t => (
              <span key={t} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{t}</span>
            ))}
            {asset.tags.length > 3 && <span className="text-[10px] text-gray-400">+{asset.tags.length - 3}</span>}
          </div>
        )}
        {asset.intendedUses && asset.intendedUses.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.intendedUses.slice(0, 3).map(u => (
              <span key={u} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">{u}</span>
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 mt-1">
          {(asset.fileSizeBytes / 1024).toFixed(0)} KB
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
          {asset.duration ? ` · ${Math.round(asset.duration)}s` : ''}
        </p>
      </div>

      <div className="px-3 pb-3 flex items-center gap-1.5">
        <button onClick={onEdit} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Edit">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        {asset.approvalStatus !== 'approved' && (
          <button onClick={() => onStatusChange(asset.id, 'approved')} disabled={loading}
            className="p-1.5 rounded-md hover:bg-green-50 text-gray-500 hover:text-green-700 transition-colors" title="Approve">
            <Check className="w-3.5 h-3.5" />
          </button>
        )}
        {asset.approvalStatus !== 'do_not_use' && (
          <button onClick={() => onStatusChange(asset.id, 'do_not_use')} disabled={loading}
            className="p-1.5 rounded-md hover:bg-red-50 text-gray-500 hover:text-red-700 transition-colors" title="Do Not Use">
            <Ban className="w-3.5 h-3.5" />
          </button>
        )}
        {asset.approvalStatus !== 'archived' && (
          <button onClick={() => onStatusChange(asset.id, 'archived')} disabled={loading}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Archive">
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => onDelete(asset.id)} disabled={loading}
          className="p-1.5 rounded-md hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors ml-auto" title="Delete">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
