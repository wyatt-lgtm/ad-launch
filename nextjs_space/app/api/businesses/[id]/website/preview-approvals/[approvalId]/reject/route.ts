export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { rejectPreviewApproval } from '@/lib/site-preview-approval';

/**
 * Milestone 8 — reject a preview.
 *
 * POST /api/businesses/{id}/website/preview-approvals/{approvalId}/reject
 *   { reason }
 *   Stores the rejection reason and marks the record rejected. Never deletes the
 *   build; never deploys or publishes.
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
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json(
        { error: 'A rejection reason is required.' },
        { status: 400 },
      );
    }

    const result = await rejectPreviewApproval({
      businessId,
      approvalId: params.approvalId,
      rejectedByUserId: access.user.id,
      reason,
    });

    if (result.notFound) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, approvalId: result.approvalId, status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to reject preview' },
      { status: 500 },
    );
  }
}
