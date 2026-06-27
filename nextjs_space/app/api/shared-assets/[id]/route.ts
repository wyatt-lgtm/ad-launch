export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getFileUrl } from '@/lib/s3';
import { isAdmin, logSharedAssetAudit } from '@/lib/shared-assets';

/**
 * GET /api/shared-assets/[id]
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

    const asset = await prisma.sharedAsset.findUnique({
      where: { id: params.id },
      include: {
        uploadedBy: { select: { email: true } },
        packItems: { include: { pack: { select: { id: true, name: true } } } },
      },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let resolvedUrl = asset.publicUrl || null;
    if (!resolvedUrl && asset.cloudStoragePath) {
      try { resolvedUrl = await getFileUrl(asset.cloudStoragePath, asset.mimeType, asset.isPublic); } catch {}
    }

    return NextResponse.json({ asset: { ...asset, resolvedUrl } });
  } catch (err) {
    console.error('[SharedAsset GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/shared-assets/[id]
 * Update shared asset metadata. Admin only.
 */
export async function PATCH(
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

    const body = await req.json();
    const userId = (session.user as any).id;

    // Prevent changing ID
    delete body.id;
    delete body.uploadedByUserId;
    delete body.createdAt;

    if (body.licenseExpiry) body.licenseExpiry = new Date(body.licenseExpiry);
    if (body.archivedAt) body.archivedAt = new Date(body.archivedAt);

    const asset = await prisma.sharedAsset.update({
      where: { id: params.id },
      data: body,
    });

    await logSharedAssetAudit({
      sharedAssetId: asset.id,
      userId,
      action: 'updated',
      details: { fields: Object.keys(body) },
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[SharedAsset PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/shared-assets/[id]
 * Soft-delete (archive) a shared asset. Admin only.
 */
export async function DELETE(
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

    const userId = (session.user as any).id;

    await prisma.sharedAsset.update({
      where: { id: params.id },
      data: { isActive: false, archivedAt: new Date(), approvalStatus: 'archived' },
    });

    await logSharedAssetAudit({
      sharedAssetId: params.id,
      userId,
      action: 'updated',
      details: { archived: true },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SharedAsset DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
