export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { computeCloudflareReadinessBundle } from '@/lib/site-deploy/cloudflare-orchestrator';

/**
 * Milestone 9 — Cloudflare Pages dry-run plan (READ-ONLY / SIDE-EFFECT-FREE).
 *
 * POST /api/businesses/[id]/site-deployment-targets/[targetId]/cloudflare-dry-run
 *
 * Returns a side-effect-free dry-run plan describing what a FUTURE, separately
 * approved deploy WOULD do (create project, connect repo, set env vars, add
 * custom domain). It NEVER calls the Cloudflare API, NEVER creates or connects
 * a project, NEVER mutates DNS, NEVER uploads / publishes / deploys.
 *
 * Any attempt to request an actual deploy/publish/launch in the body is
 * hard-rejected (400) — and even if forced through, the readiness gate blocks
 * it. liveDeployEnabled is always false.
 */

/** Body fields that would signal an intent to actually deploy. Rejected. */
const DEPLOY_INTENT_FIELDS = [
  'deploy',
  'publish',
  'launch',
  'liveDeploy',
  'confirmDeploy',
  'execute',
  'apply',
];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; targetId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const access = await resolveBusinessAccess(session.user.email, params.id);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const requestedDeploy = DEPLOY_INTENT_FIELDS.some((f) => {
      const v = (body as any)?.[f];
      return v === true || v === 'true' || v === 1 || v === '1';
    });
    if (requestedDeploy) {
      return NextResponse.json(
        {
          error:
            'Live deployment is disabled in this milestone. This endpoint produces a dry-run plan only — it never deploys, publishes, or changes DNS.',
          liveDeployEnabled: false,
        },
        { status: 400 },
      );
    }

    const bundle = await computeCloudflareReadinessBundle({
      businessId: params.id,
      targetId: params.targetId,
      deployRequested: false,
    });

    if (bundle.notFound) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    return NextResponse.json({
      target: bundle.target,
      dryRunPlan: bundle.dryRunPlan,
      readiness: bundle.readiness,
      checklist: bundle.checklist,
      liveDeployEnabled: false,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compute Cloudflare dry-run plan' },
      { status: 500 },
    );
  }
}
