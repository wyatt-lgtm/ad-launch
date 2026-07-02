/**
 * Backlink Inventory API (Milestone 10) — business-scoped.
 *
 * GET -> latest backlink inventory snapshot + its URL rows (or null when none).
 *        Never scrapes Google. Never deploys/publishes. Never leaks secrets or
 *        signed URLs — only the customer's own public URLs are returned.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness } from '@/lib/site-backlinks/api-guard';
import { loadLatestInventory } from '@/lib/site-backlinks/store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const inv = await loadLatestInventory(params.id);
  if (!inv) {
    return NextResponse.json({ inventoryId: null, inventory: null, urls: [] });
  }

  return NextResponse.json({
    inventoryId: inv.id,
    status: inv.status,
    source: inv.source,
    liveDomain: inv.liveDomain,
    crawledAt: inv.crawledAt,
    providerCheckedAt: inv.providerCheckedAt,
    providerMissing: inv.inventory?.providerMissing ?? (inv.status === 'incomplete_provider_missing'),
    totalBacklinkUrls: inv.totalBacklinkUrls,
    highValueUrlCount: inv.highValueUrlCount,
    warnings: inv.inventory?.warnings || [],
    createdAt: inv.createdAt,
    urls: inv.urls,
  });
}
