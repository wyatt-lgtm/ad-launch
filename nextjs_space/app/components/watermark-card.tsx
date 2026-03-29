'use client';

import { Lock, Image as ImageIcon } from 'lucide-react';

interface WatermarkCardProps {
  caption: string | null;
  headline: string | null;
  imageUrl: string | null;
  index: number;
}

export default function WatermarkCard({ caption, headline, imageUrl, index }: WatermarkCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all overflow-hidden border border-gray-100 group">
      <div className="relative aspect-[4/3] bg-gradient-to-br from-blue-100 to-indigo-100 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={headline ?? `Ad ${index + 1}`}
            className="w-full h-full object-cover"
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-blue-300">
            <ImageIcon className="w-16 h-16 mb-2" />
            <span className="text-sm font-medium">Ad {index + 1}</span>
          </div>
        )}
        {/* Watermark */}
        <div className="watermark-overlay">
          <span className="watermark-text">Ad Launch</span>
        </div>
        <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
          <Lock className="w-3 h-3" /> Preview
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-2 text-sm">{headline ?? `Facebook Ad ${index + 1}`}</h3>
        <p className="text-gray-600 text-sm line-clamp-3">{caption ?? 'Your professionally crafted ad copy will appear here.'}</p>
      </div>
    </div>
  );
}
