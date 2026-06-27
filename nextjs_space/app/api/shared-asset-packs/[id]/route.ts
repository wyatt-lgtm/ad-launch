export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { isAdmin } from '@/lib/shared-assets';

/**
 * GET /api/shared-asset-packs/[id]
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

    const pack = await prisma.sharedAssetPack.findUnique({
      where: { id: params.id },
      include: {
        items: {
          include: { sharedAsset: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { grants: true } },
      },
    });
    if (!pack) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ pack });
  } catch (err) {
    console.error('[SharedAssetPack GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/shared-asset-packs/[id]
 * Admin only.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const body = await req.json();
    delete body.id;
    delete body.createdAt;

    const pack = await prisma.sharedAssetPack.update({
      where: { id: params.id },
      data: body,
    });

    return NextResponse.json({ pack });
  } catch (err) {
    console.error('[SharedAssetPack PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/shared-asset-packs/[id]
 * Soft-delete. Admin only.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    await prisma.sharedAssetPack.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SharedAssetPack DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
