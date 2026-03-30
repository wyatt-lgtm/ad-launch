'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, AlertCircle, Search, Sparkles, FileCheck, Lock } from 'lucide-react';
import WatermarkCard from '../../../components/watermark-card';
import RegistrationModal from '../../../components/registration-modal';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const STEPS = [
  { key: 'analyzing', label: 'Analyzing your website', icon: Search },
  { key: 'generating', label: 'Generating your ads', icon: Sparkles },
  { key: 'finalizing', label: 'Finalizing results', icon: FileCheck },
];

interface Ad {
  id: string;
  imageUrl: string | null;
  watermarkedUrl: string | null;
  caption: string | null;
  headline: string | null;
}

export default function AnalysisTracker({ analysisId }: { analysisId: string }) {
  const [status, setStatus] = useState('processing');
  const [ads, setAds] = useState<Ad[]>([]);
  const [seoData, setSeoData] = useState<any>(null);
  const [postingPlan, setPostingPlan] = useState<any>(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const { data: session } = useSession() || {};
  const router = useRouter();

  const pollStatus = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await fetch(`/api/mission-status?analysisId=${analysisId}`);
      const data = await res.json().catch(() => ({}));
      const s = data?.status ?? 'processing';
      setStatus(s);

      if (s === 'processing') setCurrentStep(0);
      else if (s === 'generating') setCurrentStep(1);
      else if (s === 'completed') {
        setCurrentStep(2);
        if (data?.ads?.length) setAds(data.ads);
        if (data?.seoData) setSeoData(data.seoData);
        if (data?.postingPlan) setPostingPlan(data.postingPlan);
      } else if (s === 'error') {
        setError('Analysis failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  }, [analysisId]);

  // Use a ref to track status so the interval always sees the latest value
  const statusRef = React.useRef(status);
  statusRef.current = status;

  useEffect(() => {
    pollStatus();
    const interval = setInterval(() => {
      if (statusRef.current !== 'completed' && statusRef.current !== 'error') {
        pollStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  // If user is confirmed and analysis is complete, redirect to results
  useEffect(() => {
    if (status === 'completed' && (session?.user as any)?.confirmed) {
      router.push(`/results/${analysisId}`);
    }
  }, [status, session, analysisId, router]);

  if (error) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Analysis Failed</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        <a href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">
          Try Again
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      {/* Progress Steps */}
      <div className="max-w-lg mx-auto mb-16">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-8">
          {status === 'completed' ? 'Your Ads Are Ready!' : 'Analyzing Your Business...'}
        </h1>
        <div className="space-y-4">
          {STEPS.map((step, i) => {
            const StepIcon = step.icon;
            const isActive = i === currentStep && status !== 'completed';
            const isDone = i < currentStep || status === 'completed';
            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                  isActive ? 'bg-blue-50 border border-blue-200' : isDone ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isDone ? 'bg-green-500' : isActive ? 'bg-blue-600 animate-pulse-glow' : 'bg-gray-200'
                }`}>
                  {isDone ? <CheckCircle className="w-5 h-5 text-white" /> :
                   isActive ? <Loader2 className="w-5 h-5 text-white animate-spin" /> :
                   <StepIcon className="w-5 h-5 text-gray-400" />}
                </div>
                <span className={`font-medium ${
                  isDone ? 'text-green-700' : isActive ? 'text-blue-700' : 'text-gray-400'
                }`}>{step.label}</span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Results Preview */}
      {status === 'completed' && (ads?.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Your Generated Ads</h2>
            <p className="text-gray-500 text-sm">Register to download without watermarks</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {(ads ?? []).map((ad: Ad, i: number) => (
              <WatermarkCard
                key={ad?.id ?? i}
                caption={ad?.caption ?? null}
                headline={ad?.headline ?? null}
                imageUrl={ad?.imageUrl ?? ad?.watermarkedUrl ?? null}
                index={i}
              />
            ))}
          </div>

          {/* SEO & Posting Plan Previews */}
          <div className="grid md:grid-cols-2 gap-6 mb-10">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="text-center">
                  <Lock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-500">Register to unlock</p>
                </div>
              </div>
              <h3 className="font-bold text-gray-900 mb-3">SEO Insights</h3>
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-4 bg-gray-100 rounded w-full" />
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="text-center">
                  <Lock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-500">Register to unlock</p>
                </div>
              </div>
              <h3 className="font-bold text-gray-900 mb-3">90-Day Posting Plan</h3>
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-4 bg-gray-100 rounded w-full" />
                ))}
              </div>
            </div>
          </div>

          {/* Register CTA */}
          <div className="text-center">
            <button
              onClick={() => setShowRegister(true)}
              className="px-8 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl"
            >
              Register to Download Free
            </button>
            <p className="text-sm text-gray-400 mt-3">Business email required · No credit card needed</p>
          </div>
        </motion.div>
      )}

      {/* Demo fallback for when no ads from API */}
      {status === 'completed' && (ads?.length ?? 0) === 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Analysis Complete</h2>
            <p className="text-gray-500 text-sm">Your ads are being prepared. Register to be notified when they&apos;re ready.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {[0, 1, 2].map((i) => (
              <WatermarkCard key={i} caption={null} headline={null} imageUrl={null} index={i} />
            ))}
          </div>
          <button
            onClick={() => setShowRegister(true)}
            className="px-8 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg"
          >
            Register to Download Free
          </button>
        </motion.div>
      )}

      <RegistrationModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        analysisId={analysisId}
      />
    </div>
  );
}
