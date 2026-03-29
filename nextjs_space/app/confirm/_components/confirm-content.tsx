'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { signIn } from 'next-auth/react';

export default function ConfirmContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No confirmation token provided');
      return;
    }
    const confirm = async () => {
      try {
        const res = await fetch(`/api/confirm-email?token=${token}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          setStatus('success');
          setTimeout(() => {
            router.push('/dashboard');
          }, 3000);
        } else {
          setStatus('error');
          setError(data?.error ?? 'Confirmation failed');
        }
      } catch (err: any) {
        console.error('Confirm error:', err);
        setStatus('error');
        setError('Something went wrong');
      }
    };
    confirm();
  }, [token, router]);

  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center">
      {status === 'loading' && (
        <div>
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Confirming Your Email...</h2>
          <p className="text-gray-500">Please wait a moment.</p>
        </div>
      )}
      {status === 'success' && (
        <div>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Confirmed!</h2>
          <p className="text-gray-600 mb-4">Your account is verified. Redirecting to your dashboard...</p>
        </div>
      )}
      {status === 'error' && (
        <div>
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirmation Failed</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <a href="/" className="inline-flex px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">
            Back to Home
          </a>
        </div>
      )}
    </div>
  );
}
