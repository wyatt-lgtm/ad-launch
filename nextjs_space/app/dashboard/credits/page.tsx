'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Coins, Clock, ArrowUpRight, ArrowDownRight, Gift, RefreshCw,
  Loader2, ChevronLeft, ChevronRight, Info, ShieldCheck,
} from 'lucide-react';
import { useActiveBusiness } from '@/hooks/use-active-business';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  balanceAfter: number | null;
}

interface BalanceData {
  balance: number;
  monthlyAllowance: number;
  planName: string;
  expiringSoonCredits: number;
  nextExpirationDate: string | null;
  expirationPolicy: {
    grantExpiryDays: number;
    closureExpiryDays: number;
    expiringSoonDays: number;
  };
}

const TYPE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  starter_grant:   { label: 'Starter credits',    icon: Gift,           color: 'text-green-600 bg-green-50' },
  monthly_grant:   { label: 'Monthly credits',     icon: RefreshCw,      color: 'text-blue-600 bg-blue-50' },
  recharge_grant:  { label: 'Purchased credits',   icon: ArrowUpRight,   color: 'text-emerald-600 bg-emerald-50' },
  admin_grant:     { label: 'Admin adjustment',     icon: ShieldCheck,    color: 'text-purple-600 bg-purple-50' },
  refund:          { label: 'Refund',               icon: ArrowUpRight,   color: 'text-green-600 bg-green-50' },
  charge:          { label: 'Post created',         icon: ArrowDownRight, color: 'text-red-600 bg-red-50' },
  credit_expired:  { label: 'Credits expired',      icon: Clock,          color: 'text-gray-500 bg-gray-50' },
  adjustment:      { label: 'Adjustment',           icon: RefreshCw,      color: 'text-amber-600 bg-amber-50' },
};

const PAGE_SIZE = 20;

export default function CreditHistoryPage() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const bizCtx = useActiveBusiness();
  const businessId = bizCtx?.activeBusiness?.id ?? null;

  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login');
  }, [sessionStatus, router]);

  // Load balance
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/credits/balance?businessId=${businessId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBalanceData(d); })
      .catch(() => {});
  }, [businessId]);

  // Load transactions
  const loadTransactions = useCallback(async (p: number) => {
    if (!businessId) return;
    setTxLoading(true);
    try {
      const res = await fetch(`/api/credits/transactions?businessId=${businessId}&limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setTotal(data.total || 0);
      }
    } catch { /* silent */ }
    setTxLoading(false);
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      setLoading(true);
      loadTransactions(0).finally(() => setLoading(false));
    }
  }, [businessId, loadTransactions]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    loadTransactions(newPage);
  };

  if (sessionStatus === 'loading' || loading || !bizCtx) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!businessId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Coins className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No business selected. Go to your dashboard to select a business.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Coins className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Credit History</h1>
        </div>
        <p className="text-gray-500 text-sm">Track how your credits are earned and used.</p>
      </div>

      {/* Balance summary card */}
      {balanceData && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Balance</p>
              <p className={`text-2xl font-bold ${
                balanceData.balance <= 0 ? 'text-red-600' :
                balanceData.balance <= 1 ? 'text-amber-600' : 'text-blue-700'
              }`}>
                {balanceData.balance}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Monthly Allowance</p>
              <p className="text-2xl font-bold text-gray-900">{balanceData.monthlyAllowance}</p>
            </div>
            {balanceData.expiringSoonCredits > 0 && balanceData.nextExpirationDate && (
              <div>
                <p className="text-xs text-amber-500 uppercase tracking-wider mb-1">Expiring Soon</p>
                <p className="text-2xl font-bold text-amber-600">{balanceData.expiringSoonCredits}</p>
                <p className="text-xs text-amber-500 mt-0.5">
                  by {new Date(balanceData.nextExpirationDate).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expiration policy info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-700 space-y-1">
            <p>Monthly credits expire 60 days after they are added.</p>
            <p>Purchased credits do not expire while your account is active.</p>
            <p>Purchased credits expire 30 days after account closure.</p>
          </div>
        </div>
      </div>

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Transactions</h2>
        </div>

        {txLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No credit activity yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {transactions.map(tx => {
              const meta = TYPE_LABELS[tx.transactionType] || {
                label: tx.transactionType.replace(/_/g, ' '),
                icon: Coins,
                color: 'text-gray-600 bg-gray-50',
              };
              const Icon = meta.icon;
              const isPositive = tx.amount > 0;

              return (
                <div key={tx.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{meta.label}</p>
                    {tx.reason && (
                      <p className="text-xs text-gray-400 truncate">{tx.reason}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${
                      isPositive ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {isPositive ? '+' : ''}{tx.amount}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-400">
              Page {page + 1} of {totalPages} ({total} transactions)
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 0}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
