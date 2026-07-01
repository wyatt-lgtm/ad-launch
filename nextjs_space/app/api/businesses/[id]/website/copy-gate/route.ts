/**
 * Copy-gate status API (Milestone 2) — DISPLAY ONLY, business-scoped.
 *
 * GET -> the current copy-gate display status derived from stored sitemap state.
 *
 * This endpoint reports whether copy generation WOULD be allowed. It NEVER
 * generates copy, images, or triggers a publish/deploy. Copy generation is not
 * implemented in this milestone.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { resolveCopyGate } from '@/lib/website-sitemap-store';
import { mapCopyGateStatus } from '@/lib/website-sitemap-edit';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await resolveBusinessAccess(session.user.email, params.id);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const gate = await resolveCopyGate(params.id);
  return NextResponse.json({
    status: mapCopyGateStatus(gate.code),
    allowed: gate.allowed,
    code: gate.code,
    reason: gate.reason,
    h1Issues: gate.h1Issues ?? [],
    // Copy generation is intentionally not implemented in this milestone.
    copyGenerationAvailable: false,
  });
}
