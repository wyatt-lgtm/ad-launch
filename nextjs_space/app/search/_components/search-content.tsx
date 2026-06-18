'use client';

import { useState } from 'react';
import { Search, MapPin, Building2, ArrowRight, Loader2, Globe, Phone, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Business {
  name: string;
  address: string;
  phone: string;
  website: string;
  description: string;
}

export default function SearchContent() {
  const router = useRouter();
  const [mode, setMode] = useState<'category' | 'url'>('category');
  const [businessType, setBusinessType] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Business[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState('');

  const handleCategorySearch = async () => {
    if (!businessType.trim() || !location.trim()) return;
    setLoading(true);
    setError('');
    setResults([]);
    setSearched(true);
    try {
      const res = await fetch('/api/search-businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType: businessType.trim(), location: location.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.businesses?.length) {
        setResults(data.businesses);
      } else {
        setError(data.error ?? 'No businesses found. Try a different search.');
      }
    } catch {
      setError('Search failed. Please try again.');
    }
    setLoading(false);
  };

  const handleUrlSearch = async () => {
    if (!url.trim()) return;
    const cleanUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
    setUrlLoading(true);
    setUrlError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: cleanUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const debugInfo = data?.debug ? ` (${data.debug})` : '';
        setUrlError((data?.error ?? 'Failed to start analysis') + debugInfo);
        setUrlLoading(false);
        return;
      }
      // Store location data for the analysis tracker
      if (data?.scrapedAddress) {
        try { sessionStorage.setItem(`scraped_${data.analysisId}`, JSON.stringify(data.scrapedAddress)); } catch {}
      }
      if (data?.places?.length > 0) {
        try { sessionStorage.setItem(`places_${data.analysisId}`, JSON.stringify(data.places)); } catch {}
      }
      router.push(`/analyze/${data?.analysisId ?? ''}`);
    } catch {
      setUrlError('Something went wrong. Please try again.');
      setUrlLoading(false);
    }
  };

  return (
    <main className="flex-1">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 text-white">
        <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-3xl sm:text-4xl font-black mb-4">
            Find &amp; Optimize Local Businesses
          </h1>
          <p className="text-blue-200 text-lg mb-8">
            Search for any local business to get a comprehensive AI-powered optimization report with SEO analysis, marketing copy, and ad concepts.
          </p>

          {/* Search Tabs */}
          <div className="flex justify-center gap-1 mb-6">
            <button
              onClick={() => setMode('category')}
              className={`px-5 py-2.5 rounded-l-xl text-sm font-semibold transition-all ${
                mode === 'category'
                  ? 'bg-white text-blue-700'
                  : 'bg-white/10 text-blue-200 hover:bg-white/20'
              }`}
            >
              Search by Category
            </button>
            <button
              onClick={() => setMode('url')}
              className={`px-5 py-2.5 rounded-r-xl text-sm font-semibold transition-all ${
                mode === 'url'
                  ? 'bg-white text-blue-700'
                  : 'bg-white/10 text-blue-200 hover:bg-white/20'
              }`}
            >
              Search by URL
            </button>
          </div>

          {/* Search Form */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
            {mode === 'category' ? (
              <div className="space-y-4">
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                  <input
                    type="text"
                    placeholder="Business type (e.g., plumber, dentist, coffee shop)"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCategorySearch()}
                    className="w-full pl-12 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                  <input
                    type="text"
                    placeholder="Location (e.g., Austin, TX)"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCategorySearch()}
                    className="w-full pl-12 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={handleCategorySearch}
                  disabled={loading || !businessType.trim() || !location.trim()}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  {loading ? 'Scanning the web...' : 'Search Businesses'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                  <input
                    type="text"
                    placeholder="Business URL (e.g., www.example.com)"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlSearch()}
                    className="w-full pl-12 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                {urlError && (
                  <p className="text-red-300 text-sm text-left">{urlError}</p>
                )}
                <button
                  onClick={handleUrlSearch}
                  disabled={!url.trim() || urlLoading}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
                >
                  {urlLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  {urlLoading ? 'Analyzing...' : 'Analyze Website'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-12">
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-500 text-sm">Scanning the web for {businessType} in {location}...</p>
            </motion.div>
          )}

          {!loading && error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-8"
            >
              <p className="text-gray-500">{error}</p>
            </motion.div>
          )}

          {!loading && results.length > 0 && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                Found {results.length} {businessType} in {location}
              </h2>
              {results.map((biz, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-gray-900 mb-1">{biz.name}</h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-2">
                        {biz.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" /> {biz.address}
                          </span>
                        )}
                        {biz.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" /> {biz.phone}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{biz.description}</p>
                    </div>
                    {biz.website && (
                      <Link
                        href={`/?url=${encodeURIComponent(biz.website)}`}
                        className="flex-shrink-0 ml-4 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all"
                        title="Generate ads for this business"
                      >
                        <ArrowRight className="w-5 h-5" />
                      </Link>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {!loading && searched && results.length === 0 && !error && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No businesses found. Try broadening your search.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
