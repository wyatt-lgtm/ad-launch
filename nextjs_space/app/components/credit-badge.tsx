'use client';

import { useState, useEffect } from 'react';
import { Coins, AlertTriangle } from 'lucide-react';

interface CreditBadgeProps {
  businessId: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
  onBalanceLoaded?: (balance: number) => void;
}

export default function CreditBadge({
  businessId,
  showLabel = true,
  compact = false,
  className = '',
  onBalanceLoaded,
}: CreditBadgeProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [expiringSoon, setExpiringSoon] = useState<number>(0);
  const [nextExpiration, setNextExpiration] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/credits/balance?businessId=${businessId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setBalance(data.balance ?? 0);
          setExpiringSoon(data.expiringSoonCredits ?? 0);
          setNextExpiration(data.nextExpirationDate ?? null);
          onBalanceLoaded?.(data.balance ?? 0);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || balance === null) {
    return compact ? null : (
      <span className={`inline-flex items-center gap-1 text-xs text-gray-400 ${className}`}>
        <Coins className="w-3.5 h-3.5" />
        <span className="animate-pulse">...</span>
      </span>
    );
  }

  const isLow = balance <= 1;
  const isEmpty = balance <= 0;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          isEmpty
            ? 'bg-red-100 text-red-700'
            : isLow
            ? 'bg-amber-100 text-amber-700'
            : 'bg-blue-100 text-blue-700'
        } ${className}`}
      >
        <Coins className="w-3 h-3" />
        {balance}
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
          isEmpty
            ? 'bg-red-50 text-red-700 border border-red-200'
            : isLow
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-blue-50 text-blue-700 border border-blue-200'
        }`}
      >
        {isEmpty ? (
          <AlertTriangle className="w-4 h-4" />
        ) : (
          <Coins className="w-4 h-4" />
        )}
        <span>{balance} credit{balance !== 1 ? 's' : ''}</span>
        {showLabel && (
          <span className="text-xs opacity-70">remaining</span>
        )}
      </div>
      {showLabel && balance === 6 && (
        <span className="text-xs text-gray-400 ml-1">6 starter credits included for your first month.</span>
      )}
      {showLabel && isEmpty && (
        <span className="text-xs text-red-500 ml-1">Recharge checkout coming soon. Contact support to add credits.</span>
      )}
      {showLabel && !isEmpty && expiringSoon > 0 && nextExpiration && (
        <span className="text-xs text-amber-600 ml-1">
          {expiringSoon} credit{expiringSoon !== 1 ? 's' : ''} expire{expiringSoon === 1 ? 's' : ''}{' '}
          {formatRelativeDate(nextExpiration)}
        </span>
      )}
    </div>
  );
}

function formatRelativeDate(isoDate: string): string {
  const diff = Math.ceil((new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff} days`;
}
