export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * GET /api/website-project/[id]/qa
 * Returns QA results for both concept and production stages of a project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const project = await prisma.websiteProject.findUnique({
      where: { id: params.id },
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const access = await resolveBusinessAccess(
      session.user.email,
      project.businessId,
    );
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const qaResults = await prisma.websiteQaResult.findMany({
      where: { websiteProjectId: project.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ qaResults });
  } catch (err: any) {
    console.error('[website-project/qa] error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
