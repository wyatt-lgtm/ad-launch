export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { backfillStarterCredits, grantStarterCredits } from '@/lib/credits';

/**
 * POST /api/admin/credits/grant-starter
 *
 * Backfill starter credits for existing beta businesses.
 * - Admin-only
 * - Idempotent: can run multiple times safely
 * - Only grants to businesses missing starter-grant:{businessId}
 *
 * Body (optional): { businessId?: string }
 *   If businessId provided: grant only to that business
 *   If omitted: backfill ALL businesses
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  const body = await req.json().catch(() => ({} as any));
  const { businessId } = body;

  // Single business grant
  if (businessId) {
    const result = await grantStarterCredits(businessId, { userId: auth.userId });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      granted: result.alreadyCharged ? 0 : 1,
      skipped: result.alreadyCharged ? 1 : 0,
      errors: 0,
      details: [{
        businessId,
        status: result.alreadyCharged ? 'skipped' : 'granted',
        transactionId: result.transactionId,
        balanceAfter: result.balanceAfter,
      }],
    });
  }

  // Backfill all businesses
  const result = await backfillStarterCredits();
  return NextResponse.json(result);
}
