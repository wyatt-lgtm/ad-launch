'use client';

import { useState } from 'react';
import { X, AlertTriangle, Shield, Check, ExternalLink } from 'lucide-react';
import Image from 'next/image';

interface SharedAssetForApproval {
  id: string;
  title: string;
  category: string;
  scope: string;
  assetType: string;
  mimeType: string;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  resolvedUrl: string | null;
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
}

interface Props {
  asset: SharedAssetForApproval;
  businessId: string;
  onClose: () => void;
  onApproved: () => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  allowWebsite: 'Website',
  allowSocial: 'Social Media',
  allowAds: 'Paid Ads',
  allowEmail: 'Email',
  allowPrint: 'Print',
  allowVideo: 'Video',
  allowInternal: 'Internal',
  allowAI: 'AI Generation',
};

export default function SharedAssetApprovalModal({ asset, businessId, onClose, onApproved }: Props) {
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isBrandOem = asset.scope === 'brand_oem';
  const hasRestrictions = asset.noDerivatives || asset.noCommercial || !!asset.geographicRestriction;

  const allowedChannels = Object.entries(CHANNEL_LABELS)
    .filter(([key]) => (asset as any)[key] === true)
    .map(([, label]) => label);

  const restrictedChannels = Object.entries(CHANNEL_LABELS)
    .filter(([key]) => (asset as any)[key] === false)
    .map(([, label]) => label);

  const handleApprove = async () => {
    if (asset.requiresApproval && !rightsConfirmed) {
      setError('You must confirm you have reviewed the rights and restrictions.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}/shared-assets/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharedAssetId: asset.id,
          status: 'approved',
          rightsConfirmed,
          approvalNotes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve');
      }
      onApproved();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const imageUrl = asset.thumbnailUrl || asset.publicUrl || asset.resolvedUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Approve Shared Asset</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Asset Preview */}
          {imageUrl && asset.mimeType.startsWith('image/') && (
            <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
              <Image src={imageUrl} alt={asset.title} fill className="object-contain" />
            </div>
          )}

          <div>
            <h4 className="font-semibold text-gray-900">{asset.title}</h4>
            <p className="text-sm text-gray-500 mt-0.5">
              {asset.category.replace(/_/g, ' ')} · {asset.scope.replace(/_/g, ' ')}
            </p>
          </div>

          {/* Brand/OEM Warning */}
          {isBrandOem && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Brand / OEM Asset</p>
                  <p className="text-xs text-amber-700 mt-1">
                    This asset is provided by {asset.rightsHolder || 'a brand partner'} and has specific usage restrictions.
                    Review the terms carefully before approving.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* License Info */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-gray-700">License Details</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">License: </span>
                <span className="font-medium">{asset.licenseType.replace(/_/g, ' ')}</span>
              </div>
              {asset.rightsHolder && (
                <div>
                  <span className="text-gray-500">Rights Holder: </span>
                  <span className="font-medium">{asset.rightsHolder}</span>
                </div>
              )}
            </div>
            {asset.attributionRequired && (
              <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded">
                Attribution required: {asset.attributionText || 'See license terms'}
              </p>
            )}
          </div>

          {/* Allowed/Restricted Channels */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-green-700 mb-1">Allowed Channels</p>
              <div className="space-y-1">
                {allowedChannels.map(ch => (
                  <div key={ch} className="flex items-center gap-1.5 text-xs text-green-600">
                    <Check className="w-3 h-3" /> {ch}
                  </div>
                ))}
              </div>
            </div>
            {restrictedChannels.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-700 mb-1">Restricted</p>
                <div className="space-y-1">
                  {restrictedChannels.map(ch => (
                    <div key={ch} className="flex items-center gap-1.5 text-xs text-red-600">
                      <X className="w-3 h-3" /> {ch}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Restrictions Warning */}
          {hasRestrictions && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-medium text-red-800 mb-1">Restrictions Apply</p>
              <ul className="text-xs text-red-700 space-y-0.5">
                {asset.noDerivatives && <li>• No derivative works allowed</li>}
                {asset.noCommercial && <li>• No commercial use</li>}
                {asset.geographicRestriction && <li>• Geographic: {asset.geographicRestriction.replace(/_/g, ' ')}</li>}
              </ul>
            </div>
          )}

          {/* Rights Confirmation Checkbox */}
          {asset.requiresApproval && (
            <label className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <div>
                <p className="text-sm font-medium text-blue-900">I confirm rights review</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  I have reviewed the license terms, usage restrictions, and attribution requirements for this shared asset
                  and confirm that my business will comply with all applicable terms.
                </p>
              </div>
            </label>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Any notes about how you'll use this asset..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={loading || (asset.requiresApproval && !rightsConfirmed)}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
            Approve for My Business
          </button>
        </div>
      </div>
    </div>
  );
}
