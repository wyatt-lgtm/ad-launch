export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { approvePreviewApproval } from '@/lib/site-preview-approval';

/**
 * Milestone 8 — approve a preview for FUTURE deployment readiness ONLY.
 *
 * POST /api/businesses/{id}/website/preview-approvals/{approvalId}/approve
 *   { notes? }
 *   Re-runs the readiness gate. If the gate fails → 422 with blocking reasons
 *   and the record stays blocked. On success → approved_for_deployment_readiness
 *   (or approved_preview_only_target_incomplete). NEVER deploys, publishes,
 *   launches, or changes the SiteBuild status. Any deploy/publish body field is
 *   rejected.
 */
export async function POST(
  request: NextRequest,
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

    const body = await request.json().catch(() => ({} as any));
    if (
      body?.deploy === true ||
      body?.publish === true ||
      body?.launch === true ||
      body?.deployRequested === true
    ) {
      return NextResponse.json(
        {
          error:
            'Deployment disabled — dry run only. Approval is a readiness decision and never deploys, publishes, or launches. Future deployment requires a separate approval step.',
        },
        { status: 400 },
      );
    }

    const notes = typeof body?.notes === 'string' ? body.notes : null;

    const result = await approvePreviewApproval({
      businessId,
      approvalId: params.approvalId,
      approvedByUserId: access.user.id,
      notes,
    });

    if (result.notFound) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (result.blocked) {
      // Gate failed → do NOT approve; return blocking reasons.
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          approvalId: result.approvalId,
          status: result.status,
          blockingReasons: result.result?.blockingReasons || [],
          report: result.report,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      approvalId: result.approvalId,
      status: result.status,
      previewStatus: result.result.previewStatus,
      targetStatus: result.result.targetStatus,
      report: result.report,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to approve preview' },
      { status: 500 },
    );
  }
}
