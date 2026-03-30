'use client';

import { Lock, TrendingUp, Target, MessageSquare, Palette, Globe, CheckCircle, AlertTriangle } from 'lucide-react';

interface SeoInsightsProps {
  data: any;
  locked?: boolean;
}

export default function SeoInsights({ data, locked = false }: SeoInsightsProps) {
  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">SEO & Brand Insights</h3>
        <p className="text-gray-400 text-sm">Insights will appear once analysis completes.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5" /> SEO & Brand Insights
        </h3>
        <p className="text-emerald-100 text-sm mt-1">
          Based on analysis of {data.websiteUrl ?? 'your website'}
        </p>
      </div>

      <div className="p-6 relative">
        {/* Lock overlay for unregistered users */}
        {locked && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock full insights</p>
              <p className="text-sm text-gray-400 mt-1">Preview below — register for complete data</p>
            </div>
          </div>
        )}

        {/* Business Overview */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-500" /> Business Overview
          </h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase mb-1">Business Name</div>
              <div className="font-semibold text-gray-900">{data.businessName ?? 'N/A'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase mb-1">Industry</div>
              <div className="font-semibold text-gray-900">{data.industry ?? 'N/A'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 sm:col-span-2">
              <div className="text-xs text-gray-400 uppercase mb-1">Core Offer</div>
              <div className="text-gray-700 text-sm">{data.coreOffer ?? 'N/A'}</div>
            </div>
          </div>
        </div>

        {/* Target Customer */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-500" /> Target Customer
          </h4>
          <div className="bg-purple-50 rounded-lg p-4">
            <p className="text-gray-700 text-sm">{data.targetCustomer ?? 'Not identified'}</p>
          </div>
          {data.products?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-gray-400 uppercase mb-2">Products / Services</div>
              <div className="flex flex-wrap gap-2">
                {(data.products as string[]).map((p: string, i: number) => (
                  <span key={i} className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Brand Voice */}
        {data.brandVoice?.tone && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-orange-500" /> Brand Voice
            </h4>
            <div className="bg-orange-50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase mb-1">Tone</div>
              <p className="text-gray-700 text-sm">{data.brandVoice.tone}</p>
            </div>
          </div>
        )}

        {/* Content Recommendations */}
        {data.keyTopics?.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" /> Recommended Content Topics
            </h4>
            <div className="space-y-2">
              {(data.keyTopics as string[]).slice(0, 8).map((topic: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">{topic}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topics to Avoid */}
        {data.avoidTopics?.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Topics to Avoid
            </h4>
            <div className="space-y-2">
              {(data.avoidTopics as string[]).slice(0, 5).map((topic: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600">{topic}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {data.recommendations?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Action Items</h4>
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              {(data.recommendations as string[]).map((rec: string, i: number) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-gray-700">{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
