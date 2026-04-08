export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/social/posts/[id] — Get a single post
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const { id } = await context.params;

    const post = await prisma.socialPost.findFirst({
      where: { id, userId },
    });

    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    return NextResponse.json({ post });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/social/posts/[id] — Update post (approve, reject, edit caption, etc.)
 * Body: { action?: 'approve' | 'reject' | 'publish', caption?, hashtags?, platforms?, rejectReason?, imageUrl? }
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const { id } = await context.params;

    const post = await prisma.socialPost.findFirst({ where: { id, userId } });
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    const body = await req.json();
    const { action, caption, hashtags, platforms, rejectReason, imageUrl } = body;

    const updateData: any = {};

    // Direct field updates
    if (caption !== undefined) updateData.caption = caption;
    if (hashtags !== undefined) updateData.hashtags = hashtags;
    if (platforms !== undefined) updateData.platforms = platforms;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

    // Action-based state transitions
    if (action === 'approve') {
      updateData.status = 'approved';
    } else if (action === 'reject') {
      updateData.status = 'rejected';
      updateData.rejectedAt = new Date();
      updateData.rejectReason = rejectReason || null;
    } else if (action === 'publish') {
      updateData.status = 'published';
      updateData.publishedAt = new Date();
    }

    const updated = await prisma.socialPost.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ post: updated });
  } catch (error: any) {
    console.error('Social post PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/social/posts/[id] — Delete a post
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = (session.user as any).id;
    const { id } = await context.params;

    const post = await prisma.socialPost.findFirst({ where: { id, userId } });
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    await prisma.socialPost.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
