export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess, ensureWebsiteProject } from '@/lib/website-workflow';
import { DEFAULT_DEPLOYMENT_TARGET } from '@/lib/site-deploy/targets';
import {
  validateTargetInput,
  serializeTarget,
  TARGET_SELECT,
} from '@/lib/site-deploy/target-config';
import {
  getAssetStoreReadiness,
  getCloudflareReadiness,
} from '@/lib/site-deploy/asset-store-config';

/**
 * Phase 4 — business-scoped deployment-target configuration.
 *
 * GET  /api/businesses/[id]/site-deployment-targets  → list (safe fields only)
 * POST /api/businesses/[id]/site-deployment-targets  → create a new target
 *
 * Live deployment is NEVER enabled here. Credentials are stored as references
 * only and never returned as values.
 */

function mergeConfig(existing: any, lastVerifiedAt: string | null | undefined) {
  if (lastVerifiedAt === undefined) return existing ?? undefined;
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (lastVerifiedAt === null) delete base.lastVerifiedAt;
  else base.lastVerifiedAt = lastVerifiedAt;
  return base;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const targets = await prisma.siteDeploymentTarget.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      select: TARGET_SELECT,
    });

    return NextResponse.json({
      liveDeployEnabled: false,
      defaultTargetType: DEFAULT_DEPLOYMENT_TARGET,
      targets: targets.map(serializeTarget),
      // Config REFERENCES only — bucket names + presence booleans, never secrets.
      assetStores: getAssetStoreReadiness(),
      cloudflare: getCloudflareReadiness(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load deployment targets' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const result = validateTargetInput(body, { isCreate: true });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Invalid deployment target', issues: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    const project = await ensureWebsiteProject(businessId);
    const { __lastVerifiedAt, ...writable } = result.data;
    const configJson = mergeConfig(undefined, __lastVerifiedAt);

    const created = await prisma.siteDeploymentTarget.create({
      data: {
        businessId,
        websiteProjectId: project.id,
        targetType: writable.targetType || DEFAULT_DEPLOYMENT_TARGET,
        status: writable.status || 'draft',
        ...writable,
        ...(configJson !== undefined ? { configJson } : {}),
      },
      select: TARGET_SELECT,
    });

    return NextResponse.json(
      { target: serializeTarget(created), warnings: result.warnings, liveDeployEnabled: false },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to create deployment target' },
      { status: 500 },
    );
  }
}
