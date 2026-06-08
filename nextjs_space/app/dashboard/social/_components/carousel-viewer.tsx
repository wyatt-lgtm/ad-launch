'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Eye, Layers } from 'lucide-react';

interface CarouselSlide {
  slide_number: number;
  headline: string;
  bullets: string[];
  imageUrl: string | null;
}

interface CarouselViewerProps {
  slides: CarouselSlide[];
  imageUrls: string[];
  sourceAttribution: string;
  onDownload?: () => void;
  downloading?: boolean;
}

export default function CarouselViewer({
  slides,
  imageUrls,
  sourceAttribution,
  onDownload,
  downloading,
}: CarouselViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const totalSlides = imageUrls.length;

  if (totalSlides === 0) return null;

  const goNext = () => setCurrentSlide(prev => Math.min(prev + 1, totalSlides - 1));
  const goPrev = () => setCurrentSlide(prev => Math.max(prev - 1, 0));

  const currentUrl = imageUrls[currentSlide];
  const currentMeta = slides[currentSlide];

  return (
    <div className="mb-3">
      {/* Carousel badge */}
      <div className="flex items-center gap-1.5 mb-2">
        <Layers className="w-3.5 h-3.5 text-indigo-600" />
        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
          Carousel · {totalSlides} slides
        </span>
      </div>

      {/* Image container */}
      <div className="relative w-full max-w-md mx-auto">
        {/* Image */}
        <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
          {currentUrl ? (
            <img
              src={currentUrl}
              alt={currentMeta?.headline || `Slide ${currentSlide + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              Image not available
            </div>
          )}

          {/* Navigation arrows */}
          {totalSlides > 1 && (
            <>
              {currentSlide > 0 && (
                <button
                  onClick={goPrev}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              {currentSlide < totalSlides - 1 && (
                <button
                  onClick={goNext}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                  aria-label="Next slide"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}

          {/* Slide counter */}
          {totalSlides > 1 && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-medium">
              {currentSlide + 1} / {totalSlides}
            </div>
          )}
        </div>

        {/* Dot indicators */}
        {totalSlides > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-2">
            {imageUrls.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentSlide(idx)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  idx === currentSlide ? 'bg-indigo-600' : 'bg-gray-300 hover:bg-gray-400'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Slide metadata (headline + bullets) */}
      {currentMeta && (
        <div className="mt-2 px-1">
          <p className="text-sm font-semibold text-gray-900">{currentMeta.headline}</p>
          {currentMeta.bullets && currentMeta.bullets.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {currentMeta.bullets.map((bullet: string, i: number) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  {bullet}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Source attribution */}
      {sourceAttribution && (
        <p className="text-xs text-gray-400 mt-1 px-1">{sourceAttribution}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-2">
        {currentUrl && (
          <button
            onClick={() => window.open(currentUrl, '_blank')}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
          >
            <Eye className="w-3 h-3" /> View Full Image
          </button>
        )}
        {onDownload && (
          <button
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Download All
          </button>
        )}
      </div>
    </div>
  );
}
