// @ts-nocheck
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/social/posts — List social posts for current user
 * Query: ?status=pending_approval&limit=20&offset=0
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;

    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const businessId = url.searchParams.get('businessId') || undefined;

    const where: any = { userId };
    if (status) where.status = status;
    if (businessId) where.businessId = businessId;

    const [posts, total] = await Promise.all([
      prisma.socialPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.socialPost.count({ where }),
    ]);

    // Convert private R2 image URLs to proxy URLs that our server can resolve
    // Also expose tombstoneTaskId and workflowId for the frontend
    const resolved = posts.map((post) => {
      const base = {
        ...post,
        tombstoneTaskId: post.tombstoneTaskId || null,
        workflowId: (post as any).workflowId || null,
      };
      if (!post.imageUrl) return base;
      // Already a public S3 URL — keep as-is
      if (post.imageUrl.includes('.s3.') && post.imageUrl.includes('amazonaws.com')) return base;
      // R2 URL — route through our image proxy to avoid presigned URL issues
      const r2Match = post.imageUrl.match(/r2\.cloudflarestorage\.com\/[^/]+\/(.+?)(\?|$)/);
      if (r2Match) {
        const key = r2Match[1];
        return { ...base, imageUrl: `/api/social/image-proxy?key=${encodeURIComponent(key)}` };
      }
      return base;
    });

    return NextResponse.json({ posts: resolved, total, limit, offset });
  } catch (error: any) {
    console.error('Social posts GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
