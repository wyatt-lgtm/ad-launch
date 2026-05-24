export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/post-package/[id]/action
 *
 * Perform an action on a post package:
 * - save_draft: save as draft
 * - reject: reject the post
 * - mark_posted: mark as manually posted
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pkg = await prisma.postPackage.findUnique({ where: { id: params.id } });
  if (!pkg || pkg.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as any));
  const { action } = body;

  const validActions: Record<string, string> = {
    save_draft: 'draft',
    reject: 'rejected',
    mark_posted: 'posted',
  };

  const newStatus = validActions[action];
  if (!newStatus) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  await prisma.postPackage.update({
    where: { id: params.id },
    data: { status: newStatus },
  });

  console.log(`[post-package] Package ${params.id} action=${action} new_status=${newStatus}`);
  return NextResponse.json({ success: true, status: newStatus });
}
