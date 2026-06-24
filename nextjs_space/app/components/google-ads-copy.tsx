'use client';

import { Search, Copy, Check, Lock, ExternalLink, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface GoogleAdsCopyProps {
  data: any;
  locked?: boolean;
  collapsed?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded" title="Copy">
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function GoogleAdsCopy({ data, locked = false, collapsed = false }: GoogleAdsCopyProps) {
  const [expanded, setExpanded] = useState(!collapsed);

  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Google Search Ads</h3>
        <p className="text-gray-400 text-sm">Google ad copy will appear once analysis completes.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between cursor-pointer hover:from-blue-700 hover:to-cyan-600 transition-all gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Search className="w-5 h-5 text-white flex-shrink-0" />
          <div className="text-left min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-white">Google Search Ad Copy</h3>
            <p className="text-blue-100 text-sm break-words">
              Ready-to-use headlines, descriptions & keywords for {data.businessName ?? 'your business'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-white flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-white flex-shrink-0" />}
      </button>

      {expanded && <div className="p-6 relative">
        {locked && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock ad copy</p>
            </div>
          </div>
        )}

        {/* Google Ad Preview */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Ad Preview</h4>
          <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded">Sponsored</span>
              <span className="text-xs text-gray-500 truncate">{data.displayUrl ?? data.websiteUrl ?? 'yoursite.com'}</span>
            </div>
            <h3 className="text-lg font-semibold text-blue-700 hover:underline cursor-pointer mb-1">
              {data.headlines?.[0] ?? 'Your Business Headline'}
            </h3>
            <p className="text-sm text-gray-600">{data.descriptions?.[0] ?? 'Your business description here.'}</p>
          </div>
        </div>

        {/* Headlines */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Headlines (30 char max each)</h4>
          <div className="space-y-2">
            {(data.headlines ?? []).map((h: string, i: number) => (
              <div key={i} className="flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-2.5">
                <span className="text-xs font-bold text-blue-600 w-5">{i + 1}</span>
                <span className="flex-1 text-sm font-medium text-gray-900">{h}</span>
                <span className={`text-xs font-mono ${h.length <= 30 ? 'text-green-500' : 'text-red-500 font-semibold'}`}>{h.length}/30</span>
                <CopyButton text={h} />
              </div>
            ))}
          </div>
        </div>

        {/* Descriptions */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Descriptions (90 char max each)</h4>
          <div className="space-y-2">
            {(data.descriptions ?? []).map((d: string, i: number) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg px-4 py-3">
                <span className="text-xs font-bold text-gray-500 w-5 mt-0.5">{i + 1}</span>
                <span className="flex-1 text-sm text-gray-700">{d}</span>
                <span className={`text-xs font-mono flex-shrink-0 ${d.length <= 90 ? 'text-green-500' : 'text-red-500 font-semibold'}`}>{d.length}/90</span>
                <CopyButton text={d} />
              </div>
            ))}
          </div>
        </div>

        {/* Target Keywords */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-500" /> Target Keywords
          </h4>
          <div className="flex flex-wrap gap-2">
            {(data.keywords ?? []).map((kw: string, i: number) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 text-xs font-medium px-3 py-1.5 rounded-full border border-purple-100">
                <Search className="w-3 h-3" /> {kw}
              </span>
            ))}
          </div>
        </div>

        {/* Sitelink Extensions */}
        {data.sitelinks?.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-cyan-500" /> Sitelink Extensions
            </h4>
            <div className="grid sm:grid-cols-2 gap-2">
              {(data.sitelinks as any[]).map((sl: any, i: number) => (
                <div key={i} className="bg-cyan-50 rounded-lg px-4 py-2.5 border border-cyan-100">
                  <div className="text-sm font-semibold text-cyan-800">{sl.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{sl.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}
