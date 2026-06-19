export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL || process.env.TOMBSTONE_URL || '';

/**
 * GET /api/competitor-analysis?workflowId=...
 *
 * Retrieves competitor analysis results (individual analyses + synthesis)
 * from the Tombstone backend for a given concept-website workflow.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }

    if (!TOMBSTONE_URL) {
      return NextResponse.json({ error: 'Tombstone URL not configured' }, { status: 503 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${TOMBSTONE_URL}/competitor-analysis/${encodeURIComponent(workflowId)}`, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return NextResponse.json(
          { error: data?.error || 'Failed to fetch competitor analysis' },
          { status: res.status },
        );
      }

      return NextResponse.json(data);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    console.error('[competitor-analysis] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to fetch competitor analysis' }, { status: 500 });
  }
}
