export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/seo/page-briefs
 *
 * READ ONLY. Lists this business's SEO page briefs (target context, status, and
 * WF3 dispatch tracking) so the UI can render compact quality cards. Dispatched
 * briefs (wf3WorkflowId present) can then load detailed QA via the quality route.
 *
 * Security: authenticated session; business must be owned by the user (admins
 * may access any business). Strictly business-scoped — no cross-business data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
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
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const briefs = await prisma.seoPageBrief.findMany({
    where: { businessId: business.id },
    orderBy: [{ wf3DispatchedAt: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      targetPageType: true,
      recommendedSlug: true,
      recommendedMetaTitle: true,
      recommendedH1: true,
      status: true,
      wf3WorkflowId: true,
      wf3DispatchedAt: true,
      createdAt: true,
      updatedAt: true,
      metaAnalysis: { select: { targetKeyword: true, targetLocation: true, serviceLine: true } },
    },
  });

  return NextResponse.json({
    businessId: business.id,
    briefs: briefs.map((b) => ({
      id: b.id,
      targetPageType: b.targetPageType,
      recommendedSlug: b.recommendedSlug,
      recommendedMetaTitle: b.recommendedMetaTitle,
      recommendedH1: b.recommendedH1,
      status: b.status,
      workflowId: b.wf3WorkflowId,
      dispatched: !!b.wf3WorkflowId,
      dispatchedAt: b.wf3DispatchedAt,
      targetKeyword: b.metaAnalysis?.targetKeyword ?? null,
      targetLocation: b.metaAnalysis?.targetLocation ?? null,
      serviceLine: b.metaAnalysis?.serviceLine ?? null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
  });
}
