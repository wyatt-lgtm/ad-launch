export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/scout/package-status?id=<packageId>
 *
 * Lightweight status endpoint for client-side polling from the confirm page.
 * No auth required — returns only status + minimal preview data.
 * Does NOT trigger any Tombstone checks or emails (that's completion-check's job).
 */
export async function GET(req: NextRequest) {
  const packageId = req.nextUrl.searchParams.get('id') || '';
  if (!packageId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const pkg = await prisma.postPackage.findUnique({
      where: { id: packageId },
      select: {
        id: true,
        status: true,
        storyTitle: true,
        headline: true,
        imageUrl: true,
        completedAt: true,
        createdAt: true,
      },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: pkg.id,
      status: pkg.status,
      storyTitle: pkg.storyTitle,
      headline: pkg.headline || '',
      imageUrl: pkg.status === 'ready' ? (pkg.imageUrl || '') : '',
      completedAt: pkg.completedAt?.toISOString() || null,
      createdAt: pkg.createdAt.toISOString(),
    });
  } catch (err: any) {
    console.error('[package-status] Error:', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
