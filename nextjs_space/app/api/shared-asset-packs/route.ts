export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { isAdmin, logSharedAssetAudit } from '@/lib/shared-assets';

/**
 * GET /api/shared-asset-packs
 * List packs. Auth required.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope');

    const where: any = { isActive: true };
    if (scope) where.scope = scope;

    const packs = await prisma.sharedAssetPack.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { sharedAsset: { select: { id: true, title: true, category: true, thumbnailUrl: true, publicUrl: true, mimeType: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { items: true, grants: true } },
      },
    });

    return NextResponse.json({ packs });
  } catch (err) {
    console.error('[SharedAssetPacks GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/shared-asset-packs
 * Create a pack. Admin only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { name, description, scope, category, targetIndustries, assetIds } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'Pack name is required' }, { status: 400 });
    }

    const pack = await prisma.sharedAssetPack.create({
      data: {
        name,
        description: description || '',
        scope: scope || 'global',
        category,
        targetIndustries: targetIndustries || [],
        items: assetIds?.length ? {
          create: assetIds.map((assetId: string, i: number) => ({
            sharedAssetId: assetId,
            sortOrder: i,
          })),
        } : undefined,
      },
      include: { items: true },
    });

    const userId = (session.user as any).id;
    await logSharedAssetAudit({
      packId: pack.id,
      userId,
      action: 'created',
      details: { name, scope, assetCount: assetIds?.length || 0 },
    });

    return NextResponse.json({ pack }, { status: 201 });
  } catch (err) {
    console.error('[SharedAssetPacks POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
