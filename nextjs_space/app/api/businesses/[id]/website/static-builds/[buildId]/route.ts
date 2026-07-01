export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { resolveBusinessAccess } from '@/lib/website-workflow';

/**
 * Milestone 6 — static build detail.
 * GET /api/businesses/{id}/website/static-builds/{buildId}
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; buildId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const businessId = params.id;
    const access = await resolveBusinessAccess(session.user.email, businessId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const build = await prisma.siteBuild.findUnique({
      where: { id: params.buildId },
      select: {
        id: true,
        businessId: true,
        buildStatus: true,
        buildNumber: true,
        sourceRef: true,
        outputRef: true,
        previewUrl: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        artifactManifestJson: true,
      },
    });
    // Enforce strict business scoping — no cross-business leakage.
    if (!build || build.businessId !== businessId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { artifactManifestJson, businessId: _b, ...rest } = build;
    return NextResponse.json({
      ...rest,
      artifactManifest: artifactManifestJson || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load build' },
      { status: 500 },
    );
  }
}
