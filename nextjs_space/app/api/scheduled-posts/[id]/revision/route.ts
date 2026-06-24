export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/scheduled-posts/[id]/revision
 * Request a revision on a scheduled post.
 * Body: { feedback: string }
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
    const { feedback } = body;

    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return NextResponse.json({ error: 'Feedback is required' }, { status: 400 });
    }

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
    if (!['needs_approval', 'approved', 'scheduled'].includes(post.status)) {
      return NextResponse.json({ error: `Cannot request revision from status '${post.status}'` }, { status: 400 });
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        status: 'revision_requested',
        revisionRequestText: feedback.trim(),
        revisionRequestedAt: new Date(),
        revisionCount: { increment: 1 },
      },
    });

    return NextResponse.json({ post: updated });
  } catch (err: any) {
    console.error('[revision POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
