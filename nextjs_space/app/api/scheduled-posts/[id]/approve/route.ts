export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/scheduled-posts/[id]/approve
 * Approve a scheduled post. Sets status to 'approved' (or 'scheduled' for auto mode).
 * Body: { approveAll?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const postId = params.id;

    const body = await request.json().catch(() => ({}));
    const { approveAll = false } = body;

    // Fetch the post and verify business ownership
    const post = await prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { business: { select: { userId: true } } },
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (post.business.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (!['needs_approval', 'revision_requested'].includes(post.status)) {
      return NextResponse.json({ error: `Post cannot be approved from status '${post.status}'` }, { status: 400 });
    }

    // Check the business's approval mode
    const settings = await prisma.publishSettings.findUnique({
      where: { businessId: post.businessId },
    });
    const approvalMode = settings?.approvalMode ?? 'review_first';

    // For auto_after_approval, approved posts go straight to 'scheduled'
    const newStatus = approvalMode === 'auto_after_approval' ? 'scheduled' : 'approved';

    if (approveAll) {
      // Approve all needs_approval posts for this business
      const result = await prisma.scheduledPost.updateMany({
        where: {
          businessId: post.businessId,
          status: { in: ['needs_approval', 'revision_requested'] },
        },
        data: {
          status: newStatus,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      return NextResponse.json({ approved: result.count, status: newStatus });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        status: newStatus,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    return NextResponse.json({ post: updated });
  } catch (err: any) {
    console.error('[approve POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
