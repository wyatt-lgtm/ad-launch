export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * GET /api/website-project/[id]/pages[?productionId=...]
 * Returns the first-class production pages (with their sections) for a project.
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

    const productionId = new URL(request.url).searchParams.get('productionId');
    const where: any = { websiteProjectId: project.id };
    if (productionId) where.productionId = productionId;

    const pages = await prisma.websitePage.findMany({
      where,
      orderBy: [{ productionId: 'desc' }, { sortOrder: 'asc' }],
      include: {
        sections: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return NextResponse.json({ pages });
  } catch (err: any) {
    console.error('[website-project/pages] error:', err?.message);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
