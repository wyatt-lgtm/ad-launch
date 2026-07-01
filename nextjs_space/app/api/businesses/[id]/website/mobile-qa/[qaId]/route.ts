export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * Milestone 7 — fetch a single mobile QA result (metadata + full report).
 *
 * GET /api/businesses/{id}/website/mobile-qa/{qaId}
 *   Business-scoped: a QA record belonging to another business returns 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; qaId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const qa = await prisma.websiteMobileQa.findUnique({
      where: { id: params.qaId },
      select: {
        id: true,
        businessId: true,
        websiteProjectId: true,
        siteBuildId: true,
        status: true,
        score: true,
        passed: true,
        checkedRoutesCount: true,
        failedRoutesCount: true,
        warningCount: true,
        qaJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Business scoping: never leak another business's QA record.
    if (!qa || qa.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ qa });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load mobile QA result' },
      { status: 500 },
    );
  }
}
