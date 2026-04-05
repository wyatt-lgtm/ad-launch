'use client';

import { useState } from 'react';

interface AdResult {
  strategy: string;
  imageUrl: string | null;
  error: string | null;
  model: string;
  prompt: string;
}

interface TestResponse {
  brief: any;
  results: AdResult[];
}

const STRATEGY_LABELS: Record<string, { label: string; description: string }> = {
  simple_gpt_image: { label: 'GPT Image (Simple)', description: 'gpt_image15 with a basic ad prompt' },
  layout_gpt5: { label: 'GPT-5.1 (Layout Spec)', description: 'gpt-5.1 with detailed layout structure' },
  designer_brief_gpt5: { label: 'GPT-5.1 (Designer Brief)', description: 'gpt-5.1 with creative agency brief style' },
  spectra_style: { label: 'GPT-5.1 (Spectra Style)', description: 'gpt-5.1 mimicking Spectra\'s 3-section layout' },
  flux_pro: { label: 'Flux Pro', description: 'Flux Pro model with structured prompt' },
  ideogram_text: { label: 'Ideogram', description: 'Ideogram model (known for text rendering)' },
};

const DEFAULT_BRIEF = {
  businessName: 'Blazing Hog',
  industry: 'Rural Internet Service Provider',
  headline: 'Blazing-Fast Rural Internet. No Data Caps.',
  subheadline: 'Up to 100 Mbps where cable can\'t reach',
  cta: 'Check Availability',
  brandColors: 'dark maroon/burgundy (#5B1A18)',
  socialProof: '4.8 ★★★★★ | 2,000+ Rural Customers',
  logoDescription: 'A hog/pig mascot with flames, in orange/brown colors',
  websiteUrl: 'https://blazinghog.com',
};

export default function TestAdsPage() {
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [results, setResults] = useState<AdResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeStrategies, setActiveStrategies] = useState<string[]>(Object.keys(STRATEGY_LABELS));
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const toggleStrategy = (s: string) => {
    setActiveStrategies(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const runTest = async () => {
    if (activeStrategies.length === 0) return;
    setLoading(true);
    setResults([]);
    setProgress(`Running ${activeStrategies.length} strategies...`);

    try {
      const res = await fetch('/api/test-ad-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...brief, strategies: activeStrategies }),
      });
      const data: TestResponse = await res.json();
      setResults(data.results ?? []);
      setProgress(`Done! ${data.results?.filter((r: AdResult) => r.imageUrl).length}/${data.results?.length} succeeded`);
    } catch (err: any) {
      setProgress(`Error: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">🧪 Ad Generation A/B Test Lab</h1>
        <p className="text-gray-400 mb-8">Compare different AI image generation strategies for Facebook ads</p>

        {/* Brief Editor */}
        <div className="bg-gray-900 rounded-xl p-6 mb-8 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">📋 Ad Brief</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(brief).map(([key, value]) => (
              <div key={key}>
                <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">{key.replace(/([A-Z])/g, ' $1')}</label>
                <input
                  type="text"
                  value={value}
                  onChange={e => setBrief(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Strategy Selector */}
        <div className="bg-gray-900 rounded-xl p-6 mb-8 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">🎯 Strategies to Test</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(STRATEGY_LABELS).map(([key, { label, description }]) => (
              <button
                key={key}
                onClick={() => toggleStrategy(key)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  activeStrategies.includes(key)
                    ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400'
                }`}
              >
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs mt-1 opacity-70">{description}</div>
              </button>
            ))}
          </div>
          <button
            onClick={runTest}
            disabled={loading || activeStrategies.length === 0}
            className="mt-6 px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg font-semibold text-white transition-colors"
          >
            {loading ? '⏳ Generating...' : `🚀 Generate ${activeStrategies.length} Ads`}
          </button>
          {progress && <p className="mt-3 text-sm text-gray-400">{progress}</p>}
        </div>

        {/* Results Grid */}
        {results.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">📊 Results Comparison</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {results.map((r, i) => {
                const meta = STRATEGY_LABELS[r.strategy] ?? { label: r.strategy, description: '' };
                return (
                  <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    <div className="p-4 border-b border-gray-800">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm">{meta.label}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          r.imageUrl ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {r.imageUrl ? '✅ Success' : '❌ Failed'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Model: {r.model}</p>
                    </div>

                    <div className="aspect-[4/5] bg-gray-800 relative">
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
                          alt={`${meta.label} result`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
                          {r.error ?? 'No image generated'}
                        </div>
                      )}
                    </div>

                    <div className="p-3">
                      <button
                        onClick={() => setExpandedPrompt(expandedPrompt === r.strategy ? null : r.strategy)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        {expandedPrompt === r.strategy ? '▼ Hide Prompt' : '▶ Show Prompt'}
                      </button>
                      {expandedPrompt === r.strategy && (
                        <pre className="mt-2 text-xs text-gray-400 bg-gray-800 p-3 rounded-lg overflow-auto max-h-60 whitespace-pre-wrap">
                          {r.prompt}
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* HTML Template Preview */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
          <h2 className="text-lg font-semibold mb-4">🎨 HTML Template Approach (Option B)</h2>
          <p className="text-gray-400 text-sm mb-6">This shows what a template-based composition would look like — brand colors, structured layout, with an AI photo slot</p>
          
          <div className="flex justify-center">
            <div className="w-[400px] rounded-xl overflow-hidden shadow-2xl border border-gray-700">
              {/* Facebook chrome mockup */}
              <div className="bg-white px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-600 to-red-800 flex items-center justify-center text-white text-xs font-bold">🐗</div>
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{brief.businessName}</div>
                  <div className="text-xs text-gray-500">Sponsored · 🌐</div>
                </div>
              </div>

              {/* Brand header section */}
              <div className="bg-[#5B1A18] px-6 py-5">
                <h3 className="text-white font-black text-xl leading-tight">{brief.headline}</h3>
                <p className="text-white/80 text-sm mt-2">{brief.subheadline}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-orange-400 font-bold text-sm">4.8</span>
                  <span className="text-orange-400">★★★★★</span>
                  <span className="text-white/60 text-xs">| 2,000+ Rural Customers</span>
                </div>
              </div>

              {/* Hero image placeholder */}
              <div className="aspect-[4/3] bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <div className="text-4xl mb-2">📸</div>
                  <div className="text-sm font-medium">AI-Generated Lifestyle Photo</div>
                  <div className="text-xs">(Family using internet at home)</div>
                </div>
              </div>

              {/* CTA bar */}
              <div className="bg-[#5B1A18] px-6 py-4 flex justify-center">
                <button className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-8 py-3 rounded-lg text-sm transition-colors">
                  {brief.cta}
                </button>
              </div>

              {/* Facebook engagement bar */}
              <div className="bg-white px-4 py-3 flex justify-around border-t border-gray-200">
                <span className="text-gray-500 text-sm font-medium">👍 Like</span>
                <span className="text-gray-500 text-sm font-medium">💬 Comment</span>
                <span className="text-gray-500 text-sm font-medium">↗️ Share</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
