/**
 * Approve a generated image asset (Milestone 5) — business-scoped.
 *
 * A hero asset that FAILED QA can NEVER be approved; a diagnostic `failed`
 * asset can never be approved. Approval is a review action only — it never
 * triggers a static build, publish, or deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { approveGeneratedImageAsset } from '@/lib/website-image-generation-store';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; assetId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await resolveBusinessAccess(session.user.email, params.id);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await approveGeneratedImageAsset({ businessId: params.id, assetId: params.assetId });
  if (!result.ok) {
    if (result.error === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ asset: result.asset });
}
