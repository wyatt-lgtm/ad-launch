'use client';

import { Building2, MapPin, ChevronRight, Plus, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { BusinessInfo } from '@/hooks/use-active-business';

interface BusinessPickerProps {
  businesses: BusinessInfo[];
  onSelect: (biz: BusinessInfo) => void;
  /** Optional: show a compact banner for the active business with a "switch" option */
  activeBusiness?: BusinessInfo | null;
  onSwitch?: () => void;
}

/** Full-page picker shown when user has multiple businesses and none is selected */
export function BusinessPickerGrid({ businesses, onSelect }: BusinessPickerProps) {
  const router = useRouter();
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          Select a Business
        </h1>
        <p className="text-gray-500 max-w-md mx-auto">
          You have multiple businesses. Choose which one to work with, or add a new one.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {businesses.map((biz) => {
          const displayName = biz.businessName || (() => { try { return new URL(biz.websiteUrl).hostname.replace('www.', ''); } catch { return biz.websiteUrl; } })();
          const locationStr = [biz.businessCity, biz.businessState].filter(Boolean).join(', ');
          return (
            <button
              key={biz.id}
              onClick={() => onSelect(biz)}
              className="bg-white rounded-xl p-5 shadow-sm border-2 border-gray-100 hover:border-blue-400 hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-start justify-between mb-2">
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
              {locationStr && (
                <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-2">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {locationStr}{biz.businessZip ? ` ${biz.businessZip}` : ''}
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-3 pt-2 border-t border-gray-100">
                <Globe className="w-3 h-3" /> {biz._count.analyses} {biz._count.analyses === 1 ? 'analysis' : 'analyses'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-center">
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl font-medium text-sm hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add a New Business
        </button>
      </div>
    </div>
  );
}

/** Compact banner shown at top when a business is actively selected */
export function ActiveBusinessBanner({
  activeBusiness,
  onSwitch,
  businessCount,
}: {
  activeBusiness: BusinessInfo;
  onSwitch?: () => void;
  businessCount: number;
}) {
  const displayName = activeBusiness.businessName || (() => { try { return new URL(activeBusiness.websiteUrl).hostname.replace('www.', ''); } catch { return activeBusiness.websiteUrl; } })();
  const locationStr = [activeBusiness.businessCity, activeBusiness.businessState].filter(Boolean).join(', ');

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Building2 className="w-4 h-4 text-blue-600" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{displayName}</p>
          <p className="text-xs text-gray-400 truncate">
            {activeBusiness.websiteUrl.replace(/^https?:\/\//, '')}
            {locationStr ? ` · ${locationStr}` : ''}
          </p>
        </div>
      </div>
      {businessCount > 1 && onSwitch && (
        <button
          onClick={onSwitch}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap px-3 py-1.5 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          Switch Business
        </button>
      )}
    </div>
  );
}
