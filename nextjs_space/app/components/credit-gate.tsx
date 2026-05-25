'use client';

import { Coins, Lock } from 'lucide-react';

/**
 * Wraps a CTA button to show credit cost and block if insufficient.
 */
interface CreditGateProps {
  balance: number | null;
  cost: number;
  children: React.ReactNode;
  className?: string;
}

export default function CreditGate({ balance, cost, children, className = '' }: CreditGateProps) {
  const isLoading = balance === null;
  const hasEnough = balance !== null && balance >= cost;
  const isEmpty = balance !== null && balance <= 0;

  if (isLoading) return <>{children}</>;

  if (!hasEnough) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {isEmpty ? "You're out of credits" : `Not enough credits (need ${cost}, have ${balance})`}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Recharge checkout coming soon. Contact support to add credits.
              </p>
            </div>
          </div>
        </div>
        <div className="opacity-50 pointer-events-none">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
        <Coins className="w-3.5 h-3.5" />
        Uses {cost} credit{cost > 1 ? 's' : ''}
      </div>
      {children}
    </div>
  );
}
