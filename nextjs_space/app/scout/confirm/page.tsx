'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { CheckCircle2, AlertCircle, Clock, ArrowRight } from 'lucide-react';

function ConfirmContent() {
  const params = useSearchParams();
  const status = params.get('status') || 'success';
  const packageId = params.get('packageId') || '';

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

  // Success
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">We&apos;re Creating Your Post</h1>
        <p className="text-slate-600 mb-6">
          Your post is being generated now. We&apos;ll email you when it&apos;s ready to review and download.
        </p>
        <div className="bg-slate-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-slate-500 mb-2">Need more posts today?</p>
          <p className="text-sm text-slate-700 font-medium">
            Sign in to review all stories and create up to 3 posts.
          </p>
        </div>
        <Link
          href="/dashboard/social?scout=1"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          Review All Stories <ArrowRight className="w-4 h-4" />
        </Link>
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
