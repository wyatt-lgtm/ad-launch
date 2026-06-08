'use client';

import { useState } from 'react';
import { X, Loader2, Link2, Layers, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

interface CarouselCreatorProps {
  businessId: string;
  businessName: string;
  onClose: () => void;
  onPostCreated: () => void;
}

export default function CarouselCreator({
  businessId,
  businessName,
  onClose,
  onPostCreated,
}: CarouselCreatorProps) {
  const [articleUrl, setArticleUrl] = useState('');
  const [step, setStep] = useState<'input' | 'analyzing' | 'generating' | 'done' | 'error'>('input');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleCreate = async () => {
    const trimmed = articleUrl.trim();
    if (!trimmed) {
      setError('Please enter an article URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setError('');
    setStep('analyzing');
    setStatusMsg('Fetching and analyzing article...');

    try {
      const res = await fetch('/api/social/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleUrl: trimmed.startsWith('http') ? trimmed : `https://${trimmed}`,
          businessId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create carousel (${res.status})`);
      }

      const data = await res.json();
      setResult(data);

      if (data.postType === 'carousel') {
        setStep('done');
        setStatusMsg(`Carousel created with ${data.slideImages?.length || 0} slides!`);
      } else {
        // Fell back to standard post
        setStep('done');
        setStatusMsg(
          data.fallbackReason
            ? `This article isn't list-based — created as a standard post. (${data.fallbackReason})`
            : 'Created as a standard post (article is not list-based).'
        );
      }

      onPostCreated();
    } catch (err: any) {
      console.error('[carousel-creator] Error:', err);
      setStep('error');
      setError(err.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-white" />
            <h3 className="text-lg font-bold text-white">Create Carousel Post</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {step === 'input' && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Paste an article URL (listicle, tips, ranking, how-to) and we'll create a
                multi-slide carousel post for <strong>{businessName}</strong>.
              </p>

              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="url"
                  value={articleUrl}
                  onChange={e => { setArticleUrl(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="https://www.example.com/10-best-tips-for..."
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 mt-3 text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <div className="mt-4 p-3 bg-indigo-50 rounded-lg">
                <p className="text-xs text-indigo-700 font-medium mb-1">Works best with:</p>
                <ul className="text-xs text-indigo-600 space-y-0.5">
                  <li>• "Top 10" / "Best of" / ranking articles</li>
                  <li>• Tips and how-to guides</li>
                  <li>• Feature lists and product roundups</li>
                  <li>• "Things you should know" articles</li>
                </ul>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!articleUrl.trim()}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Create Carousel
                </button>
              </div>
            </>
          )}

          {(step === 'analyzing' || step === 'generating') && (
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-900">{statusMsg}</p>
              <p className="text-xs text-gray-500 mt-2">
                This may take 30–60 seconds while we analyze and generate images...
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 mb-2">{statusMsg}</p>
              {result?.carouselPackage?.article_title && (
                <p className="text-xs text-gray-500 mb-1">
                  Article: "{result.carouselPackage.article_title.slice(0, 80)}"
                </p>
              )}
              {result?.carouselPackage?.detected_article_type && (
                <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                  {result.carouselPackage.detected_article_type}
                </span>
              )}
              <div className="mt-6">
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="py-6">
              <div className="flex items-start gap-3 p-4 bg-red-50 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Failed to create carousel</p>
                  <p className="text-sm text-red-600 mt-1">{error}</p>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => { setStep('input'); setError(''); }}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
