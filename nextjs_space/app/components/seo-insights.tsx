'use client';

import { useState } from 'react';
import { Lock, TrendingUp, Target, MessageSquare, Globe, CheckCircle, AlertTriangle, XCircle, Shield, Smartphone, Share2, Code, FileText, Link2, Type, Image as ImageIcon, ChevronDown, ChevronUp } from 'lucide-react';

interface SeoInsightsProps {
  data: any;
  locked?: boolean;
}

const CATEGORY_ICONS: Record<string, any> = {
  'Security': Shield,
  'Availability': Globe,
  'Performance': TrendingUp,
  'On-Page SEO': Type,
  'Mobile': Smartphone,
  'Social & Sharing': Share2,
  'Technical SEO': Code,
  'Accessibility': ImageIcon,
  'Content': FileText,
};

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#10B981' : score >= 65 ? '#F59E0B' : score >= 50 ? '#F97316' : '#EF4444';

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#E5E7EB" strokeWidth="8" />
        <circle
          cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black" style={{ color }}>{score}</span>
        <span className="text-xs font-bold text-gray-400">Grade {grade}</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pass') return (
    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
      <CheckCircle className="w-3.5 h-3.5" /> Pass
    </span>
  );
  if (status === 'warn') return (
    <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
      <AlertTriangle className="w-3.5 h-3.5" /> Warning
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
      <XCircle className="w-3.5 h-3.5" /> Issue
    </span>
  );
}

export default function SeoInsights({ data, locked = false }: SeoInsightsProps) {
  const [expanded, setExpanded] = useState(false);

  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">SEO Audit</h3>
        <p className="text-gray-400 text-sm">SEO audit will appear once analysis completes.</p>
      </div>
    );
  }

  const audit = data.audit;
  const hasAudit = audit && typeof audit.score === 'number';
  const scoreColor = hasAudit
    ? audit.score >= 80 ? '#10B981' : audit.score >= 65 ? '#F59E0B' : audit.score >= 50 ? '#F97316' : '#EF4444'
    : '#94A3B8';

  // Group audit items by category
  const groupedItems: Record<string, any[]> = {};
  if (hasAudit && Array.isArray(audit.items)) {
    for (const item of audit.items) {
      const cat = item.category ?? 'Other';
      if (!groupedItems[cat]) groupedItems[cat] = [];
      groupedItems[cat].push(item);
    }
  }

  const passCount = audit?.items?.filter((i: any) => i.status === 'pass').length ?? 0;
  const warnCount = audit?.items?.filter((i: any) => i.status === 'warn').length ?? 0;
  const failCount = audit?.items?.filter((i: any) => i.status === 'fail').length ?? 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header with score */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4 flex items-center justify-between cursor-pointer hover:from-emerald-600 hover:to-teal-600 transition-all"
      >
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-white" />
          <div className="text-left">
            <h3 className="text-lg font-bold text-white">SEO Audit Report</h3>
            <p className="text-emerald-100 text-sm">
              Technical analysis of {data.websiteUrl ?? 'your website'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasAudit && (
            <div className="flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5">
              <span className="text-white font-black text-lg">{audit.score}</span>
              <span className="text-emerald-100 text-sm font-medium">/ 100</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: scoreColor, color: '#fff' }}>
                {audit.grade}
              </span>
            </div>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
        </div>
      </button>

      {/* Collapsible detail */}
      {expanded && (
        <div className="p-6 relative">
          {locked && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
              <div className="text-center">
                <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="font-semibold text-gray-700">Register to unlock full audit</p>
              </div>
            </div>
          )}

          {hasAudit ? (
            <>
              {/* Score Ring + Summary */}
              <div className="text-center mb-8">
                <ScoreRing score={audit.score} grade={audit.grade} />
                <div className="flex justify-center gap-4 mt-4">
                  <span className="text-sm"><span className="font-bold text-emerald-600">{passCount}</span> <span className="text-gray-400">passed</span></span>
                  <span className="text-sm"><span className="font-bold text-amber-600">{warnCount}</span> <span className="text-gray-400">warnings</span></span>
                  <span className="text-sm"><span className="font-bold text-red-600">{failCount}</span> <span className="text-gray-400">issues</span></span>
                </div>
              </div>

              {/* Category Score Cards */}
              {(() => {
                const catScores: Record<string, { pass: number; total: number }> = {};
                for (const item of audit.items ?? []) {
                  const cat = item.category ?? 'Other';
                  if (!catScores[cat]) catScores[cat] = { pass: 0, total: 0 };
                  catScores[cat].total += 1;
                  if (item.status === 'pass') catScores[cat].pass += 1;
                }
                const catList = Object.entries(catScores).map(([name, { pass, total }]) => ({
                  name,
                  score: total > 0 ? Math.round((pass / total) * 100) : 0,
                }));
                return catList.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                    {catList.map((cat) => {
                      const color = cat.score >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : cat.score >= 50 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
                      const CatIcon = CATEGORY_ICONS[cat.name] ?? Globe;
                      return (
                        <div key={cat.name} className={`rounded-xl p-3 border ${color} text-center`}>
                          <CatIcon className="w-5 h-5 mx-auto mb-1 opacity-70" />
                          <div className="text-2xl font-black">{cat.score}</div>
                          <div className="text-xs font-medium opacity-80 mt-0.5">{cat.name}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : null;
              })()}

              {/* Issues First (fail), then Warnings, then Passes */}
              {Object.entries(groupedItems).map(([category, items]) => {
                const Icon = CATEGORY_ICONS[category] ?? Globe;
                return (
                  <div key={category} className="mb-5">
                    <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2 flex items-center gap-2">
                      <Icon className="w-4 h-4 text-gray-500" /> {category}
                    </h4>
                    <div className="space-y-2">
                      {items
                        .sort((a: any, b: any) => {
                          const order: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
                          return (order[a.status] ?? 2) - (order[b.status] ?? 2);
                        })
                        .map((item: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                            <div className="flex-shrink-0 mt-0.5">
                              <StatusBadge status={item.status} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-900">{item.label}</div>
                              <div className="text-xs text-gray-600 mt-0.5">{item.detail}</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-gray-400 text-sm">No audit data available.</p>
          )}
        </div>
      )}
    </div>
  );
}
