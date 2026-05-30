'use client';

import { AlertTriangle } from 'lucide-react';

interface BusinessMismatchBannerProps {
  currentBusinessName: string;
  mismatchEntity: string; // e.g. "this workflow", "this post"
  mismatchBusinessName: string;
}

/**
 * Red warning banner shown when a post/workflow/queue item belongs to a different
 * business than the currently selected one.
 */
export function BusinessMismatchBanner({
  currentBusinessName,
  mismatchEntity,
  mismatchBusinessName,
}: BusinessMismatchBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3 mb-4">
      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-red-800">Business identity mismatch detected</p>
        <p className="text-red-700 mt-0.5">
          Current Business is <strong>{currentBusinessName}</strong>, but {mismatchEntity} references{' '}
          <strong>{mismatchBusinessName}</strong> as advertiser.
        </p>
      </div>
    </div>
  );
}

/**
 * Check if a post's business matches the currently selected business.
 */
export function detectBusinessMismatch(
  currentBusinessId: string | null | undefined,
  postBusinessId: string | null | undefined,
): boolean {
  if (!currentBusinessId || !postBusinessId) return false;
  return currentBusinessId !== postBusinessId;
}
