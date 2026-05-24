'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Clock, ArrowRight, Loader2, Download, Eye } from 'lucide-react';

/* ── Types ─────────────────────────────────── */
interface PackageStatus {
  id: string;
  status: string; // generating | ready | downloaded | draft | rejected | posted
  storyTitle: string;
  headline: string;
  imageUrl: string;
  completedAt: string | null;
  createdAt: string;
}

/* ── Polling hook ──────────────────────────── */
function usePackagePolling(packageId: string | null) {
  const [pkg, setPkg] = useState<PackageStatus | null>(null);
  const [polling, setPolling] = useState(!!packageId);

  const poll = useCallback(async () => {
    if (!packageId) return;
    try {
      const res = await fetch(`/api/scout/package-status?id=${packageId}`);
      if (res.ok) {
        const data: PackageStatus = await res.json();
        setPkg(data);
        if (data.status !== 'generating') {
          setPolling(false);
        }
      }
    } catch { /* retry next interval */ }
  }, [packageId]);

  useEffect(() => {
    if (!packageId) return;
    // Initial fetch
    poll();
    if (!polling) return;
    const interval = setInterval(poll, 15_000); // every 15s
    return () => clearInterval(interval);
  }, [packageId, polling, poll]);

  return { pkg, polling };
}

/* ── Live progress indicator ───────────────── */
function GeneratingProgress({ pkg, polling }: { pkg: PackageStatus | null; polling: boolean }) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!polling) return;
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(iv);
  }, [polling]);

  if (!polling && pkg?.status === 'ready') return null; // handled by ready state below

  const ageMin = pkg ? Math.round((Date.now() - new Date(pkg.createdAt).getTime()) / 60000) : 0;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
      <div className="flex items-center gap-3 mb-2">
        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
        <span className="text-sm font-semibold text-blue-800">Creating your post{dots}</span>
      </div>
      {pkg?.storyTitle && (
        <p className="text-xs text-blue-700 ml-8 mb-1">{pkg.storyTitle}</p>
      )}
      <p className="text-xs text-blue-600 ml-8">
        {ageMin < 2 ? 'Just started — analyzing your website and story' :
         ageMin < 5 ? 'Crafting copy and generating artwork' :
         ageMin < 10 ? 'Finishing up — should be ready soon' :
         'Still working — we\'ll email you when it\'s done'}
      </p>
    </div>
  );
}

/* ── Ready state ───────────────────────────── */
function ReadyNotice({ pkg }: { pkg: PackageStatus }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <CheckCircle2 className="w-5 h-5 text-green-600" />
        <span className="text-sm font-semibold text-green-800">Your post is ready!</span>
      </div>
      {pkg.headline && <p className="text-sm font-medium text-slate-800 mb-1">{pkg.headline}</p>}
      {pkg.imageUrl && (
        <div className="my-3 rounded-lg overflow-hidden border border-green-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pkg.imageUrl} alt="Post preview" className="w-full" />
        </div>
      )}
      <div className="flex gap-3 mt-3">
        <Link
          href={`/post/${pkg.id}`}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-blue-700 transition"
        >
          <Eye className="w-4 h-4" /> Review & Download
        </Link>
        <a
          href={`/api/post-package/${pkg.id}/download`}
          className="inline-flex items-center justify-center gap-2 bg-slate-800 text-white px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-slate-900 transition"
        >
          <Download className="w-4 h-4" /> Package
        </a>
      </div>
    </div>
  );
}

/* ── Main content ──────────────────────────── */
function ConfirmContent() {
  const params = useSearchParams();
  const status = params.get('status') || 'success';
  const packageId = params.get('packageId') || '';

  const { pkg, polling } = usePackagePolling(status === 'success' && packageId ? packageId : null);

  if (status === 'active_workflow') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Post Already in Progress</h1>
          <p className="text-slate-600 mb-6">
            Your previous post is still being created. We&apos;ll email you when it&apos;s ready.
          </p>
          <Link
            href="/dashboard/social"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Sign In to View Progress <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Something Went Wrong</h1>
          <p className="text-slate-600 mb-6">
            We couldn&apos;t start this post. Please try again or sign in to create posts from the dashboard.
          </p>
          <Link
            href="/dashboard/social"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  // Success — show live status
  const isReady = pkg?.status === 'ready' || pkg?.status === 'downloaded' || pkg?.status === 'draft' || pkg?.status === 'posted';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          {isReady ? 'Your Post is Ready!' : 'We\u2019re Creating Your Post'}
        </h1>

        {!isReady && (
          <p className="text-slate-600 mb-4">
            Your post is being generated now. We&apos;ll email you when it&apos;s ready, or wait here to see it.
          </p>
        )}

        {/* Live progress or ready state */}
        <div className="mb-6">
          {isReady && pkg ? (
            <ReadyNotice pkg={pkg} />
          ) : packageId ? (
            <GeneratingProgress pkg={pkg} polling={polling} />
          ) : (
            <p className="text-slate-600">
              Your post is being generated. We&apos;ll email you when it&apos;s ready to review and download.
            </p>
          )}
        </div>

        {!isReady && (
          <div className="bg-slate-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-slate-500 mb-2">Need more posts today?</p>
            <p className="text-sm text-slate-700 font-medium">
              Sign in to review all stories and create up to 3 posts.
            </p>
          </div>
        )}

        {!isReady && (
          <Link
            href="/dashboard/social?scout=1"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Review All Stories <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ScoutConfirmPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    }>
      <ConfirmContent />
    </Suspense>
  );
}
