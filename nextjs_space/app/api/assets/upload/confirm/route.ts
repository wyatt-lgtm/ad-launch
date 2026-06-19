export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetAccess } from '@/lib/asset-access';
import { sanitizeSvg } from '@/lib/asset-validation';
import { prisma } from '@/lib/db';
import { getFileUrl } from '@/lib/s3';

/**
 * POST /api/assets/upload/confirm
 *
 * Called after the client completes the direct-to-S3 upload.
 * Validates SVG content if applicable, generates public URL, and updates status.
 *
 * Body: { assetId, svgContent? }
 */
export async function POST(req: NextRequest) {
  try {
    const { assetId, svgContent } = await req.json();

    if (!assetId) {
      return NextResponse.json({ error: 'assetId is required' }, { status: 400 });
    }

    const asset = await prisma.businessAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }

    // Access control
    const access = await verifyAssetAccess(asset.businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    // SVG sanitization check
    if (asset.mimeType === 'image/svg+xml' && svgContent) {
      const svgCheck = sanitizeSvg(svgContent);
      if (!svgCheck.safe) {
        // Delete the dangerous file
        await prisma.businessAsset.delete({ where: { id: assetId } });
        return NextResponse.json(
          { error: `SVG rejected: ${svgCheck.error}` },
          { status: 400 }
        );
      }
    }

    // Generate public URL
    let publicUrl: string | null = null;
    if (asset.cloudStoragePath && asset.isPublic) {
      try {
        publicUrl = await getFileUrl(asset.cloudStoragePath, asset.mimeType, true);
      } catch { /* will resolve on read */ }
    }

    const updated = await prisma.businessAsset.update({
      where: { id: assetId },
      data: {
        publicUrl,
        approvalStatus: 'uploaded',
      },
    });

    return NextResponse.json({ asset: updated });
  } catch (err: any) {
    console.error('[assets/upload/confirm] Error:', err);
    return NextResponse.json({ error: 'Failed to confirm upload.' }, { status: 500 });
  }
}
