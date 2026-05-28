export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/concept-website-state?analysisId=...
 * Returns the saved concept website workflow info for an analysis.
 *
 * POST /api/concept-website-state
 * Saves concept website workflow info to the analysis results.
 */
export async function GET(request: NextRequest) {
  try {
    const analysisId = new URL(request.url).searchParams.get('analysisId');
    if (!analysisId) return NextResponse.json({ error: 'analysisId required' }, { status: 400 });

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { results: true },
    });
    if (!analysis) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const results = (analysis.results as any) ?? {};
    const cw = results.conceptWebsiteWorkflow ?? null;
    return NextResponse.json({ conceptWebsiteWorkflow: cw });
  } catch (err: any) {
    console.error('[concept-website-state] GET error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { analysisId, workflowId, finalTaskId } = await request.json();
    if (!analysisId || !workflowId) {
      return NextResponse.json({ error: 'analysisId and workflowId required' }, { status: 400 });
    }

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { results: true },
    });
    if (!analysis) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const results = (analysis.results as any) ?? {};
    results.conceptWebsiteWorkflow = { workflowId, finalTaskId, savedAt: new Date().toISOString() };

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { results },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[concept-website-state] POST error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
