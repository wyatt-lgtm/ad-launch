export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetAccess } from '@/lib/asset-access';
import { prisma } from '@/lib/db';
import { deleteFile } from '@/lib/s3';

/**
 * PATCH /api/assets/[id]
 *
 * Update asset metadata, approval status, etc.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const assetId = params.id;
    const body = await req.json();

    // Find the asset first to get businessId
    const existing = await prisma.businessAsset.findUnique({
      where: { id: assetId },
      select: { businessId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }

    // Access control
    const access = await verifyAssetAccess(existing.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    // Allowed update fields
    const updateData: any = {};
    const allowedFields = [
      'title', 'description', 'tags', 'approvalStatus', 'usageRights',
      'allowedChannels', 'disallowedChannels', 'priorityScore',
      'expiresAt', 'sourcePlatform', 'customerPermission', 'approvedForAds',
      'exampleType', 'pairTag', 'pairRole', 'expirationDate', 'textContent',
      // New enhanced metadata fields
      'intendedUses', 'rightsConfirmed', 'peopleOrCustomerContent',
      'customerPermissionConfirmed', 'approvedForAI', 'publicUseAllowed',
      'notesForAI', 'relatedServiceTopic',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (['expiresAt', 'expirationDate'].includes(field) && body[field]) {
          updateData[field] = new Date(body[field]);
        } else {
          updateData[field] = body[field];
        }
      }
    }

    // Handle archive
    if (body.approvalStatus === 'archived') {
      updateData.archivedAt = new Date();
    } else if (body.approvalStatus && body.approvalStatus !== 'archived') {
      updateData.archivedAt = null;
    }

    // Handle publicUrl for approved public assets
    if (body.approvalStatus === 'approved') {
      // Will be resolved on read
    }

    const updated = await prisma.businessAsset.update({
      where: { id: assetId },
      data: updateData,
    });

    return NextResponse.json({ asset: updated });
  } catch (err: any) {
    console.error('[assets/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update asset.' }, { status: 500 });
  }
}

/**
 * DELETE /api/assets/[id]
 *
 * Delete an asset and its file from storage.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const assetId = params.id;

    const existing = await prisma.businessAsset.findUnique({
      where: { id: assetId },
      select: { businessId: true, cloudStoragePath: true, thumbnailPath: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }

    // Access control
    const access = await verifyAssetAccess(existing.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    // Delete file from storage
    if (existing.cloudStoragePath) {
      try { await deleteFile(existing.cloudStoragePath); } catch (e) {
        console.warn('[assets/[id]] Failed to delete storage file:', e);
      }
    }
    if (existing.thumbnailPath) {
      try { await deleteFile(existing.thumbnailPath); } catch (e) {
        console.warn('[assets/[id]] Failed to delete thumbnail:', e);
      }
    }

    await prisma.businessAsset.delete({ where: { id: assetId } });

    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    console.error('[assets/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete asset.' }, { status: 500 });
  }
}
