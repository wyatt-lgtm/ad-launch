export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { runIndustryMatchAndPrepopulate, prepopulateServicesFromIndustry } from '@/lib/industry-services';

/**
 * POST /api/businesses/[id]/services/match-industry
 *
 * Two modes:
 *  - { industryId, ownerConfirmed: true } — owner explicitly sets the industry
 *    (owner-confirmed wins; re-prepopulates from that industry).
 *  - { autoMatch: true } — run Jim Bridger matching from saved analysis.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: user.role === 'admin' ? { id: params.id } : { id: params.id, userId: user.id },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Owner explicitly chooses industry
  if (body.industryId) {
    const industry = await prisma.industry.findUnique({ where: { id: body.industryId } });
    if (!industry) return NextResponse.json({ error: 'Industry not found' }, { status: 404 });

    await prisma.business.update({
      where: { id: business.id },
      data: {
        matchedIndustryId: industry.id,
        matchedIndustryConfidence: 'high',
        industryMatchSource: 'owner_confirmed',
        ownerConfirmedIndustry: true,
        industryMatchedAt: new Date(),
      },
    });

    const savedAnalysis = business.savedAnalysis as any;
    const result = await prepopulateServicesFromIndustry(business.id, industry.id, savedAnalysis);
    return NextResponse.json({ ok: true, industry: { id: industry.id, name: industry.name }, ...result });
  }

  // Auto-match from saved Jim Bridger analysis
  const savedAnalysis = business.savedAnalysis as any;
  if (!savedAnalysis) {
    return NextResponse.json({ error: 'No Jim Bridger research available yet for this business' }, { status: 400 });
  }
  const match = await runIndustryMatchAndPrepopulate(business.id, savedAnalysis);
  if (!match) return NextResponse.json({ error: 'Could not match an industry from current research' }, { status: 422 });
  return NextResponse.json({ ok: true, match });
}
