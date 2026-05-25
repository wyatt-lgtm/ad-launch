export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { prisma } from '@/lib/db';
import { grantMonthlyCredits } from '@/lib/credits';

/**
 * POST /api/admin/credits/grant-monthly
 * Body: { businessId? }
 *
 * If businessId is provided, grant monthly credits to that business only.
 * If no businessId, grant to ALL businesses with active credit accounts.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json().catch(() => ({} as any));
  const { businessId } = body;

  if (businessId) {
    const result = await grantMonthlyCredits(businessId);
    return NextResponse.json(result);
  }

  // Grant to all active accounts
  const accounts = await prisma.creditAccount.findMany({
    where: { creditStatus: 'active' },
    select: { businessId: true },
  });

  const results: { businessId: string; success: boolean; balanceAfter: number; alreadyGranted?: boolean }[] = [];

  for (const acct of accounts) {
    const result = await grantMonthlyCredits(acct.businessId);
    results.push({
      businessId: acct.businessId,
      success: result.success,
      balanceAfter: result.balanceAfter,
      alreadyGranted: result.alreadyCharged,
    });
  }

  return NextResponse.json({
    accountsProcessed: results.length,
    results,
  });
}
