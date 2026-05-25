export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getTransactions } from '@/lib/credits';

/**
 * GET /api/credits/transactions?businessId=...&limit=50&offset=0&type=...
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });

  // Verify ownership
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId: user.id },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50, 100);
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0') || 0;
  const type = req.nextUrl.searchParams.get('type') || undefined;

  const result = await getTransactions(businessId, { limit, offset, type });
  return NextResponse.json(result);
}
