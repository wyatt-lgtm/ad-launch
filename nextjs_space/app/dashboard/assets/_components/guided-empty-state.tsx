'use client';

import {
  Palette, FileText, ImageIcon, Users, MapPin, Shield,
  Video, Music, Scale, Megaphone, Upload, ArrowRight,
  CheckCircle, Sparkles,
} from 'lucide-react';
import {
  ASSET_CATEGORIES, CATEGORY_LABELS, CATEGORY_DESCRIPTIONS,
  CATEGORY_WHY_IT_MATTERS, CATEGORY_RECOMMENDED_FORMATS,
  CATEGORY_MIN_QUALITY,
  type AssetCategory,
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

const CATEGORY_COLORS: Record<AssetCategory, { bg: string; border: string; icon: string; badge: string }> = {
  brand: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
  business_profile: { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700' },
  products_services: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
  people_trust: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  location_service_area: { bg: 'bg-teal-50', border: 'border-teal-200', icon: 'text-teal-600', badge: 'bg-teal-100 text-teal-700' },
  proof_social_proof: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', badge: 'bg-purple-100 text-purple-700' },
  video_clips: { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
  audio_files: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600', badge: 'bg-orange-100 text-orange-700' },
  compliance: { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600', badge: 'bg-gray-100 text-gray-700' },
  creative_examples: { bg: 'bg-pink-50', border: 'border-pink-200', icon: 'text-pink-600', badge: 'bg-pink-100 text-pink-700' },
};

interface Props {
  onUpload: (category?: AssetCategory) => void;
  onBuildProfile: () => void;
  assetCounts: Record<string, number>;
}

export default function GuidedEmptyState({ onUpload, onBuildProfile, assetCounts }: Props) {
  const totalAssets = Object.values(assetCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-2xl p-8 text-white shadow-lg">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white/15 rounded-xl">
            <Sparkles className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Build your brand asset library</h2>
            <p className="text-blue-100 text-base leading-relaxed max-w-2xl">
              Upload the files Launch OS needs to create better websites, social posts, videos, ads, and local SEO content.
              The more assets you provide, the more accurate and on-brand your generated content will be.
            </p>
          </div>
        </div>
      </div>

      {/* Recommended Format Reference */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Recommended file types</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
          {[
            { label: 'Logos', formats: 'PNG, SVG, PDF' },
            { label: 'Photos', formats: 'JPG, PNG' },
            { label: 'Videos', formats: 'MP4, MOV' },
            { label: 'Audio', formats: 'WAV, MP3, M4A' },
            { label: 'Documents', formats: 'PDF, DOCX, TXT' },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="font-semibold text-gray-700">{item.label}:</span>
              <span className="text-gray-500 ml-1">{item.formats}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-gray-500 space-y-0.5">
          <p>• Use PNG for logos, graphics, and images with text.</p>
          <p>• Use JPG/JPEG for real-world photos.</p>
          <p>• Avoid JPEG for logos or graphics with small text.</p>
          <p>• Use MP4 for video clips. Use WAV or high-quality MP3 for voice/audio.</p>
        </div>
      </div>

      {/* Category Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ASSET_CATEGORIES.map(cat => {
          const Icon = CATEGORY_ICONS[cat];
          const colors = CATEGORY_COLORS[cat];
          const count = assetCounts[cat] || 0;
          const isProfile = cat === 'business_profile';

          return (
            <div
              key={cat}
              className={`rounded-xl border ${colors.border} ${colors.bg} p-5 hover:shadow-md transition-shadow`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-lg bg-white shadow-sm`}>
                  <Icon className={`w-5 h-5 ${colors.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900">{CATEGORY_LABELS[cat]}</h3>
                    {count > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" /> {count} uploaded
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{CATEGORY_DESCRIPTIONS[cat]}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="text-xs">
                  <span className="font-medium text-gray-700">Formats: </span>
                  <span className="text-gray-500">{CATEGORY_RECOMMENDED_FORMATS[cat]}</span>
                </div>
                <div className="text-xs">
                  <span className="font-medium text-gray-700">Quality: </span>
                  <span className="text-gray-500">{CATEGORY_MIN_QUALITY[cat]}</span>
                </div>
                <p className="text-xs text-gray-500 italic">{CATEGORY_WHY_IT_MATTERS[cat]}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onUpload(cat)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${colors.badge} hover:opacity-80 transition-opacity`}
                >
                  <Upload className="w-3 h-3" /> Upload
                </button>
                {isProfile && (
                  <button
                    onClick={onBuildProfile}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" /> Help Me Build It
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next Steps Prompts */}
      {totalAssets > 0 && <NextStepPrompts assetCounts={assetCounts} onUpload={onUpload} onBuildProfile={onBuildProfile} />}
    </div>
  );
}

function NextStepPrompts({
  assetCounts,
  onUpload,
  onBuildProfile,
}: {
  assetCounts: Record<string, number>;
  onUpload: (cat?: AssetCategory) => void;
  onBuildProfile: () => void;
}) {
  const prompts: { message: string; action: () => void; actionLabel: string }[] = [];

  const has = (cat: string) => (assetCounts[cat] || 0) > 0;

  if (has('brand') && !has('business_profile')) {
    prompts.push({
      message: 'Upload a Business Profile or Owner Bio so Launch OS can write more accurate copy.',
      action: onBuildProfile,
      actionLabel: 'Build Profile',
    });
  }
  if (has('business_profile') && !has('products_services') && !has('location_service_area')) {
    prompts.push({
      message: 'Upload storefront, team, and service photos to improve website and social visuals.',
      action: () => onUpload('products_services'),
      actionLabel: 'Upload Photos',
    });
  }
  if ((has('products_services') || has('location_service_area')) && !has('brand')) {
    prompts.push({
      message: 'Upload a transparent PNG logo so posts and videos can be branded correctly.',
      action: () => onUpload('brand'),
      actionLabel: 'Upload Logo',
    });
  }
  if (!has('video_clips')) {
    prompts.push({
      message: 'Upload short video clips for reels, explainer videos, and founder story content.',
      action: () => onUpload('video_clips'),
      actionLabel: 'Upload Video',
    });
  }

  if (prompts.length === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
      <h4 className="text-sm font-semibold text-blue-900 mb-3">Recommended Next Steps</h4>
      <div className="space-y-2">
        {prompts.slice(0, 3).map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-3 bg-white rounded-lg px-4 py-2.5 shadow-sm">
            <p className="text-sm text-gray-700 flex-1">{p.message}</p>
            <button
              onClick={p.action}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap"
            >
              {p.actionLabel} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
