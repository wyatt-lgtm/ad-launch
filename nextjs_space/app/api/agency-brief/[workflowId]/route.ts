export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const TOMBSTONE_URL = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * GET /api/agency-brief/[workflowId]
 * 
 * Proxy to Tombstone's /workflows/{workflowId}/agency-brief endpoint.
 * Returns creative territories, scorecard, rationale, render contract data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { workflowId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const resp = await fetch(
      `${TOMBSTONE_URL}/workflows/${params.workflowId}/agency-brief`,
      { next: { revalidate: 0 } },
    );

    if (!resp.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch agency brief', status: resp.status },
        { status: resp.status },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[agency-brief] Error fetching from Tombstone:', err);
    return NextResponse.json(
      { error: 'Internal error fetching agency brief' },
      { status: 500 },
    );
  }
}
