'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Clock, ShieldX, ArrowRight } from 'lucide-react';

function ExpiredContent() {
  const params = useSearchParams();
  const reason = params.get('reason') || 'expired';

  const messages: Record<string, { icon: any; title: string; body: string }> = {
    expired: {
      icon: Clock,
      title: 'Scout Link Expired',
      body: "This scout link has expired. Please sign in to view today's story ideas.",
    },
    already_used: {
      icon: ShieldX,
      title: 'Link Already Used',
      body: 'This link has already been used to create a post. Each link can only be used once.',
    },
    invalid: {
      icon: ShieldX,
      title: 'Invalid Link',
      body: 'This link is no longer valid. Please sign in to access your stories.',
    },
    missing_token: {
      icon: ShieldX,
      title: 'Missing Link',
      body: 'No token was provided. Please use the link from your scout email.',
    },
  };

  const msg = messages[reason] || messages.expired;
  const Icon = msg.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Icon className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">{msg.title}</h1>
        <p className="text-slate-600 mb-6">{msg.body}</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          Sign In <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default function ScoutExpiredPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    }>
      <ExpiredContent />
    </Suspense>
  );
}
