export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/businesses/[id]/social-connections
 * Returns all social connections for a business.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const connections = await prisma.socialConnection.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });

    // Strip tokens from response
    const safeConnections = connections.map((c: any) => ({
      id: c.id,
      businessId: c.businessId,
      platform: c.platform,
      externalAccountId: c.externalAccountId,
      displayName: c.displayName,
      profileUrl: c.profileUrl,
      permissionsStatus: c.permissionsStatus,
      lastCheckedAt: c.lastCheckedAt,
      lastPublishedAt: c.lastPublishedAt,
      errorMessage: c.errorMessage,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return NextResponse.json({ connections: safeConnections });
  } catch (err: any) {
    console.error('[social-connections GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/social-connections
 * Create or update a social connection for a platform.
 * For now, this creates a "pending" connection placeholder.
 * Actual OAuth flows will be handled separately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const businessId = params.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { platform, displayName, profileUrl, externalAccountId } = body;

    if (!platform) {
      return NextResponse.json({ error: 'Platform is required' }, { status: 400 });
    }

    const connection = await prisma.socialConnection.upsert({
      where: {
        businessId_platform: { businessId, platform },
      },
      create: {
        businessId,
        platform,
        displayName: displayName ?? null,
        profileUrl: profileUrl ?? null,
        externalAccountId: externalAccountId ?? null,
        permissionsStatus: 'pending',
      },
      update: {
        displayName: displayName ?? undefined,
        profileUrl: profileUrl ?? undefined,
        externalAccountId: externalAccountId ?? undefined,
      },
    });

    return NextResponse.json({
      connection: {
        id: connection.id,
        businessId: connection.businessId,
        platform: connection.platform,
        displayName: connection.displayName,
        profileUrl: connection.profileUrl,
        permissionsStatus: connection.permissionsStatus,
        isActive: connection.isActive,
      },
    });
  } catch (err: any) {
    console.error('[social-connections POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
