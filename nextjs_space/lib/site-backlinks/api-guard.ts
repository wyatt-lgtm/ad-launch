/**
 * Milestone 10 — shared API guards for backlink-preservation routes.
 *
 * Every route is: authed (session) -> business-access (owner or admin) ->
 * business-scoped. No route deploys, publishes, or mutates live DNS; the
 * deploy-intent guard hard-rejects any request that tries.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { resolveBusinessAccess } from '@/lib/website-workflow';

export interface AuthorizedContext {
  user: { id: string; role: string | null };
  isAdmin: boolean;
}

/** Returns either { error } (401/403 response) or { access } context. */
export async function authorizeBusiness(
  businessId: string,
): Promise<{ error: NextResponse } | { access: AuthorizedContext }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const access = await resolveBusinessAccess(session.user.email, businessId);
  if (!access) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { access };
}

/** Body fields that signal a live deploy/publish/DNS intent — always rejected. */
const DEPLOY_INTENT_FIELDS = [
  'deploy',
  'deployRequested',
  'publish',
  'launch',
  'goLive',
  'liveDeploy',
  'confirmDeploy',
  'execute',
  'apply',
  'mutateDns',
  'dnsMutation',
] as const;

/**
 * Returns a 400 response if the body contains any truthy deploy-intent flag,
 * otherwise null. Redirect plans are a READINESS artifact only — this layer
 * never deploys redirects or touches live DNS.
 */
export function rejectDeployIntent(body: any): NextResponse | null {
  if (!body || typeof body !== 'object') return null;
  for (const f of DEPLOY_INTENT_FIELDS) {
    if (body[f] === true || body[f] === 'true' || body[f] === 1) {
      return NextResponse.json(
        {
          error:
            'Deployment disabled. This endpoint only inventories backlinks and prepares a redirect plan for review — it never deploys redirects or mutates live DNS.',
        },
        { status: 400 },
      );
    }
  }
  return null;
}
