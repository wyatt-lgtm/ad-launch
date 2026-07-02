/**
 * Redirect Plan — edit a single mapping (Milestone 10). business-scoped.
 *
 * PUT -> edit a mapping: change redirect target, change action, or mark it
 *        ignored WITH a reason. NEVER deploys redirects. NEVER mutates DNS.
 *
 * Body: { action?, newPath?, newUrl?, reason?, status? }
 *   - Marking a URL ignored (action=ignore / status=ignored) REQUIRES a reason.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeBusiness, rejectDeployIntent } from '@/lib/site-backlinks/api-guard';
import { updateMapping } from '@/lib/site-backlinks/store';

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; mappingId: string } },
) {
  const guard = await authorizeBusiness(params.id);
  if ('error' in guard) return guard.error;

  const body = await req.json().catch(() => ({} as any));
  const deployReject = rejectDeployIntent(body);
  if (deployReject) return deployReject;

  const action = body?.action as string | undefined;
  const status = body?.status as string | undefined;
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;

  // Ignoring a backlinked URL must always carry an explicit reason so a
  // deliberate 404 is never silent.
  const isIgnore = action === 'ignore' || status === 'ignored';
  if (isIgnore && (!reason || !reason.trim())) {
    return NextResponse.json(
      { error: 'A reason is required when marking a backlinked URL as ignored.' },
      { status: 400 },
    );
  }

  const res = await updateMapping({
    businessId: params.id,
    mappingId: params.mappingId,
    action: action as any,
    newPath: body?.newPath === undefined ? undefined : body.newPath,
    newUrl: body?.newUrl === undefined ? undefined : body.newUrl,
    reason,
    status: status as any,
  });

  if (!res.ok) {
    if (res.notFound) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    return NextResponse.json({ error: 'Update failed' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
