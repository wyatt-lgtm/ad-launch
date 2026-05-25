export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { closeAccountCreditWindow } from '@/lib/credits';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const body = await req.json();
    const { businessId } = body;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    await closeAccountCreditWindow(businessId);
    return NextResponse.json({ success: true, message: 'Account closure credit window set (30 days).' });
  } catch (err: any) {
    console.error('[admin/credits/close-account-credit-window] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to close account credit window' }, { status: 500 });
  }
}
