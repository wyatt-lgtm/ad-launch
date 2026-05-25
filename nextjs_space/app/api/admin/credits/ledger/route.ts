export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { getCreditBalance, getTransactions } from '@/lib/credits';
import { getCostLedger } from '@/lib/cost-ledger';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/credits/ledger?businessId=...&view=credits|costs&limit=50&offset=0
 *
 * Admin-only: View credit balance, transaction history, or internal cost ledger.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const businessId = req.nextUrl.searchParams.get('businessId');
  const view = req.nextUrl.searchParams.get('view') || 'credits';
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50, 200);
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0') || 0;

  if (view === 'costs') {
    const result = await getCostLedger({ businessId: businessId || undefined, limit, offset });
    return NextResponse.json(result);
  }

  // Credits view
  if (!businessId) {
    // List all credit accounts
    const accounts = await prisma.creditAccount.findMany({
      include: { business: { select: { businessName: true, websiteUrl: true } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    });
    const total = await prisma.creditAccount.count();
    return NextResponse.json({ accounts, total });
  }

  const balance = await getCreditBalance(businessId);
  const txns = await getTransactions(businessId, { limit, offset });
  return NextResponse.json({ balance, ...txns });
}
