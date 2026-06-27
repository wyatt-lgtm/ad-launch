'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, X, AlertTriangle, Loader2, Shield, Info } from 'lucide-react';
import {
  USE_CHANNELS, USE_CHANNEL_LABELS, CHANNEL_FIELD_MAP,
  SHARED_CATEGORY_LABELS,
  type UseChannel,
} from '@/lib/shared-assets';

interface ApprovedAsset {
  id: string;
  title: string;
  category: string;
  scope: string;
  licenseType: string;
  rightsHolder: string | null;
  requiresApproval: boolean;
  attributionRequired: boolean;
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
  sharedAsset: {
    id: string;
    title: string;
    category: string;
    scope: string;
    licenseType: string;
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
  };
}

export default function UsageRulesTab({ businessId }: { businessId: string }) {
  const [approvals, setApprovals] = useState<ApprovedAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/shared-assets/approvals?status=approved`);
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch (err) {
      console.error('Failed to fetch approved assets:', err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="font-medium">No approved shared assets</p>
        <p className="text-sm mt-1">Approve shared assets from the Shared Assets tab to see usage rules here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Info className="w-4 h-4" />
        <span>This matrix shows which channels each approved shared asset can be used in.</span>
      </div>

      {/* Permissions matrix table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-3 font-medium text-gray-700 min-w-[200px]">Asset</th>
              {USE_CHANNELS.map(ch => (
                <th key={ch} className="text-center py-3 px-2 font-medium text-gray-700 min-w-[80px]">
                  <div className="text-xs">{USE_CHANNEL_LABELS[ch]}</div>
                </th>
              ))}
              <th className="text-center py-3 px-2 font-medium text-gray-700 min-w-[60px]">
                <div className="text-xs">Flags</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((approval) => {
              const asset = approval.sharedAsset;
              const hasWarnings = asset.noDerivatives || asset.noCommercial || asset.attributionRequired || !!asset.geographicRestriction;

              return (
                <tr key={approval.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-3">
                    <div className="font-medium text-gray-900 truncate max-w-[200px]">{asset.title}</div>
                    <div className="text-xs text-gray-500">
                      {SHARED_CATEGORY_LABELS[asset.category as keyof typeof SHARED_CATEGORY_LABELS] || asset.category}
                      {asset.rightsHolder && ` · ${asset.rightsHolder}`}
                    </div>
                  </td>
                  {USE_CHANNELS.map(ch => {
                    const fieldName = CHANNEL_FIELD_MAP[ch];
                    const allowed = (asset as any)[fieldName];
                    return (
                      <td key={ch} className="text-center py-3 px-2">
                        {allowed ? (
                          <Check className="w-4 h-4 text-green-600 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-red-400 mx-auto" />
                        )}
                      </td>
                    );
                  })}
                  <td className="text-center py-3 px-2">
                    {hasWarnings ? (
                      <div className="flex justify-center">
                        <div className="group relative">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <div className="absolute right-0 top-6 z-10 hidden group-hover:block bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-48">
                            <p className="text-xs font-medium text-gray-700 mb-1">Restrictions:</p>
                            <ul className="text-xs text-gray-600 space-y-0.5">
                              {asset.noDerivatives && <li>• No derivatives</li>}
                              {asset.noCommercial && <li>• No commercial</li>}
                              {asset.attributionRequired && <li>• Attribution required</li>}
                              {asset.geographicRestriction && <li>• Geo: {asset.geographicRestriction}</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Check className="w-4 h-4 text-green-300 mx-auto" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-2">
        <div className="flex items-center gap-1">
          <Check className="w-3 h-3 text-green-600" /> Allowed
        </div>
        <div className="flex items-center gap-1">
          <X className="w-3 h-3 text-red-400" /> Restricted
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-500" /> Has restrictions (hover for details)
        </div>
      </div>
    </div>
  );
}
