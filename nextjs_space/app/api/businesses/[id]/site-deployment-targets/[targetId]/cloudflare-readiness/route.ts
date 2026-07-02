export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { computeCloudflareReadinessBundle } from '@/lib/site-deploy/cloudflare-orchestrator';

/**
 * Milestone 9 — Cloudflare Pages readiness (READ-ONLY).
 *
 * GET /api/businesses/[id]/site-deployment-targets/[targetId]/cloudflare-readiness
 *
 * Returns the readiness report, dry-run plan, and the manual setup checklist for
 * a Cloudflare Pages deployment target. Business-scoped: Business A can never
 * read Business B's target. NEVER calls the Cloudflare API, NEVER deploys,
 * NEVER mutates DNS, NEVER returns a secret token value. liveDeployEnabled is
 * always false.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; targetId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const access = await resolveBusinessAccess(session.user.email, params.id);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const bundle = await computeCloudflareReadinessBundle({
      businessId: params.id,
      targetId: params.targetId,
    });

    if (bundle.notFound) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    return NextResponse.json({
      target: bundle.target,
      readiness: bundle.readiness,
      dryRunPlan: bundle.dryRunPlan,
      checklist: bundle.checklist,
      liveDeployEnabled: false,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compute Cloudflare readiness' },
      { status: 500 },
    );
  }
}
