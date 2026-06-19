'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2, FolderOpen, Upload, Filter, Search, Image as ImageIcon,
  FileText, Shield, MapPin, Users, Palette, Megaphone, ChevronDown,
  X, Check, AlertCircle, Trash2, Edit3, Eye, Ban, Archive, Star,
  Lock, LogIn,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';
import {
  ASSET_CATEGORIES, ASSET_TYPES, CATEGORY_LABELS,
  APPROVAL_STATUS_LABELS, TEXT_ASSET_TYPES,
  type AssetCategory, type ApprovalStatus,
} from '@/lib/asset-validation';
import AssetUploadModal from './asset-upload-modal';
import AssetEditModal from './asset-edit-modal';

const CATEGORY_ICONS: Record<AssetCategory, any> = {
  brand: Palette,
  products_services: ImageIcon,
  people_trust: Users,
  location_service_area: MapPin,
  proof_social_proof: Shield,
  compliance: FileText,
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
  approvalStatus: string;
  usageRights: string | null;
  priorityScore: number;
  textContent: string | null;
  sourcePlatform: string | null;
  customerPermission: string | null;
  approvedForAds: boolean;
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
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const businessId = bizCtx?.activeBusiness?.id;
  const businessName = bizCtx?.activeBusiness?.businessName;

  // Check eligibility
  useEffect(() => {
    if (!businessId || sessionStatus !== 'authenticated') {
      setEligible(false);
      setLoading(false);
      return;
    }
    fetch(`/api/assets/eligibility?businessId=${businessId}`)
      .then(r => r.json())
      .then(d => { setEligible(d.eligible); if (d.eligible) fetchAssets(); else setLoading(false); })
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
    } catch (err) {
      console.error('Status change failed:', err);
    }
    setActionLoading(null);
  };

  const handleDelete = async (assetId: string) => {
    if (!confirm('Delete this asset permanently?')) return;
    setActionLoading(assetId);
    try {
      await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
      await fetchAssets();
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setActionLoading(null);
  };

  // Auth gate
  if (sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-500 mb-6">Creative Assets are only available for registered business owners.</p>
        <button
          onClick={() => router.push('/login')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
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
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  if (eligible === false) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <Lock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Creative Assets Not Available</h2>
        <p className="text-gray-500 mb-6">
          Creative Assets are only available for businesses that have been claimed by a registered owner.
          If this is your business, please ensure your account is linked to it.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  // Filter assets by search
  const filtered = assets.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.assetType.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  });

  // Group by category
  const grouped = ASSET_CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(a => a.category === cat);
    if (items.length > 0 || !filterCategory) acc[cat] = items;
    return acc;
  }, {} as Record<string, AssetRecord[]>);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
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
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4" /> Upload Asset
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All Categories</option>
          {ASSET_CATEGORIES.map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All Statuses</option>
          {Object.entries(APPROVAL_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Asset count */}
      <p className="text-xs text-gray-400 mb-4">
        {filtered.length} asset{filtered.length !== 1 ? 's' : ''}
        {filterCategory || filterStatus || searchQuery ? ' (filtered)' : ''}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-100 text-center">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No assets yet. Upload your first creative asset to get started.</p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors"
          >
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
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">{CATEGORY_LABELS[cat]}</h2>
                  <span className="text-xs text-gray-400 ml-1">({items.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {items.map(asset => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      onEdit={() => setEditingAsset(asset)}
                      loading={actionLoading === asset.id}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <AssetUploadModal
          businessId={businessId}
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => { setShowUploadModal(false); fetchAssets(); }}
        />
      )}

      {/* Edit Modal */}
      {editingAsset && (
        <AssetEditModal
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onUpdated={() => { setEditingAsset(null); fetchAssets(); }}
        />
      )}
    </div>
  );
}

/* ─── Asset Card ────────────────────────────────────────────── */

function AssetCard({
  asset,
  onStatusChange,
  onDelete,
  onEdit,
  loading,
}: {
  asset: AssetRecord;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  loading: boolean;
}) {
  const isText = TEXT_ASSET_TYPES.includes(asset.assetType);
  const isImage = asset.mimeType?.startsWith('image/') && !isText;
  const statusLabel = APPROVAL_STATUS_LABELS[asset.approvalStatus as ApprovalStatus] || asset.approvalStatus;
  const statusColor = STATUS_COLORS[asset.approvalStatus] || 'bg-gray-100 text-gray-700';

  // Find display label for asset type
  const allTypes = Object.values(ASSET_TYPES).flat();
  const typeLabel = allTypes.find(t => t.value === asset.assetType)?.label || asset.assetType;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
      {/* Thumbnail / Preview */}
      <div className="aspect-[4/3] bg-gray-50 relative overflow-hidden">
        {isImage && asset.resolvedUrl ? (
          <img
            src={asset.resolvedUrl}
            alt={asset.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : isText ? (
          <div className="flex items-center justify-center h-full p-4">
            <p className="text-sm text-gray-500 line-clamp-4 text-center italic">
              &ldquo;{asset.textContent?.substring(0, 150)}{(asset.textContent?.length ?? 0) > 150 ? '...' : ''}&rdquo;
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <FileText className="w-10 h-10 text-gray-300" />
          </div>
        )}

        {/* Status badge */}
        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
          {statusLabel}
        </div>

        {/* Priority star */}
        {asset.priorityScore > 0 && (
          <div className="absolute top-2 left-2 flex items-center gap-0.5 bg-white/90 rounded-full px-1.5 py-0.5">
            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
            <span className="text-xs font-medium text-gray-700">{asset.priorityScore}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 truncate" title={asset.title}>
          {asset.title}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">{typeLabel}</p>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {asset.tags.slice(0, 3).map(t => (
              <span key={t} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{t}</span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[10px] text-gray-400">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}
        {!isText && (
          <p className="text-[10px] text-gray-400 mt-1">
            {(asset.fileSizeBytes / 1024).toFixed(0)} KB
            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 flex items-center gap-1.5">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          title="Edit"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        {asset.approvalStatus !== 'approved' && (
          <button
            onClick={() => onStatusChange(asset.id, 'approved')}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-green-50 text-gray-500 hover:text-green-700 transition-colors"
            title="Approve"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        )}
        {asset.approvalStatus !== 'rejected' && asset.approvalStatus !== 'do_not_use' && (
          <button
            onClick={() => onStatusChange(asset.id, 'do_not_use')}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-red-50 text-gray-500 hover:text-red-700 transition-colors"
            title="Mark as Do Not Use"
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
        )}
        {asset.approvalStatus !== 'archived' && (
          <button
            onClick={() => onStatusChange(asset.id, 'archived')}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title="Archive"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(asset.id)}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors ml-auto"
          title="Delete"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
