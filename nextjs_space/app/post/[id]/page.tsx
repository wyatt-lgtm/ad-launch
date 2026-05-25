'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Download, Copy, Check, ExternalLink, ThumbsDown, BookmarkPlus,
  CheckCircle2, Loader2, AlertCircle, ArrowRight, Video, Coins,
} from 'lucide-react';

interface PostPackageData {
  id: string;
  status: string;
  source: string;
  postCopy: string;
  headline: string;
  cta: string;
  hashtags: string[];
  imageUrl: string;
  storyTitle: string;
  storySource: string;
  storyUrl: string;
  storySummary: string;
  suggestedAngle: string;
  businessName: string;
  websiteUrl: string;
  completedAt: string | null;
  createdAt: string;
}

export default function PostPackagePage() {
  const params = useParams();
  const packageId = params.id as string;
  const [pkg, setPkg] = useState<PostPackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/post-package/${packageId}`);
        if (!res.ok) {
          setError(res.status === 401 ? 'Please sign in to view this post.' : 'Post not found.');
          return;
        }
        setPkg(await res.json());
      } catch {
        setError('Failed to load post.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [packageId]);

  const handleCopyText = async () => {
    if (!pkg) return;
    const text = [pkg.postCopy, pkg.hashtags?.length ? pkg.hashtags.join(' ') : ''].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/post-package/${packageId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success && pkg) {
        setPkg({ ...pkg, status: data.status });
      }
    } catch { /* ignore */ }
    setActionLoading('');
  };

  const handleDownloadImage = () => {
    if (!pkg?.imageUrl) return;
    const a = document.createElement('a');
    a.href = pkg.imageUrl;
    a.download = `ad-launch-post-${packageId.slice(0, 8)}.png`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadPackage = () => {
    const a = document.createElement('a');
    a.href = `/api/post-package/${packageId}/download`;
    a.download = `ad-launch-post-${packageId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">{error || 'Post not found'}</h1>
          <Link href="/login" className="inline-flex items-center gap-2 text-blue-600 font-medium mt-4 hover:underline">
            Sign In <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (pkg.status === 'generating') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Post Still Generating</h1>
          <p className="text-slate-600">We&apos;ll email you when it&apos;s ready. Check back soon!</p>
        </div>
      </div>
    );
  }

  const statusBadge = {
    ready: { color: 'bg-green-100 text-green-700', label: 'Ready' },
    downloaded: { color: 'bg-blue-100 text-blue-700', label: 'Downloaded' },
    draft: { color: 'bg-amber-100 text-amber-700', label: 'Saved as Draft' },
    rejected: { color: 'bg-red-100 text-red-700', label: 'Rejected' },
    posted: { color: 'bg-emerald-100 text-emerald-700', label: 'Manually Posted' },
  }[pkg.status] || { color: 'bg-slate-100 text-slate-700', label: pkg.status };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Post Package</h1>
            <p className="text-slate-500 text-sm mt-1">{pkg.businessName}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge.color}`}>
            {statusBadge.label}
          </span>
        </div>

        {/* Story source */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Source Story</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">{pkg.storyTitle}</h2>
          <div className="text-sm text-slate-500 mb-2">{pkg.storySource}</div>
          {pkg.storyUrl && (
            <a href={pkg.storyUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
              View original <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Post content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Post Content</div>
          {pkg.headline && (
            <div className="text-lg font-bold text-slate-900 mb-3">{pkg.headline}</div>
          )}
          <div className="text-slate-700 whitespace-pre-line leading-relaxed mb-4">
            {pkg.postCopy || 'No post copy available yet.'}
          </div>
          {pkg.hashtags?.length > 0 && (
            <div className="text-blue-600 text-sm font-medium">{pkg.hashtags.join(' ')}</div>
          )}
        </div>

        {/* Image */}
        {pkg.imageUrl && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Post Image</div>
            <div className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden">
              <Image src={pkg.imageUrl} alt="Post image" fill className="object-contain" unoptimized />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Actions</div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleCopyText}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Post Text'}
            </button>

            {pkg.imageUrl && (
              <button
                onClick={handleDownloadImage}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition"
              >
                <Download className="w-4 h-4" /> Download Image
              </button>
            )}

            <button
              onClick={handleDownloadPackage}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-600 transition"
            >
              <Download className="w-4 h-4" /> Download Package
            </button>

            {pkg.status !== 'draft' && pkg.status !== 'rejected' && pkg.status !== 'posted' && (
              <button
                onClick={() => handleAction('save_draft')}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition disabled:opacity-50"
              >
                <BookmarkPlus className="w-4 h-4" />
                {actionLoading === 'save_draft' ? 'Saving...' : 'Save Draft'}
              </button>
            )}

            {pkg.status !== 'rejected' && pkg.status !== 'posted' && (
              <button
                onClick={() => handleAction('reject')}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition disabled:opacity-50"
              >
                <ThumbsDown className="w-4 h-4" />
                {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            )}

            {pkg.status !== 'posted' && pkg.status !== 'rejected' && (
              <button
                onClick={() => handleAction('mark_posted')}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 border border-green-200 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {actionLoading === 'mark_posted' ? 'Marking...' : 'Mark as Manually Posted'}
              </button>
            )}
          </div>
        </div>

        {/* Video Upsell Placeholder */}
        {(pkg.status === 'ready' || pkg.status === 'downloaded' || pkg.status === 'draft' || pkg.status === 'posted') && (
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <Video className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-indigo-900">Love this post? Upgrade it to video.</h3>
                <p className="text-xs text-indigo-600 mt-1">Turn your static post into an eye-catching video for social media.</p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-indigo-500">
                  <Coins className="w-3 h-3" />
                  Video upgrade uses 3 credits
                </div>
                <button
                  disabled
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-indigo-200 text-indigo-500 rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  <Video className="w-4 h-4" />
                  Coming Soon
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-center mt-6">
          <Link href="/dashboard/social" className="text-blue-600 hover:underline text-sm font-medium">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
