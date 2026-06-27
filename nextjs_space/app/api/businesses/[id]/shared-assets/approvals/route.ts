export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { logSharedAssetAudit } from '@/lib/shared-assets';

/**
 * GET /api/businesses/[id]/shared-assets/approvals
 * List approvals for a business.
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

    const approvals = await prisma.businessSharedAssetApproval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        sharedAsset: {
          select: {
            id: true, title: true, category: true, scope: true, assetType: true,
            mimeType: true, publicUrl: true, thumbnailUrl: true,
            licenseType: true, requiresApproval: true, rightsHolder: true,
            allowWebsite: true, allowSocial: true, allowAds: true, allowEmail: true,
            allowPrint: true, allowVideo: true, allowInternal: true, allowAI: true,
            attributionRequired: true, attributionText: true,
            noDerivatives: true, noCommercial: true, geographicRestriction: true,
          },
        },
        approvedBy: { select: { email: true } },
      },
    });

    return NextResponse.json({ approvals });
  } catch (err) {
    console.error('[SharedAsset Approvals GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/shared-assets/approvals
 * Create or update an approval for a shared asset.
 * Body: { sharedAssetId, status, rightsConfirmed, approvalNotes }
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

    const businessId = params.id;
    const userId = (session.user as any).id;
    const { sharedAssetId, status, rightsConfirmed, approvalNotes } = await req.json();

    if (!sharedAssetId || !status) {
      return NextResponse.json({ error: 'sharedAssetId and status are required' }, { status: 400 });
    }

    // Verify the shared asset exists
    const asset = await prisma.sharedAsset.findUnique({ where: { id: sharedAssetId } });
    if (!asset) {
      return NextResponse.json({ error: 'Shared asset not found' }, { status: 404 });
    }

    // For brand_oem assets that require approval, ensure rights are confirmed
    if (status === 'approved' && asset.requiresApproval && !rightsConfirmed) {
      return NextResponse.json(
        { error: 'Rights confirmation required for this asset' },
        { status: 400 },
      );
    }

    // Verify business access
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { userId: true },
    });
    if (!business || (business.userId !== userId && (session.user as any).role !== 'admin')) {
      return NextResponse.json({ error: 'Not authorized for this business' }, { status: 403 });
    }

    const approval = await prisma.businessSharedAssetApproval.upsert({
      where: { businessId_sharedAssetId: { businessId, sharedAssetId } },
      create: {
        businessId,
        sharedAssetId,
        approvedByUserId: userId,
        status,
        rightsConfirmed: rightsConfirmed ?? false,
        approvalNotes,
        approvedAt: status === 'approved' ? new Date() : null,
      },
      update: {
        approvedByUserId: userId,
        status,
        rightsConfirmed: rightsConfirmed ?? false,
        approvalNotes,
        approvedAt: status === 'approved' ? new Date() : null,
        revokedAt: status === 'revoked' ? new Date() : null,
      },
    });

    await logSharedAssetAudit({
      sharedAssetId,
      businessId,
      userId,
      action: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'revoked' ? 'revoked' : 'updated',
      details: { approvalId: approval.id, status, rightsConfirmed },
    });

    return NextResponse.json({ approval });
  } catch (err) {
    console.error('[SharedAsset Approvals POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
