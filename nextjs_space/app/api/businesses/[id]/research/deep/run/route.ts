export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/tracking-auth';
import { canRunDeepResearch, outputTypeFor } from '@/lib/research-tiers';

/**
 * POST /api/businesses/[id]/research/deep/run
 * Queues Deep Research. Only allowed AFTER registration / business claim and
 * advertiser identity lock. We create a durable BusinessResearch (deep, queued)
 * record; the Bridger agent (Tombstone backend) executes the crawl. We never
 * mutate Tombstone task state or bypass its lifecycle here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveBusinessAccess(req, params.id);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const businessId = r.business.id;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { userId: true, tombstoneBusinessId: true, websiteUrl: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const gate = canRunDeepResearch(business);
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const depth = body.refresh ? 'refresh' : 'deep';

  const record = await prisma.businessResearch.create({
    data: {
      businessId,
      researchDepth: depth,
      outputType: outputTypeFor(depth as any),
      researchStatus: 'queued',
      sourceUrl: business.websiteUrl,
      createdByAgent: 'jim_bridger',
      isCurrent: true,
    } as any,
  });

  return NextResponse.json({ ok: true, research: record });
}
