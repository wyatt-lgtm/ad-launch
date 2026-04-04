'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle, AlertCircle, Search, Sparkles, FileCheck,
  Lock, Clock, CircleDot, XCircle,
} from 'lucide-react';
import WatermarkCard from '../../../components/watermark-card';
import SeoInsights from '../../../components/seo-insights';
import PostingPlan from '../../../components/posting-plan';
import GoogleAdsCopy from '../../../components/google-ads-copy';
import WebsiteConcept from '../../../components/website-concept';
import BudgetRecommendations from '../../../components/budget-recommendations';
import RegistrationModal from '../../../components/registration-modal';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface TaskItem {
  id: number;
  workflowId: string;
  department: string;
  label: string;
  description: string;
  status: 'waiting' | 'active' | 'complete' | 'error';
  rawStatus: string;
}

interface Ad {
  id: string;
  imageUrl: string | null;
  watermarkedUrl: string | null;
  caption: string | null;
  headline: string | null;
}

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'active':
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    case 'error':
      return <XCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Clock className="w-5 h-5 text-gray-300" />;
  }
}

function TaskRow({ task, index }: { task: TaskItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
        task.status === 'active'
          ? 'bg-blue-50 border border-blue-200'
          : task.status === 'complete'
          ? 'bg-green-50/50 border border-green-100'
          : task.status === 'error'
          ? 'bg-red-50 border border-red-100'
          : 'bg-gray-50 border border-gray-100'
      }`}
    >
      <TaskStatusIcon status={task.status} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${
          task.status === 'active' ? 'text-blue-700'
          : task.status === 'complete' ? 'text-green-700'
          : task.status === 'error' ? 'text-red-600'
          : 'text-gray-400'
        }`}>
          {task.label}
        </div>
        {task.status === 'active' && task.description && (
          <div className="text-xs text-blue-500 mt-0.5">{task.description}</div>
        )}
      </div>
      {task.status === 'active' && (
        <span className="text-xs text-blue-500 font-medium animate-pulse">Working...</span>
      )}
    </motion.div>
  );
}

export default function AnalysisTracker({ analysisId }: { analysisId: string }) {
  const [status, setStatus] = useState('processing');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [seoData, setSeoData] = useState<any>(null);
  const [postingPlan, setPostingPlan] = useState<any>(null);
  const [googleAdsData, setGoogleAdsData] = useState<any>(null);
  const [websiteConceptData, setWebsiteConceptData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const { data: session } = useSession() || {};
  const router = useRouter();

  const pollStatus = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await fetch(`/api/mission-status?analysisId=${analysisId}`);
      const data = await res.json().catch(() => ({}));
      const s = data?.status ?? 'processing';
      setStatus(s);

      // Update live task list
      if (data?.tasks?.length > 0) {
        setTasks(data.tasks);
      }

      if (s === 'completed') {
        if (data?.ads?.length) setAds(data.ads);
        if (data?.seoData) setSeoData(data.seoData);
        if (data?.postingPlan) setPostingPlan(data.postingPlan);
        if (data?.googleAdsData) setGoogleAdsData(data.googleAdsData);
        if (data?.websiteConceptData) setWebsiteConceptData(data.websiteConceptData);
        if (data?.budgetData) setBudgetData(data.budgetData);
      } else if (s === 'error') {
        setError(data?.errorReason ?? 'Analysis failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  }, [analysisId]);

  const statusRef = React.useRef(status);
  statusRef.current = status;

  useEffect(() => {
    pollStatus();
    const interval = setInterval(() => {
      if (statusRef.current !== 'completed' && statusRef.current !== 'error') {
        pollStatus();
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  // If user is confirmed and analysis is complete, redirect to results
  useEffect(() => {
    if (status === 'completed' && (session?.user as any)?.confirmed) {
      router.push(`/results/${analysisId}`);
    }
  }, [status, session, analysisId, router]);

  // Deduplicate tasks by department per workflow for cleaner display
  const displayTasks = React.useMemo(() => {
    if (tasks.length === 0) return [];
    // Group by department, show highest-priority status
    const byDept = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      const key = t.label;
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(t);
    }
    // For each department, show aggregated status
    const result: TaskItem[] = [];
    const deptOrder = ['Business Analysis', 'Marketing Strategy', 'Ad Copywriting', 'Visual Direction', 'Image Generation', 'Final Composition'];
    for (const dept of deptOrder) {
      const items = byDept.get(dept);
      if (!items || items.length === 0) continue;
      const hasActive = items.some(i => i.status === 'active');
      const allComplete = items.every(i => i.status === 'complete');
      const hasError = items.some(i => i.status === 'error');
      const completeCount = items.filter(i => i.status === 'complete').length;
      result.push({
        ...items[0],
        status: hasActive ? 'active' : allComplete ? 'complete' : hasError ? 'error' : 'waiting',
        description: items.length > 1
          ? `${items[0].description} (${completeCount}/${items.length} complete)`
          : items[0].description,
      });
    }
    return result;
  }, [tasks]);

  // Progress percentage
  const progress = React.useMemo(() => {
    if (displayTasks.length === 0) return 0;
    const complete = displayTasks.filter(t => t.status === 'complete').length;
    return Math.round((complete / displayTasks.length) * 100);
  }, [displayTasks]);

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

  const isGenerating = status !== 'completed';

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {isGenerating ? 'Creating Your Ads...' : 'Your Results Are Ready!'}
        </h1>
        <p className="text-gray-500 mt-2 text-sm">
          {isGenerating
            ? 'Our AI agents are analyzing your business and crafting 3 unique ads'
            : 'Register with your business email to download without watermarks'}
        </p>
      </div>

      {/* Live Task Tracker */}
      {isGenerating && (
        <div className="max-w-lg mx-auto mb-12">
          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Progress</span>
              <span className="text-sm font-bold text-blue-600">{progress}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Task list */}
          {displayTasks.length > 0 ? (
            <div className="space-y-2">
              {displayTasks.map((task, i) => (
                <TaskRow key={`${task.label}-${i}`} task={task} index={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Placeholder skeleton while tasks load */}
              {['Connecting to AI agents...', 'Preparing analysis pipeline...'].map((text, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  <span className="text-sm font-medium text-blue-700">{text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Generating 3 ads badge */}
          <div className="mt-6 text-center">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              Generating 3 unique ad variations
            </span>
          </div>
        </div>
      )}

      {/* Completed: Show all tasks as done */}
      {!isGenerating && displayTasks.length > 0 && (
        <div className="max-w-lg mx-auto mb-8">
          <div className="space-y-1">
            {displayTasks.map((task, i) => (
              <TaskRow key={`${task.label}-${i}`} task={{ ...task, status: 'complete' }} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Results: Ads */}
      {!isGenerating && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {/* Ads Section */}
          <div className="mb-12">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Your 3 Generated Ads</h2>
              <p className="text-gray-500 text-sm mt-1">Each targets a different marketing angle for maximum impact</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {(ads.length > 0 ? ads : [null, null, null]).map((ad: any, i: number) => (
                <WatermarkCard
                  key={ad?.id ?? i}
                  caption={ad?.caption ?? null}
                  headline={ad?.headline ?? null}
                  imageUrl={ad?.imageUrl ?? ad?.watermarkedUrl ?? null}
                  index={i}
                  angle={i === 0 ? 'Awareness' : i === 1 ? 'Conversion' : 'Trust'}
                  editable={ads.length > 0}
                />
              ))}
            </div>
          </div>

          {/* Google Search Ad Copy */}
          <div className="mb-12">
            <GoogleAdsCopy data={googleAdsData} locked={false} />
          </div>

          {/* SEO Insights */}
          <div className="mb-12">
            <SeoInsights data={seoData} locked={false} />
          </div>

          {/* Website Concept */}
          <div className="mb-12">
            <WebsiteConcept data={websiteConceptData} locked={false} />
          </div>

          {/* 90-Day Posting Plan */}
          <div className="mb-12">
            <PostingPlan data={postingPlan} locked={false} />
          </div>

          {/* Budget Recommendations */}
          <div className="mb-12">
            <BudgetRecommendations data={budgetData} locked={false} />
          </div>

          {/* Register CTA */}
          <div className="text-center py-8">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 max-w-xl mx-auto text-white">
              <h3 className="text-2xl font-bold mb-3">Download Your Ads Without Watermarks</h3>
              <p className="text-blue-100 mb-6">Register with your business email to get all 3 ads in full resolution, ready to post.</p>
              <button
                onClick={() => setShowRegister(true)}
                className="px-8 py-4 bg-white text-blue-600 rounded-xl font-bold text-lg hover:bg-blue-50 transition-all shadow-lg"
              >
                Register to Download Free
              </button>
              <p className="text-blue-200 text-xs mt-4">Business email required · No credit card needed</p>
            </div>
          </div>
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
