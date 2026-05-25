export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getWeeklyTipSuggestions } from '@/lib/content-profile';

/**
 * GET /api/businesses/[id]/weekly-tip-suggestions?category=...
 *
 * Returns suggested weekly tip topics based on the business content profile,
 * industry, audience, service area, and current season.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const category = req.nextUrl.searchParams.get('category') || undefined;
  const suggestions = await getWeeklyTipSuggestions(params.id, category);

  return NextResponse.json({ suggestions });
}
