/**
 * Reject / request-revision on a generated image asset (Milestone 5) —
 * business-scoped. Rejection is a review action only — it never triggers a
 * static build, publish, or deploy.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { rejectGeneratedImageAsset } from '@/lib/website-image-generation-store';

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
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const result = await rejectGeneratedImageAsset({
    businessId: params.id,
    assetId: params.assetId,
    reason: typeof body?.reason === 'string' ? body.reason : undefined,
  });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ asset: result.asset });
}
