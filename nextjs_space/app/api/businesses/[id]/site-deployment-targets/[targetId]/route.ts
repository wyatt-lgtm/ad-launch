export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import {
  validateTargetInput,
  serializeTarget,
  TARGET_SELECT,
} from '@/lib/site-deploy/target-config';

/**
 * Phase 4 — update / read a single business-scoped deployment target.
 *
 * GET /api/businesses/[id]/site-deployment-targets/[targetId]
 * PUT /api/businesses/[id]/site-deployment-targets/[targetId]
 *
 * The target is always scoped to the business in the URL, so Business A can
 * never read or modify Business B's target. No live deploy. No secret values.
 */

function mergeConfig(existing: any, lastVerifiedAt: string | null | undefined) {
  if (lastVerifiedAt === undefined) return undefined;
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (lastVerifiedAt === null) delete base.lastVerifiedAt;
  else base.lastVerifiedAt = lastVerifiedAt;
  return base;
}

async function loadScopedTarget(businessId: string, targetId: string) {
  return prisma.siteDeploymentTarget.findFirst({
    where: { id: targetId, businessId },
    select: TARGET_SELECT,
  });
}

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

    const target = await loadScopedTarget(params.id, params.targetId);
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    return NextResponse.json({ target: serializeTarget(target), liveDeployEnabled: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load target' }, { status: 500 });
  }
}

export async function PUT(
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

    // Scope check: the target MUST belong to this business.
    const existing = await loadScopedTarget(params.id, params.targetId);
    if (!existing) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const result = validateTargetInput(body, { isCreate: false });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Invalid deployment target', issues: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    const { __lastVerifiedAt, ...writable } = result.data;
    const configJson = mergeConfig(existing.configJson, __lastVerifiedAt);

    const updated = await prisma.siteDeploymentTarget.update({
      where: { id: params.targetId },
      data: {
        ...writable,
        ...(configJson !== undefined ? { configJson } : {}),
      },
      select: TARGET_SELECT,
    });

    return NextResponse.json({
      target: serializeTarget(updated),
      warnings: result.warnings,
      liveDeployEnabled: false,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to update deployment target' },
      { status: 500 },
    );
  }
}
