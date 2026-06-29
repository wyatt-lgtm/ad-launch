export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { fetchWf3Quality } from '@/lib/wf3-quality';

/**
 * GET /api/businesses/[id]/website/workflows/[workflowId]/quality
 *
 * READ ONLY. Returns the normalized WF3 quality/QA report for a dispatched
 * Website-SEO workflow so the UI can show why a page passed/failed QA, whether
 * it is publish-ready, and the required fixes — without exposing raw task JSON.
 *
 * Security:
 *  - Requires an authenticated session.
 *  - Business [id] must be owned by the user (admins may access any business).
 *  - The workflow must be one this business actually dispatched (a SeoPageBrief
 *    in this business must carry wf3WorkflowId === workflowId). This prevents
 *    cross-business enumeration of arbitrary workflow ids.
 *  - Defense in depth: the business_id returned by Tombstone must equal this
 *    business's tombstoneBusinessId, else 403 (no cross-business leakage).
 *  - This route never mutates anything and never triggers publishing.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; workflowId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: params.id } : { id: params.id, userId: user.id },
    select: { id: true, tombstoneBusinessId: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // The workflow must have been dispatched from a brief belonging to this business.
  const brief = await prisma.seoPageBrief.findFirst({
    where: { businessId: business.id, wf3WorkflowId: params.workflowId },
    select: {
      id: true,
      targetPageType: true,
      recommendedSlug: true,
      status: true,
      wf3DispatchedAt: true,
      metaAnalysis: { select: { targetKeyword: true, targetLocation: true } },
    },
  });
  if (!brief) {
    return NextResponse.json(
      { error: 'Workflow not found for this business' },
      { status: 404 },
    );
  }

  const report = await fetchWf3Quality(params.workflowId);

  // Defense in depth against cross-business leakage: if Tombstone reports a
  // business_id that does not match this business, refuse to return the data.
  if (
    report.found &&
    report.businessId != null &&
    business.tombstoneBusinessId != null &&
    report.businessId !== business.tombstoneBusinessId
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Enrich with Launch-OS-side brief context (authoritative for target fields).
  if (!report.recommendedSlug && brief.recommendedSlug) report.recommendedSlug = brief.recommendedSlug;
  if (!report.pageType && brief.targetPageType) report.pageType = brief.targetPageType;
  if (!report.targetKeyword && brief.metaAnalysis?.targetKeyword) report.targetKeyword = brief.metaAnalysis.targetKeyword;
  if (!report.targetLocation && brief.metaAnalysis?.targetLocation) report.targetLocation = brief.metaAnalysis.targetLocation;

  return NextResponse.json({
    businessId: business.id,
    briefId: brief.id,
    briefStatus: brief.status,
    dispatchedAt: brief.wf3DispatchedAt,
    quality: report,
  });
}
