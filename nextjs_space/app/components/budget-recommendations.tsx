'use client';

import { DollarSign, PieChart, TrendingUp, Lock } from 'lucide-react';

interface BudgetRecommendationsProps {
  data: any;
  locked?: boolean;
}

export default function BudgetRecommendations({ data, locked = false }: BudgetRecommendationsProps) {
  if (!data) return null;

  const tiers = data.tiers ?? [];
  const allocation = data.allocation ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 px-6 py-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <DollarSign className="w-5 h-5" /> Budget Recommendations
        </h3>
        <p className="text-emerald-100 text-sm mt-1">
          Suggested ad spend for {data.businessName ?? 'your business'}
        </p>
      </div>

      <div className="p-6 relative">
        {locked && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-700">Register to unlock budget plan</p>
            </div>
          </div>
        )}

        {/* Budget Tiers */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Monthly Budget Tiers</h4>
          <div className="grid sm:grid-cols-3 gap-3">
            {tiers.map((tier: any, i: number) => {
              const colors = ['border-blue-200 bg-blue-50', 'border-purple-200 bg-purple-50', 'border-orange-200 bg-orange-50'];
              const textColors = ['text-blue-700', 'text-purple-700', 'text-orange-700'];
              return (
                <div key={i} className={`rounded-xl p-4 border-2 ${colors[i] ?? colors[0]}`}>
                  <div className={`text-xs font-bold uppercase ${textColors[i] ?? textColors[0]} mb-1`}>{tier.name}</div>
                  <div className="text-2xl font-black text-gray-900">{tier.range}</div>
                  <p className="text-xs text-gray-600 mt-2">{tier.description}</p>
                  <div className="text-xs text-gray-500 mt-2 font-medium">Expected: {tier.expectedResults}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Allocation Breakdown */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-indigo-500" /> Budget Allocation
          </h4>
          <div className="space-y-3">
            {allocation.map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 text-right">
                  <span className="text-sm font-bold text-gray-900">{item.percent}%</span>
                </div>
                <div className="flex-1">
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">{item.category}</div>
                  <div className="text-xs text-gray-500">{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        {data.tips?.length > 0 && (
          <div className="mt-6 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
            <h4 className="text-xs font-semibold text-emerald-800 uppercase mb-2 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" /> Pro Tips
            </h4>
            <ul className="space-y-1">
              {(data.tips as string[]).map((tip: string, i: number) => (
                <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">\u2022</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
