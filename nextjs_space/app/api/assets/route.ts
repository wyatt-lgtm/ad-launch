export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAssetAccess } from '@/lib/asset-access';
import { prisma } from '@/lib/db';
import { getFileUrl } from '@/lib/s3';

/**
 * GET /api/assets?businessId=xxx&category=yyy&status=zzz
 *
 * List assets for a business. Requires registered owner/admin access.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Access control
    const access = await verifyAssetAccess(businessId);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.statusCode ?? 403 });
    }

    const where: any = { businessId };
    if (category) where.category = category;
    if (status) where.approvalStatus = status;
    // Don't show archived by default unless explicitly requested
    if (!status) where.archivedAt = null;

    const assets = await prisma.businessAsset.findMany({
      where,
      orderBy: [{ category: 'asc' }, { priorityScore: 'desc' }, { createdAt: 'desc' }],
      include: {
        uploadedBy: { select: { email: true } },
      },
    });

    // Resolve URLs for assets with storage paths
    const resolved = await Promise.all(
      assets.map(async (a) => {
        let resolvedUrl = a.publicUrl;
        if (a.cloudStoragePath && a.isPublic && !a.publicUrl) {
          try {
            resolvedUrl = await getFileUrl(a.cloudStoragePath, a.mimeType, true);
          } catch { /* fallback */ }
        } else if (a.cloudStoragePath && !a.isPublic) {
          try {
            resolvedUrl = await getFileUrl(a.cloudStoragePath, a.mimeType, false);
          } catch { /* fallback */ }
        }
        return { ...a, resolvedUrl };
      })
    );

    return NextResponse.json({ assets: resolved });
  } catch (err: any) {
    console.error('[assets] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch assets.' }, { status: 500 });
  }
}
