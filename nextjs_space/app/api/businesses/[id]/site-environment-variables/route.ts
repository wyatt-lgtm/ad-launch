export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';
import { validateEnvWrite, serializeEnvVar } from '@/lib/site-deploy/env-config';

/**
 * Phase 4 — business-scoped generated-site environment variables.
 *
 * GET  /api/businesses/[id]/site-environment-variables
 * POST /api/businesses/[id]/site-environment-variables
 *
 * Public (NEXT_PUBLIC_*) values are stored inline. Secret values are NEVER
 * stored or returned — only a reference name. Secret-like public keys are
 * rejected.
 */

async function targetBelongsToBusiness(businessId: string, targetId: string | null | undefined) {
  if (!targetId) return true; // null target = business-level env var
  const t = await prisma.siteDeploymentTarget.findFirst({
    where: { id: targetId, businessId },
    select: { id: true },
  });
  return Boolean(t);
}

export async function GET(
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

    const targetId = new URL(request.url).searchParams.get('deploymentTargetId');
    const vars = await prisma.siteEnvironmentVariable.findMany({
      where: { businessId, ...(targetId ? { deploymentTargetId: targetId } : {}) },
      orderBy: [{ isPublic: 'desc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        valueRef: true,
        isPublic: true,
        isSecret: true,
        environment: true,
        deploymentTargetId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      liveDeployEnabled: false,
      variables: vars.map(serializeEnvVar),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load environment variables' },
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
    const deploymentTargetId: string | null = body.deploymentTargetId || null;

    if (!(await targetBelongsToBusiness(businessId, deploymentTargetId))) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    const result = validateEnvWrite(body);
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: 'Invalid environment variable', issues: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }
    const d = result.data;

    // Upsert by (business, target, key, environment) without a compound unique
    // constraint: find existing then update/create.
    const existing = await prisma.siteEnvironmentVariable.findFirst({
      where: {
        businessId,
        deploymentTargetId,
        key: d.key,
        environment: d.environment,
      },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.siteEnvironmentVariable.update({
          where: { id: existing.id },
          data: { valueRef: d.valueRef, isPublic: d.isPublic, isSecret: d.isSecret },
          select: {
            id: true, key: true, valueRef: true, isPublic: true, isSecret: true,
            environment: true, deploymentTargetId: true, createdAt: true, updatedAt: true,
          },
        })
      : await prisma.siteEnvironmentVariable.create({
          data: {
            businessId,
            deploymentTargetId,
            key: d.key,
            valueRef: d.valueRef,
            isPublic: d.isPublic,
            isSecret: d.isSecret,
            environment: d.environment,
          },
          select: {
            id: true, key: true, valueRef: true, isPublic: true, isSecret: true,
            environment: true, deploymentTargetId: true, createdAt: true, updatedAt: true,
          },
        });

    return NextResponse.json(
      { variable: serializeEnvVar(saved), warnings: result.warnings, liveDeployEnabled: false },
      { status: existing ? 200 : 201 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to save environment variable' },
      { status: 500 },
    );
  }
}
