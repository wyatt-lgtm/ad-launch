'use client';

import { useState } from 'react';
import { Globe, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function UrlInputForm() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = url?.trim() ?? '';
    if (!trimmed) {
      setError('Please enter a website URL');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to start analysis');
        setLoading(false);
        return;
      }
      router.push(`/analyze/${data?.analysisId ?? ''}`);
    } catch (err: any) {
      console.error('Submit error:', err);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative flex items-center bg-white rounded-2xl shadow-lg shadow-blue-100/50 border border-gray-200 hover:border-blue-300 transition-all focus-within:border-blue-500 focus-within:shadow-blue-200/50 overflow-hidden">
        <div className="pl-5">
          <Globe className="w-5 h-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(''); }}
          placeholder="Enter your website URL (e.g., www.mybusiness.com)"
          className="flex-1 px-4 py-4 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-base"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="m-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-2 text-sm whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {loading ? 'Analyzing...' : 'Get Free Ads'}
        </button>
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-500 text-sm justify-center">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
    </form>
  );
}
