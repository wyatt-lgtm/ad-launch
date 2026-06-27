'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Filter, Image as ImageIcon, Video, Music, FileText,
  Grid3x3, Package, Check, Shield, ChevronDown, Loader2, ExternalLink,
} from 'lucide-react';
import Image from 'next/image';
import {
  SHARED_ASSET_SCOPES, SCOPE_LABELS,
  SHARED_ASSET_CATEGORIES, SHARED_CATEGORY_LABELS,
  USE_CHANNEL_LABELS,
  type SharedAssetScope, type SharedAssetCategory,
} from '@/lib/shared-assets';
import SharedAssetApprovalModal from './shared-asset-approval-modal';

interface SharedAssetRecord {
  id: string;
  scope: string;
  category: string;
  assetType: string;
  title: string;
  description: string;
  tags: string[];
  mimeType: string;
  fileSizeBytes: number;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  resolvedUrl: string | null;
  licenseType: string;
  licenseStatus: string;
  rightsHolder: string | null;
  requiresApproval: boolean;
  attributionRequired: boolean;
  attributionText: string | null;
  noDerivatives: boolean;
  noCommercial: boolean;
  geographicRestriction: string | null;
  allowWebsite: boolean;
  allowSocial: boolean;
  allowAds: boolean;
  allowEmail: boolean;
  allowPrint: boolean;
  allowVideo: boolean;
  allowInternal: boolean;
  allowAI: boolean;
  createdAt: string;
}

interface ApprovalRecord {
  sharedAssetId: string;
  status: string;
}

const CATEGORY_ICONS: Record<string, any> = {
  industry_generic: ImageIcon,
  licensed_stock: ImageIcon,
  brand_oem: Shield,
  franchise: Package,
  templates: FileText,
  video_clips: Video,
  audio_clips: Music,
  icons_graphics: Grid3x3,
  educational_explainers: FileText,
  compliance_templates: Shield,
};

export default function SharedAssetsTab({
  businessId,
  isAdmin,
}: {
  businessId: string;
  isAdmin: boolean;
}) {
  const [assets, setAssets] = useState<SharedAssetRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterScope, setFilterScope] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [approvingAsset, setApprovingAsset] = useState<SharedAssetRecord | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterScope) params.set('scope', filterScope);
      if (filterCategory) params.set('category', filterCategory);
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', String(page));
      params.set('pageSize', '50');

      const res = await fetch(`/api/shared-assets?${params}`);
      const data = await res.json();
      setAssets(data.assets || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch shared assets:', err);
    }
    setLoading(false);
  }, [filterScope, filterCategory, searchQuery, page]);

  const fetchApprovals = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`/api/businesses/${businessId}/shared-assets/approvals`);
      const data = await res.json();
      setApprovals((data.approvals || []).map((a: any) => ({ sharedAssetId: a.sharedAssetId, status: a.status })));
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    }
  }, [businessId]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  useEffect(() => { setPage(1); }, [filterScope, filterCategory, searchQuery]);

  const getApprovalStatus = (assetId: string) => {
    const approval = approvals.find(a => a.sharedAssetId === assetId);
    return approval?.status || null;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search shared assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All Scopes</option>
          {SHARED_ASSET_SCOPES.map(s => (
            <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All Categories</option>
          {SHARED_ASSET_CATEGORIES.map(c => (
            <option key={c} value={c}>{SHARED_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500">
        {total} shared asset{total !== 1 ? 's' : ''} available
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {/* Grid */}
      {!loading && assets.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No shared assets found</p>
          <p className="text-sm mt-1">Try adjusting your filters or check back later.</p>
        </div>
      )}

      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.map((asset) => {
            const approvalStatus = getApprovalStatus(asset.id);
            const imageUrl = asset.thumbnailUrl || asset.publicUrl || asset.resolvedUrl;
            const IconComponent = CATEGORY_ICONS[asset.category] || ImageIcon;

            return (
              <div
                key={asset.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Preview */}
                <div className="relative aspect-video bg-gray-100">
                  {imageUrl && asset.mimeType.startsWith('image/') ? (
                    <Image src={imageUrl} alt={asset.title} fill className="object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <IconComponent className="w-12 h-12 text-gray-300" />
                    </div>
                  )}
                  {/* Scope badge */}
                  <div className="absolute top-2 left-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      asset.scope === 'brand_oem' ? 'bg-amber-100 text-amber-800' :
                      asset.scope === 'franchise' ? 'bg-purple-100 text-purple-800' :
                      asset.scope === 'licensed_stock' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {SCOPE_LABELS[asset.scope as SharedAssetScope] || asset.scope}
                    </span>
                  </div>
                  {/* Approval badge */}
                  {approvalStatus && (
                    <div className="absolute top-2 right-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        approvalStatus === 'approved' ? 'bg-green-100 text-green-800' :
                        approvalStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        approvalStatus === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {approvalStatus === 'approved' ? 'Approved' :
                         approvalStatus === 'pending' ? 'Pending' :
                         approvalStatus === 'rejected' ? 'Rejected' : approvalStatus}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <h4 className="text-sm font-semibold text-gray-900 truncate">{asset.title}</h4>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {SHARED_CATEGORY_LABELS[asset.category as SharedAssetCategory] || asset.category}
                    {asset.rightsHolder && ` · ${asset.rightsHolder}`}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">{formatFileSize(asset.fileSizeBytes)}</span>
                    {approvalStatus === 'approved' ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Approved
                      </span>
                    ) : (
                      <button
                        onClick={() => setApprovingAsset(asset)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <Shield className="w-3 h-3" /> Approve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex justify-center gap-2 pt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm text-gray-600">
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Approval Modal */}
      {approvingAsset && (
        <SharedAssetApprovalModal
          asset={approvingAsset}
          businessId={businessId}
          onClose={() => setApprovingAsset(null)}
          onApproved={() => {
            setApprovingAsset(null);
            fetchApprovals();
          }}
        />
      )}
    </div>
  );
}
