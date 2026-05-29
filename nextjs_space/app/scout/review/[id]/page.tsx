'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, AlertCircle, CheckCircle2, ArrowRight,
  MapPin, Building2, Globe, Sparkles, Coins,
} from 'lucide-react';
import CreditBadge from '@/app/components/credit-badge';

interface Story {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  sourceType: string;
  pubDate: string;
  summary: string;
  relevance: string;
  suggestedAngle: string;
}

interface ReportData {
  id: string;
  businessId: string;
  businessName: string;
  websiteUrl: string;
  status: string;
  sentAt: string;
  expiresAt: string;
  stories: Story[];
}

export default function ReviewStoriesPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = params.id as string;

  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/scout/report/${reportId}`);
        if (!res.ok) {
          setError(res.status === 401 ? 'Please sign in to review stories.' : 'Report not found.');
          return;
        }
        setReport(await res.json());
      } catch {
        setError('Failed to load report.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reportId]);

  const toggleStory = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || selected.size > 3) return;
    setSubmitting(true);
    setSubmitResult(null);

    try {
      const res = await fetch('/api/scout/create-posts-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoutReportId: reportId, storyIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setSubmitResult(data.error || 'Not enough credits.');
        if (typeof data.balance === 'number') setCreditBalance(data.balance);
      } else if (res.status === 409) {
        setSubmitResult(data.error || 'A post is already being created.');
      } else if (data.success) {
        setSubmitResult('success');
      } else {
        setSubmitResult(data.error || 'Failed to create posts.');
      }
    } catch {
      setSubmitResult('Failed to create posts.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">{error}</h1>
          <Link href="/login" className="inline-flex items-center gap-2 text-blue-600 font-medium mt-4 hover:underline">
            Sign In <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (submitResult === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Posts Are Being Created!</h1>
          <p className="text-slate-600 mb-6">
            We&apos;re generating {selected.size} post{selected.size > 1 ? 's' : ''} now.
            We&apos;ll email you when they&apos;re ready.
          </p>
          <Link href="/dashboard/social" className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  const typeIcon: Record<string, typeof MapPin> = {
    local: MapPin,
    industry: Building2,
    national: Globe,
  };

  const typeLabel: Record<string, string> = {
    local: 'Local',
    industry: 'Industry',
    national: 'National',
  };

  const grouped = {
    local: report.stories.filter(s => s.sourceType === 'local'),
    industry: report.stories.filter(s => s.sourceType === 'industry'),
    national: report.stories.filter(s => s.sourceType === 'national'),
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Review Stories</h1>
          <p className="text-slate-500 text-sm mt-1">
            Select up to 3 stories to create posts for {report.businessName}
          </p>
        </div>

        {selected.size > 3 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm font-medium">
            Maximum 3 stories can be selected. Please deselect some stories.
          </div>
        )}

        {submitResult && submitResult !== 'success' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-amber-700 text-sm font-medium">
            {submitResult}
          </div>
        )}

        {(['local', 'industry', 'national'] as const).map(type => {
          const stories = grouped[type];
          if (stories.length === 0) return null;
          const Icon = typeIcon[type] || Globe;
          return (
            <div key={type} className="mb-6">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4" /> {typeLabel[type]} Stories
              </h2>
              <div className="space-y-3">
                {stories.map(story => {
                  const isSelected = selected.has(story.id);
                  return (
                    <label
                      key={story.id}
                      className={`block bg-white rounded-xl border-2 p-4 cursor-pointer transition ${
                        isSelected ? 'border-blue-500 shadow-md' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleStory(story.id)}
                          className="mt-1 h-4 w-4 text-blue-600 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-900 text-sm">{story.title}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {story.source} {story.pubDate && `· ${story.pubDate.split('T')[0]}`}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">{story.summary}</div>
                          <div className="text-xs text-emerald-600 mt-1 font-medium flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> {story.suggestedAngle}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Submit bar */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 -mx-4 mt-8">
          {/* Credit info */}
          {report?.businessId && (
            <div className="flex items-center justify-between mb-3">
              <CreditBadge businessId={report.businessId} compact onBalanceLoaded={setCreditBalance} />
              {selected.size > 0 && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Coins className="w-3 h-3" /> Uses {selected.size} credit{selected.size !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
          {/* Credit enforcement suspended – CREDIT_ENFORCEMENT_ENABLED=false */}
          {false as boolean && creditBalance !== null && creditBalance < selected.size && selected.size > 0 && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              Not enough credits. You need {selected.size} but have {creditBalance}. Recharge coming soon.
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              {selected.size} of 3 selected
            </div>
            <button
              onClick={handleSubmit}
              disabled={selected.size === 0 || selected.size > 3 || submitting}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {submitting ? 'Creating...' : `Create ${selected.size} Post${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
