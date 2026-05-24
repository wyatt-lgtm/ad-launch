export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyMagicToken } from '@/lib/magic-token';

/**
 * GET /api/post-package/[id]
 *
 * Returns post package details. Auth via session or magic token.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const packageId = params.id;
  let userId: string | null = null;

  // Try session auth first
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    userId = user?.id || null;
  }

  // Try magic token auth
  if (!userId) {
    const token = req.nextUrl.searchParams.get('token');
    if (token) {
      const result = await verifyMagicToken(token);
      if (result.valid && result.payload) {
        userId = result.payload.userId;
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pkg = await prisma.postPackage.findUnique({
    where: { id: packageId },
    include: {
      business: { select: { businessName: true, websiteUrl: true } },
      story: true,
    },
  });

  if (!pkg || pkg.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: pkg.id,
    status: pkg.status,
    source: pkg.source,
    postCopy: pkg.postCopy,
    headline: pkg.headline,
    cta: pkg.cta,
    hashtags: pkg.hashtags,
    imageUrl: pkg.imageUrl,
    storyTitle: pkg.storyTitle,
    storySource: pkg.storySource,
    storyUrl: pkg.storyUrl,
    storySummary: pkg.storySummary,
    suggestedAngle: pkg.suggestedAngle,
    businessName: pkg.business?.businessName || '',
    websiteUrl: pkg.business?.websiteUrl || '',
    completedAt: pkg.completedAt,
    createdAt: pkg.createdAt,
  });
}
