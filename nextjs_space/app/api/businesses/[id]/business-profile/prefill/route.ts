import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { buildBusinessProfileInterviewPrefill } from '@/lib/interview-prefill';

export const dynamic = 'force-dynamic';

/**
 * GET /api/businesses/[id]/business-profile/prefill
 * Returns prefilled interview data from all available sources.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const businessId = params.id;

    // Verify ownership
    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true },
    });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const prefill = await buildBusinessProfileInterviewPrefill(businessId);
    return NextResponse.json(prefill);
  } catch (err: any) {
    console.error('[prefill] Error:', err);
    return NextResponse.json({ error: 'Failed to build prefill data' }, { status: 500 });
  }
}
