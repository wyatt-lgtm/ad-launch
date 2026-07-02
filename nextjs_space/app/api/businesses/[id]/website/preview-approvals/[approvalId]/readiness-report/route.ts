export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * Milestone 8 — fetch the durable readiness report for a preview approval.
 *
 * GET /api/businesses/{id}/website/preview-approvals/{approvalId}/readiness-report
 *   Returns the persisted readinessJson. Business-scoped: another business's
 *   record returns 404. Read-only — never deploys or publishes.
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
        status: true,
        readinessJson: true,
        updatedAt: true,
      },
    });

    if (!approval || approval.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!approval.readinessJson) {
      return NextResponse.json(
        { error: 'No readiness report available. Evaluate the preview first.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      approvalId: approval.id,
      status: approval.status,
      updatedAt: approval.updatedAt,
      readinessReport: approval.readinessJson,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load readiness report' },
      { status: 500 },
    );
  }
}
