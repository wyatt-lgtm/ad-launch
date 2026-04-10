export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * GET /api/publish/accounts — Proxy to Tombstone GET /social/accounts
 *
 * Used by the publishing dashboard for connected-accounts display.
 * Returns normalized account list without secrets.
 */
export async function GET() {
  try {
    const res = await fetch(`${TOMBSTONE_URL}/social/accounts`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[publish/accounts] Tombstone returned ${res.status} — returning empty accounts`);
      // Gracefully degrade: return empty list so the UI renders the empty state
      return NextResponse.json({ accounts: [] });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    console.warn('[publish/accounts] Error:', e.message, '— returning empty accounts');
    // Gracefully degrade so the UI always renders
    return NextResponse.json({ accounts: [] });
  }
}
