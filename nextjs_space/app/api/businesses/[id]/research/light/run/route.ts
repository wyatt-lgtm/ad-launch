export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { outputTypeFor } from '@/lib/research-tiers';

/**
 * POST /api/businesses/[id]/research/light/run
 * Records a Light Research pass (fast, shallow — powers the first 3 preview
 * posts). Light research NEVER overwrites deep research because it writes only
 * to its own depth row.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { websiteUrl: true },
  });

  const record = await prisma.businessResearch.create({
    data: {
      businessId,
      researchDepth: 'light',
      outputType: outputTypeFor('light'),
      researchStatus: 'queued',
      sourceUrl: business?.websiteUrl ?? null,
      createdByAgent: 'jim_bridger',
      isCurrent: true,
    } as any,
  });

  return NextResponse.json({ ok: true, research: record });
}
