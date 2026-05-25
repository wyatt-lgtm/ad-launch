'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Coins, Calendar, AlertTriangle, ExternalLink, Loader2, Shield, Clock, History } from 'lucide-react';
import Link from 'next/link';

interface BillingData {
  hasSubscription: boolean;
  creditBalance: number;
  monthlyAllowance: number;
  planName: string;
  creditStatus: string;
  stripeConfigured: boolean;
  subscription: {
    status: string;
    priceId: string | null;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    lastPaymentStatus: string | null;
  } | null;
}

interface BillingSectionProps {
  businessId: string;
  className?: string;
}

export default function BillingSection({ businessId, className = '' }: BillingSectionProps) {
  const [data, setData] = useState<BillingData | null>(null);
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [nextExpiration, setNextExpiration] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    async function load() {
      try {
        const [billingRes, balanceRes] = await Promise.all([
          fetch(`/api/billing/status?businessId=${businessId}`),
          fetch(`/api/credits/balance?businessId=${businessId}`),
        ]);
        if (!billingRes.ok) throw new Error('Failed to load billing status');
        const d = await billingRes.json();
        if (!cancelled) setData(d);
        if (balanceRes.ok) {
          const bal = await balanceRes.json();
          if (!cancelled) {
            setExpiringSoon(bal.expiringSoonCredits ?? 0);
            setNextExpiration(bal.nextExpirationDate ?? null);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [businessId]);

  async function handleStartSubscription() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create checkout session');
      // Redirect to Stripe Checkout
      window.location.href = d.url;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManageBilling() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create portal session');
      window.location.href = d.url;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-6 ${className}`}>
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading billing...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-6 ${className}`}>
        <p className="text-sm text-gray-500">Unable to load billing information.</p>
      </div>
    );
  }

  const isTrialing = data.subscription?.status === 'trialing';
  const isActive = data.subscription?.status === 'active';
  const isPastDue = data.creditStatus === 'past_due' || data.creditStatus === 'billing_issue';
  const isCanceled = data.creditStatus === 'canceled';
  const trialEnd = data.subscription?.trialEndsAt ? new Date(data.subscription.trialEndsAt) : null;
  const periodEnd = data.subscription?.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd) : null;

  const statusBadge = () => {
    if (isPastDue) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">Billing Issue</span>;
    if (isCanceled) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">Canceled</span>;
    if (isTrialing) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">Trial</span>;
    if (isActive) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Active</span>;
    if (data.hasSubscription) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">{data.subscription?.status}</span>;
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Beta</span>;
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-900">Billing & Credits</h3>
        </div>
        {statusBadge()}
      </div>

      <div className="p-6 space-y-5">
        {/* Credit Balance */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-gray-600">Credit Balance</span>
          </div>
          <span className={`text-lg font-bold ${
            data.creditBalance <= 0 ? 'text-red-600' :
            data.creditBalance <= 1 ? 'text-amber-600' : 'text-blue-700'
          }`}>
            {data.creditBalance} credit{data.creditBalance !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Plan */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">Plan</span>
          </div>
          <span className="text-sm font-medium text-gray-800 capitalize">
            {data.planName} &middot; {data.monthlyAllowance} credits/month
          </span>
        </div>

        {/* Trial Info */}
        {isTrialing && trialEnd && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-purple-500" />
              <span className="text-sm text-gray-600">Trial ends</span>
            </div>
            <span className="text-sm font-medium text-purple-700">
              {trialEnd.toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Next renewal */}
        {(isActive || isTrialing) && periodEnd && !data.subscription?.cancelAtPeriodEnd && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">Next renewal</span>
            </div>
            <span className="text-sm text-gray-700">
              {periodEnd.toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Cancel at period end */}
        {data.subscription?.cancelAtPeriodEnd && periodEnd && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
              <p className="text-xs text-amber-700">
                Subscription cancels on {periodEnd.toLocaleDateString()}. You'll keep your remaining credits.
              </p>
            </div>
          </div>
        )}

        {/* Billing issue */}
        {isPastDue && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
              <p className="text-xs text-red-700">
                There's a billing issue. Please update your payment method to continue receiving monthly credits.
              </p>
            </div>
          </div>
        )}

        {/* Expiring soon */}
        {expiringSoon > 0 && nextExpiration && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-gray-600">Expiring soon</span>
            </div>
            <span className="text-sm font-medium text-amber-600">
              {expiringSoon} credit{expiringSoon !== 1 ? 's' : ''} by{' '}
              {new Date(nextExpiration).toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Starter/beta message */}
        {!data.hasSubscription && !isCanceled && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700">
              You're on the free beta plan with {data.creditBalance} starter credits.
              Subscribe for monthly credit renewals.
            </p>
          </div>
        )}

        {/* Expiration policy */}
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Monthly credits expire 60 days after they are added. Purchased credits do not expire while your account is active.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          {!data.hasSubscription && data.stripeConfigured && (
            <button
              onClick={handleStartSubscription}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              Subscribe
            </button>
          )}

          {data.hasSubscription && data.stripeConfigured && (
            <button
              onClick={handleManageBilling}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Manage Billing
            </button>
          )}

          {!data.stripeConfigured && (
            <p className="text-xs text-gray-400">
              Billing setup is in progress. Contact support to add credits.
            </p>
          )}
        </div>

        {/* Credit history link */}
        <div className="pt-1">
          <Link
            href="/dashboard/credits"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <History className="w-3.5 h-3.5" />
            View credit history
          </Link>
        </div>
      </div>
    </div>
  );
}
