'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Mail, Lock, Loader2, AlertCircle, Rocket, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetBanner, setShowResetBanner] = useState(false);
  const router = useRouter();

  // Forgot-password inline state
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setShowResetBanner(false);
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError('Invalid email or password');
        setShowResetBanner(true);
      } else {
        router.replace('/dashboard');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError('Something went wrong');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first');
      return;
    }
    setForgotLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      await res.json();
      setForgotSent(true);
      setShowResetBanner(false);
    } catch {
      setError('Could not send reset email. Please try again.');
    }
    setForgotLoading(false);
  };

  return (
    <div className="w-full max-w-md px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Rocket className="w-7 h-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome Back</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access your dashboard</p>
        </div>

        {forgotSent && (
          <div className="flex items-start gap-2.5 text-emerald-700 text-sm bg-emerald-50 p-3.5 rounded-lg mb-4">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Reset link sent!</p>
              <p className="text-emerald-600 text-xs mt-0.5">Check your inbox for a password reset link. It expires in 1 hour.</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); setShowResetBanner(false); setForgotSent(false); }}
                placeholder="you@company.com"
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <button
                type="button"
                onClick={() => {
                  if (email) { handleForgotPassword(); }
                  else { setForgotMode(true); setError('Enter your email address first'); }
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); setShowResetBanner(false); }}
                placeholder="Enter your password"
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          {/* Show reset password prompt after failed login */}
          {showResetBanner && !forgotSent && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5">
              <p className="text-sm text-amber-800 mb-2">Can't remember your password?</p>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={forgotLoading || !email}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50 flex items-center gap-1.5"
              >
                {forgotLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {forgotLoading ? 'Sending...' : 'Send password reset link'}
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
