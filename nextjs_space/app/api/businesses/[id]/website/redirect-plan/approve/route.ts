/**
 * Redirect Plan — approve (Milestone 10). business-scoped.
 *
 * POST -> approve the redirect plan (mark all proposed mappings approved). This
 *         is a READINESS decision ONLY — it does NOT deploy redirects, publish
 *         a site, or mutate live DNS.
 *
 * Body: { sitemapId?: string }
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness, rejectDeployIntent } from '@/lib/site-backlinks/api-guard';
import { approveRedirectPlan, loadRedirectPlan } from '@/lib/site-backlinks/store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const body = await req.json().catch(() => ({} as any));
  const deployReject = rejectDeployIntent(body);
  if (deployReject) return deployReject;

  const sitemapId = (body?.sitemapId as string) || null;
  const res = await approveRedirectPlan({
    businessId: params.id,
    sitemapId,
    approvedByUserId: guard.access.user.id,
  });

  const plan = await loadRedirectPlan(params.id, null, sitemapId);
  return NextResponse.json({
    approved: res.approved,
    plan: plan || null,
  });
}
