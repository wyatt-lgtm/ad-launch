'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Check, Clock, X, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { GRANT_STATUS_LABELS } from '@/lib/shared-assets';

interface PackGrant {
  id: string;
  packId: string;
  status: string;
  grantNotes: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  pack: {
    id: string;
    name: string;
    description: string;
    scope: string;
    category: string | null;
    items: Array<{
      sharedAsset: {
        id: string;
        title: string;
        category: string;
        thumbnailUrl: string | null;
        publicUrl: string | null;
        mimeType: string;
      };
    }>;
    _count: { items: number };
  };
  grantedBy: { email: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  granted: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-orange-100 text-orange-800',
  revoked: 'bg-red-200 text-red-900',
};

const STATUS_ICONS: Record<string, any> = {
  granted: Check,
  pending: Clock,
  rejected: X,
  expired: AlertCircle,
  revoked: X,
};

export default function ApprovedPacksTab({ businessId }: { businessId: string }) {
  const [grants, setGrants] = useState<PackGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const fetchGrants = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`/api/businesses/${businessId}/shared-asset-packs/grants?${params}`);
      const data = await res.json();
      setGrants(data.grants || []);
    } catch (err) {
      console.error('Failed to fetch pack grants:', err);
    }
    setLoading(false);
  }, [businessId, filterStatus]);

  useEffect(() => { fetchGrants(); }, [fetchGrants]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All Statuses</option>
          {Object.entries(GRANT_STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">
          {grants.length} pack{grants.length !== 1 ? 's' : ''}
        </span>
      </div>

      {grants.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No asset packs yet</p>
          <p className="text-sm mt-1">Asset packs will appear here when granted by an administrator.</p>
        </div>
      )}

      {/* Pack list */}
      <div className="space-y-3">
        {grants.map((grant) => {
          const StatusIcon = STATUS_ICONS[grant.status] || AlertCircle;
          const isExpanded = expandedPack === grant.id;

          return (
            <div key={grant.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Pack header */}
              <button
                onClick={() => setExpandedPack(isExpanded ? null : grant.id)}
                className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 text-left"
              >
                <Package className="w-8 h-8 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-900 truncate">{grant.pack.name}</h4>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[grant.status] || 'bg-gray-100 text-gray-700'}`}>
                      <StatusIcon className="w-3 h-3 inline mr-1" />
                      {GRANT_STATUS_LABELS[grant.status] || grant.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {grant.pack._count.items} asset{grant.pack._count.items !== 1 ? 's' : ''}
                    {grant.grantedAt && ` · Granted ${new Date(grant.grantedAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}`}
                    {grant.expiresAt && ` · Expires ${new Date(grant.expiresAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}`}
                  </p>
                </div>
                {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
              </button>

              {/* Expanded: show pack assets */}
              {isExpanded && (
                <div className="border-t px-4 py-3">
                  {grant.pack.description && (
                    <p className="text-sm text-gray-600 mb-3">{grant.pack.description}</p>
                  )}
                  {grant.grantNotes && (
                    <p className="text-xs text-gray-500 mb-3 italic">Notes: {grant.grantNotes}</p>
                  )}
                  {grant.revokeReason && grant.status === 'revoked' && (
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded mb-3">
                      Revoked: {grant.revokeReason}
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {grant.pack.items.map((item) => {
                      const imgUrl = item.sharedAsset.thumbnailUrl || item.sharedAsset.publicUrl;
                      return (
                        <div key={item.sharedAsset.id} className="bg-gray-50 rounded-lg p-2">
                          <div className="relative aspect-square bg-gray-100 rounded overflow-hidden mb-1">
                            {imgUrl && item.sharedAsset.mimeType.startsWith('image/') ? (
                              <Image src={imgUrl} alt={item.sharedAsset.title} fill className="object-cover" />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Package className="w-6 h-6 text-gray-300" />
                              </div>
                            )}
                          </div>
                          <p className="text-xs font-medium text-gray-700 truncate">{item.sharedAsset.title}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
