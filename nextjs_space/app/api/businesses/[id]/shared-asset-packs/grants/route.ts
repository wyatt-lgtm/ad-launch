export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { isAdmin, logSharedAssetAudit } from '@/lib/shared-assets';

/**
 * GET /api/businesses/[id]/shared-asset-packs/grants
 * List pack grants for a business.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const businessId = params.id;
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    const where: any = { businessId };
    if (status) where.status = status;

    const grants = await prisma.businessSharedAssetPackGrant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        pack: {
          include: {
            items: {
              include: {
                sharedAsset: {
                  select: { id: true, title: true, category: true, thumbnailUrl: true, publicUrl: true, mimeType: true },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
            _count: { select: { items: true } },
          },
        },
        grantedBy: { select: { email: true } },
      },
    });

    return NextResponse.json({ grants });
  } catch (err) {
    console.error('[PackGrants GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/shared-asset-packs/grants
 * Grant or update a pack grant. Admin only.
 * Body: { packId, status, grantNotes, expiresAt }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const businessId = params.id;
    const userId = (session.user as any).id;
    const { packId, status, grantNotes, expiresAt } = await req.json();

    if (!packId || !status) {
      return NextResponse.json({ error: 'packId and status are required' }, { status: 400 });
    }

    const grant = await prisma.businessSharedAssetPackGrant.upsert({
      where: { businessId_packId: { businessId, packId } },
      create: {
        businessId,
        packId,
        grantedByUserId: userId,
        status,
        grantNotes,
        grantedAt: status === 'granted' ? new Date() : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      update: {
        grantedByUserId: userId,
        status,
        grantNotes,
        grantedAt: status === 'granted' ? new Date() : null,
        revokedAt: status === 'revoked' ? new Date() : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    await logSharedAssetAudit({
      packId,
      businessId,
      userId,
      action: status === 'granted' ? 'pack_granted' : status === 'revoked' ? 'pack_revoked' : 'updated',
      details: { grantId: grant.id, status },
    });

    return NextResponse.json({ grant });
  } catch (err) {
    console.error('[PackGrants POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
