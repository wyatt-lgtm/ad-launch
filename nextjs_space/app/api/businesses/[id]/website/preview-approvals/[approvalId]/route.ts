export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * Milestone 8 — fetch a single preview-approval record (metadata + report).
 *
 * GET /api/businesses/{id}/website/preview-approvals/{approvalId}
 *   Business-scoped: a record belonging to another business returns 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; approvalId: string } },
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

    const approval = await prisma.websitePreviewApproval.findUnique({
      where: { id: params.approvalId },
      select: {
        id: true,
        businessId: true,
        websiteProjectId: true,
        siteBuildId: true,
        mobileQaId: true,
        deploymentTargetId: true,
        status: true,
        readinessJson: true,
        approvalNotes: true,
        rejectionReason: true,
        approvedByUserId: true,
        rejectedByUserId: true,
        approvedAt: true,
        rejectedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Business scoping: never leak another business's record.
    if (!approval || approval.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ approval });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load preview approval' },
      { status: 500 },
    );
  }
}
