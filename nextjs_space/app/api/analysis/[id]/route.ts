export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const TOMBSTONE_API = process.env.TOMBSTONE_API_URL ?? 'https://tombstone-api-xjc4.onrender.com';

/**
 * Resolve an R2 key (or stale presigned URL) to a fresh presigned URL.
 */
async function resolveImageUrl(keyOrUrl: string | null): Promise<string | null> {
  if (!keyOrUrl) return null;

  // Pass through data URLs
  if (keyOrUrl.startsWith('data:')) return keyOrUrl;

  // Pass through S3 public URLs (GPT-5.1 generated images)
  if (keyOrUrl.includes('.s3.') && keyOrUrl.includes('amazonaws.com')) return keyOrUrl;

  // Extract R2 key if it's a full URL
  let r2Key = keyOrUrl;
  if (r2Key.startsWith('http')) {
    try {
      const parsed = new URL(r2Key);
      let path = parsed.pathname.replace(/^\/+/, '');
      if (path.startsWith('tombstoner2/')) path = path.slice('tombstoner2/'.length);
      r2Key = path;
    } catch {
      return keyOrUrl; // Can't parse — return as-is
    }
  }

  try {
    const res = await fetch(
      `${TOMBSTONE_API}/artifacts/resolve?artifact_path=${encodeURIComponent(r2Key)}`,
      { cache: 'no-store' },
    );
    const data = await res.json().catch(() => ({}));
    return data?.artifact_url ?? keyOrUrl;
  } catch {
    return keyOrUrl;
  }
}

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

    // Resolve fresh presigned URLs for all ads
    const adsWithFreshUrls = await Promise.all(
      (analysis.ads ?? []).map(async (ad) => ({
        ...ad,
        imageUrl: await resolveImageUrl(ad.imageUrl),
      })),
    );

    return NextResponse.json({
      analysis: {
        ...analysis,
        ads: adsWithFreshUrls,
      },
    });
  } catch (err: any) {
    console.error('Get analysis error:', err);
    return NextResponse.json({ error: 'Failed to load analysis' }, { status: 500 });
  }
}
