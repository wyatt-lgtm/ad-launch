'use client';

import { useState } from 'react';
import { Lock, Image as ImageIcon, Pencil, Loader2, ArrowRight, Check, Sparkles } from 'lucide-react';

interface WatermarkCardProps {
  caption: string | null;
  headline: string | null;
  imageUrl: string | null;
  index: number;
  angle?: string;
  /** Enable 1-round edit mode */
  editable?: boolean;
  /** Callback when an edit is completed — passes the new image data URL */
  onEdited?: (editedImageUrl: string) => void;
}

export default function WatermarkCard({
  caption, headline, imageUrl, index, angle, editable, onEdited,
}: WatermarkCardProps) {
  const angleLabels = ['Awareness', 'Conversion', 'Trust'];
  const angleColors = ['bg-blue-500', 'bg-orange-500', 'bg-green-500'];
  const displayAngle = angle ?? angleLabels[index] ?? '';
  const badgeColor = angleColors[index] ?? 'bg-gray-500';

  const [editMode, setEditMode] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editedImageUrl, setEditedImageUrl] = useState<string | null>(null);
  const [editUsed, setEditUsed] = useState(false);
  const [editError, setEditError] = useState('');
  const [showAfter, setShowAfter] = useState(true);

  const handleEdit = async () => {
    if (!editPrompt.trim()) return;
    setIsGenerating(true);
    setEditError('');
    try {
      const res = await fetch('/api/edit-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: editPrompt.trim(),
          headline: headline ?? `Ad ${index + 1}`,
          caption: caption ?? '',
          angle: displayAngle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.imageUrl) {
        setEditError(data?.error ?? 'Failed to generate image. Try again.');
        return;
      }
      setEditedImageUrl(data.imageUrl);
      setEditUsed(true);
      setEditMode(false);
      onEdited?.(data.imageUrl);
    } catch (err: any) {
      setEditError('Network error. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Before/After comparison view
  if (editedImageUrl) {
    return (
      <div className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all overflow-hidden border border-gray-100">
        {/* Toggle */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setShowAfter(false)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              !showAfter ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            Before
          </button>
          <button
            onClick={() => setShowAfter(true)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              showAfter ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> After</span>
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-gradient-to-br from-blue-100 to-indigo-100 overflow-hidden">
          {showAfter ? (
            <img
              src={editedImageUrl}
              alt={`Edited - ${headline ?? `Ad ${index + 1}`}`}
              className="w-full h-full object-cover"
              onError={(e: any) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <>
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
                  <span className="text-sm font-medium">Original</span>
                </div>
              )}
              <div className="watermark-overlay">
                <span className="watermark-text">Ad Launch</span>
              </div>
            </>
          )}
          {/* Angle badge */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className={`${badgeColor} text-white text-xs px-2.5 py-1 rounded-full font-medium`}>
              {displayAngle}
            </span>
            {showAfter && (
              <span className="bg-emerald-500 text-white text-xs px-2 py-1 rounded-full font-medium flex items-center gap-0.5">
                <Check className="w-3 h-3" /> Edited
              </span>
            )}
          </div>
          {!showAfter && (
            <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <Lock className="w-3 h-3" /> Preview
            </div>
          )}
        </div>

        <div className="p-4">
          <h3 className="font-semibold text-gray-900 mb-2 text-sm">{headline ?? `Facebook Ad ${index + 1}`}</h3>
          <p className="text-gray-600 text-sm line-clamp-3">{caption ?? 'Your professionally crafted ad copy will appear here.'}</p>
          <div className="mt-3 text-xs text-gray-400 italic">
            Edit: &ldquo;{editPrompt}&rdquo;
          </div>
        </div>
      </div>
    );
  }

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
        {/* Badges */}
        <div className="absolute top-3 left-3">
          <span className={`${badgeColor} text-white text-xs px-2.5 py-1 rounded-full font-medium`}>
            {displayAngle}
          </span>
        </div>
        <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
          <Lock className="w-3 h-3" /> Preview
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-2 text-sm">{headline ?? `Facebook Ad ${index + 1}`}</h3>
        <p className="text-gray-600 text-sm line-clamp-3">{caption ?? 'Your professionally crafted ad copy will appear here.'}</p>
      </div>

      {/* Edit section — only when editable and not yet used */}
      {editable && !editUsed && (
        <div className="border-t border-gray-100 px-4 py-3">
          {!editMode ? (
            <button
              onClick={() => setEditMode(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Want to change this ad?
            </button>
          ) : (
            <div className="space-y-2.5">
              <label className="text-xs font-medium text-gray-500">
                Describe how you&apos;d like to change the image:
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="e.g. Make it more colorful, add a sunset background, show the product closer up..."
                rows={2}
                maxLength={300}
                disabled={isGenerating}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50"
              />
              {editError && (
                <p className="text-xs text-red-500">{editError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditMode(false); setEditPrompt(''); setEditError(''); }}
                  disabled={isGenerating}
                  className="flex-1 py-2 px-3 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEdit}
                  disabled={isGenerating || !editPrompt.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate
                    </>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 text-center">One edit per ad · AI-generated image</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
