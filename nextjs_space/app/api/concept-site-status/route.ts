export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getConceptWebsiteStatus } from '@/lib/tombstone';

/**
 * GET /api/concept-site-status?workflowId=...&finalTaskId=...
 *
 * Polls Tombstone for concept-website workflow progress.
 * Returns step-by-step status and, when complete, the final HTML.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    const finalTaskId = searchParams.get('finalTaskId');

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }

    const result = await getConceptWebsiteStatus(
      workflowId,
      finalTaskId ? parseInt(finalTaskId, 10) : undefined,
    );

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[concept-site-status] Error:', err?.message);
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
