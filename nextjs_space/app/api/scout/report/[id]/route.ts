export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyMagicToken } from '@/lib/magic-token';

/**
 * GET /api/scout/report/[id]
 *
 * Returns a scout report with all stories. Auth via session or magic token.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let userId: string | null = null;

  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    userId = user?.id || null;
  }

  // Magic token fallback
  if (!userId) {
    const token = req.nextUrl.searchParams.get('token');
    if (token) {
      const result = await verifyMagicToken(token);
      if (result.valid && result.payload) userId = result.payload.userId;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report = await prisma.scoutReport.findUnique({
    where: { id: params.id },
    include: {
      stories: { orderBy: { createdAt: 'asc' } },
      business: { select: { businessName: true, websiteUrl: true } },
    },
  });

  if (!report || report.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: report.id,
    businessId: report.businessId,
    businessName: report.business?.businessName || '',
    websiteUrl: report.business?.websiteUrl || '',
    status: report.status,
    sentAt: report.sentAt,
    expiresAt: report.expiresAt,
    stories: report.stories.map(s => ({
      id: s.id,
      title: s.title,
      source: s.source,
      sourceUrl: s.sourceUrl,
      sourceType: s.sourceType,
      pubDate: s.pubDate,
      summary: s.summary,
      relevance: s.relevance,
      suggestedAngle: s.suggestedAngle,
    })),
  });
}
