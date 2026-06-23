export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * POST /api/concept-direction-select
 *
 * Persists the customer's website direction selection for a given analysis.
 * Body: { analysisId, workflowId, directionName, selectedBy, selectedAt }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysisId, workflowId, directionName, selectedBy, selectedAt } = body;

    if (!analysisId || !directionName) {
      return NextResponse.json({ error: 'analysisId and directionName are required' }, { status: 400 });
    }

    // Update the analysis record with the direction selection
    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const existingResults = (analysis.results ?? {}) as Record<string, any>;
    const updatedResults = {
      ...existingResults,
      websiteDirectionSelection: {
        directionName,
        selectedBy: selectedBy || 'customer',
        selectedAt: selectedAt || new Date().toISOString(),
        workflowId: workflowId || null,
        autoSelectDeadline: null, // timer expired or customer picked
      },
    };

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { results: updatedResults as any },
    });

    console.log(`[concept-direction-select] Direction selected: "${directionName}" by ${selectedBy} for analysis ${analysisId}`);

    return NextResponse.json({ success: true, directionName, selectedBy });
  } catch (err: any) {
    console.error('[concept-direction-select] Error:', err?.message);
    return NextResponse.json({ error: 'Failed to save direction selection' }, { status: 500 });
  }
}
