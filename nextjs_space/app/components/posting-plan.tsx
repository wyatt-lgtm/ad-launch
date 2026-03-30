'use client';

import { Lock, Calendar, Target, BarChart3, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { useState } from 'react';

interface PostingPlanProps {
  data: any;
  locked?: boolean;
}

function PhaseCard({ phase, index }: { phase: any; index: number }) {
  const [expanded, setExpanded] = useState(index === 0);
  const colors = [
    { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-600' },
    { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-600' },
    { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-600' },
  ];
  const color = colors[index] ?? colors[0];

  return (
    <div className={`rounded-xl border ${color.border} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full ${color.bg} px-5 py-4 flex items-center justify-between text-left`}
      >
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className={`${color.badge} text-white text-xs font-bold px-2.5 py-0.5 rounded-full`}>
              {phase.weeks}
            </span>
            <h4 className={`font-bold ${color.text}`}>{phase.name}</h4>
          </div>
          <p className="text-sm text-gray-600">{phase.goal}</p>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {expanded && (
        <div className="p-5 space-y-5">
          {/* Frequency */}
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-gray-600">Posting frequency:</span>
            <span className="font-semibold text-gray-900">{phase.frequency}</span>
          </div>

          {/* Content Mix */}
          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Content Mix</h5>
            <div className="space-y-2">
              {(phase.contentMix ?? []).map((mix: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 text-right">
                    <span className="text-sm font-bold text-gray-900">{mix.percent}%</span>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color.badge}`}
                        style={{ width: `${mix.percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">{mix.type}</div>
                    <div className="text-xs text-gray-500 truncate">{mix.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Schedule */}
          {phase.weeklySchedule?.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sample Weekly Schedule</h5>
              <div className="bg-gray-50 rounded-lg overflow-hidden">
                {(phase.weeklySchedule as any[]).map((day: any, i: number) => (
                  <div key={i} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <span className="text-sm font-semibold text-gray-700 w-24">{day.day}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${color.bg} ${color.text}`}>{day.type}</span>
                    <span className="text-xs text-gray-500 flex-1 truncate">{day.example}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PostingPlan({ data, locked = false }: PostingPlanProps) {
  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-2">90-Day Posting Plan</h3>
        <p className="text-gray-400 text-sm">Your custom posting plan will appear once analysis completes.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Calendar className="w-5 h-5" /> 90-Day Social Media Plan
        </h3>
        <p className="text-indigo-200 text-sm mt-1">
          Custom strategy for {data.businessName ?? 'your business'}
        </p>
      </div>

      <div className="p-6 relative">
        {/* Lock overlay */}
        {locked && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock full plan</p>
              <p className="text-sm text-gray-400 mt-1">Preview below — register for complete access</p>
            </div>
          </div>
        )}

        {/* Overview */}
        <div className="mb-6">
          <p className="text-gray-700 text-sm leading-relaxed">{data.overview}</p>
        </div>

        {/* Upcoming Events */}
        {data.upcomingEvents?.length > 0 && (
          <div className="mb-8">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-pink-500" /> Upcoming Events &amp; Holidays
            </h4>
            <div className="grid sm:grid-cols-2 gap-2">
              {(data.upcomingEvents as any[]).map((event: any, i: number) => (
                <div key={i} className="flex items-center gap-3 bg-gradient-to-r from-pink-50 to-orange-50 rounded-lg px-4 py-2.5 border border-pink-100">
                  <span className="text-lg flex-shrink-0">{'\u{1F389}'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900">{event.name}</div>
                    <div className="text-xs text-gray-500">{event.date} &middot; Week {event.week}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phases */}
        <div className="space-y-4 mb-8">
          {(data.phases ?? []).map((phase: any, i: number) => (
            <PhaseCard key={i} phase={phase} index={i} />
          ))}
        </div>

        {/* KPIs */}
        {data.kpis?.length > 0 && (
          <div className="mb-8">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" /> Expected Results
            </h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(data.kpis as any[]).map((kpi: any, i: number) => (
                <div key={i} className="bg-indigo-50 rounded-lg p-4">
                  <div className="text-xs text-indigo-500 font-medium uppercase">{kpi.metric}</div>
                  <div className="text-lg font-bold text-indigo-900 mt-1">{kpi.target}</div>
                  <div className="text-xs text-gray-500 mt-1">{kpi.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        {data.ctaMessage && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
            <p className="text-gray-700 text-sm leading-relaxed mb-4">{data.ctaMessage}</p>
            <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm">
              <ArrowRight className="w-4 h-4" />
              Let us execute this plan for you
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
