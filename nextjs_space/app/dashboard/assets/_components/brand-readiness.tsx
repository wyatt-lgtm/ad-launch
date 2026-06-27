'use client';

import {
  CheckCircle, AlertCircle, Circle, TrendingUp,
  Palette, FileText, ImageIcon, Users, MapPin, Shield,
  Video, Music, Scale, Megaphone,
} from 'lucide-react';
import {
  ASSET_CATEGORIES, CATEGORY_LABELS,
  computeReadinessScore, getReadinessLabel,
  type AssetCategory, type ReadinessItem,
} from '@/lib/asset-validation';

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

const REQUIRED_CATEGORIES: AssetCategory[] = [
  'brand', 'business_profile', 'products_services', 'people_trust', 'location_service_area',
];

const STATUS_DISPLAY: Record<string, { icon: any; color: string; label: string }> = {
  missing: { icon: Circle, color: 'text-gray-400', label: 'Missing' },
  uploaded: { icon: AlertCircle, color: 'text-amber-500', label: 'Uploaded' },
  needs_review: { icon: AlertCircle, color: 'text-amber-500', label: 'Needs Review' },
  low_quality: { icon: AlertCircle, color: 'text-orange-500', label: 'Low Quality' },
  ready: { icon: CheckCircle, color: 'text-green-500', label: 'Ready' },
};

interface Props {
  assetCounts: Record<string, number>;
  hasProfileDocs: boolean;
  onCategoryClick?: (cat: AssetCategory) => void;
}

export default function BrandReadiness({ assetCounts, hasProfileDocs, onCategoryClick }: Props) {
  const items: ReadinessItem[] = ASSET_CATEGORIES.map(cat => {
    const count = assetCounts[cat] || 0;
    const isProfileCat = cat === 'business_profile';
    const effectiveCount = isProfileCat ? (hasProfileDocs ? 1 : 0) + count : count;
    const required = REQUIRED_CATEGORIES.includes(cat);
    let status: ReadinessItem['status'] = 'missing';
    if (effectiveCount > 0) status = 'uploaded';
    // If there are approved assets, mark as ready
    return { category: cat, label: CATEGORY_LABELS[cat], required, status, count: effectiveCount };
  });

  const score = computeReadinessScore(items);
  const readiness = getReadinessLabel(score);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Score Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold text-base">Brand Asset Readiness</h3>
            <p className="text-blue-100 text-xs mt-0.5">How prepared your brand library is for content creation</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white">{score}</div>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${readiness.color}`}>
              {readiness.label}
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 bg-blue-800/40 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-white/90 transition-all duration-500"
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="p-4 space-y-1.5">
        {items.map(item => {
          const StatusIcon = STATUS_DISPLAY[item.status]?.icon || Circle;
          const statusColor = STATUS_DISPLAY[item.status]?.color || 'text-gray-400';
          const statusLabel = STATUS_DISPLAY[item.status]?.label || 'Missing';
          const CatIcon = CATEGORY_ICONS[item.category];

          return (
            <button
              key={item.category}
              onClick={() => onCategoryClick?.(item.category)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group"
            >
              <CatIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">
                {item.label}
                {!item.required && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </span>
              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusColor}`} />
              <span className={`text-xs font-medium w-16 text-right ${statusColor}`}>
                {statusLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
