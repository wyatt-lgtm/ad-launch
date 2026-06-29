export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { dispatchApprovedPageBrief } from '@/lib/tombstone';

/**
 * POST /api/seo/page-brief/[id]/dispatch
 *
 * Dispatches an APPROVED SeoPageBrief into the Tombstone website SEO page
 * workflow (WF3). The brief must be in status "approved" — enforced here as the
 * research gate (no auto-publish from un-approved briefs).
 *
 * The approved brief is mapped to the Tombstone page_brief contract and sent to
 * POST {TOMBSTONE_API_URL}/seo/page-workflow. Tombstone embeds it into the WF3
 * task execution_notes so the pipeline agents (Rand brief / Ogilvy draft /
 * Tom Hopkins conversion) consume it directly. No Tombstone agent touches this
 * application's database — the brief travels entirely inside the HTTP payload.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const briefId = params.id;
  const body = await req.json().catch(() => ({} as any));

  const brief = await prisma.seoPageBrief.findUnique({
    where: { id: briefId },
    include: { metaAnalysis: true, business: { select: { tombstoneBusinessId: true } } },
  });

  if (!brief) {
    return NextResponse.json({ error: 'Page brief not found' }, { status: 404 });
  }

  // Research gate: only approved briefs can drive page generation.
  if (brief.status !== 'approved') {
    return NextResponse.json(
      { error: `Page brief must be approved before dispatch (current status: ${brief.status})` },
      { status: 409 },
    );
  }

  const tombstoneBusinessId = brief.business?.tombstoneBusinessId ?? null;
  if (tombstoneBusinessId == null) {
    return NextResponse.json(
      { error: 'Business is not linked to a Tombstone business id; run the pipeline launch first.' },
      { status: 409 },
    );
  }

  const result = await dispatchApprovedPageBrief(
    {
      id: brief.id,
      targetPageType: brief.targetPageType,
      recommendedSlug: brief.recommendedSlug,
      recommendedMetaTitle: brief.recommendedMetaTitle,
      recommendedMetaDescription: brief.recommendedMetaDescription,
      recommendedH1: brief.recommendedH1,
      recommendedSectionsJson: brief.recommendedSectionsJson as any,
      recommendedFaqsJson: brief.recommendedFaqsJson as any,
      recommendedSchemaJson: brief.recommendedSchemaJson as any,
      differentiationAngle: brief.differentiationAngle,
      evidenceSummary: brief.evidenceSummary,
      metaAnalysis: brief.metaAnalysis
        ? {
            targetKeyword: brief.metaAnalysis.targetKeyword,
            targetLocation: brief.metaAnalysis.targetLocation,
            serviceLine: brief.metaAnalysis.serviceLine,
          }
        : null,
      primaryKeyword: body?.primaryKeyword ?? null,
      secondaryKeywords: Array.isArray(body?.secondaryKeywords) ? body.secondaryKeywords : null,
      searchIntent: body?.searchIntent ?? null,
      funnelStage: body?.funnelStage ?? null,
    },
    {
      tombstoneBusinessId,
      objective: body?.objective,
      sourceType: body?.sourceType ?? 'website_generation',
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Failed to dispatch page brief to workflow', detail: result.detail },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    briefId,
    workflowId: result.workflowId,
    usedApprovedBrief: result.usedApprovedBrief,
  });
}
