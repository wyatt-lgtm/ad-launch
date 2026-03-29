export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params ?? {};
    if (!id) {
      return NextResponse.json({ error: 'Analysis ID required' }, { status: 400 });
    }
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { ads: true, user: { select: { email: true, confirmed: true } } },
    });
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    return NextResponse.json({ analysis });
  } catch (err: any) {
    console.error('Get analysis error:', err);
    return NextResponse.json({ error: 'Failed to load analysis' }, { status: 500 });
  }
}
