export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { isAdmin } from '@/lib/shared-assets';
import {
  generateAssetContextForSharedAsset,
} from '@/lib/asset-context';

/**
 * GET /api/shared-assets/[id]/context
 * Any authenticated user can view shared asset context for active assets.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assetId = params.id;
    const asset = await prisma.sharedAsset.findUnique({
      where: { id: assetId },
      select: { isActive: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Shared asset not found.' }, { status: 404 });
    }
    // Non-admins can only view context for active assets
    if (!asset.isActive && !isAdmin(session)) {
      return NextResponse.json({ error: 'Asset not available.' }, { status: 403 });
    }

    const ctx = await prisma.assetContext.findUnique({
      where: { sharedAssetId: assetId },
    });

    return NextResponse.json({ context: ctx || null });
  } catch (err: any) {
    console.error('[shared-assets/context GET]', err);
    return NextResponse.json({ error: 'Failed to get context.' }, { status: 500 });
  }
}

/**
 * POST /api/shared-assets/[id]/context
 * Generate/regenerate context. Admin-only.
 */
export async function POST(
  _req: NextRequest,
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

    const assetId = params.id;
    const asset = await prisma.sharedAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      return NextResponse.json({ error: 'Shared asset not found.' }, { status: 404 });
    }

    const result = await generateAssetContextForSharedAsset(assetId);

    const ctx = await prisma.assetContext.findUnique({
      where: { sharedAssetId: assetId },
    });

    return NextResponse.json({
      context: ctx,
      generated: result !== null,
    });
  } catch (err: any) {
    console.error('[shared-assets/context POST]', err);
    return NextResponse.json({ error: 'Failed to generate context.' }, { status: 500 });
  }
}

/**
 * PATCH /api/shared-assets/[id]/context
 * Edit shared asset context. Admin-only.
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

    const assetId = params.id;
    const body = await req.json();

    const existing = await prisma.assetContext.findUnique({
      where: { sharedAssetId: assetId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'No context to update. Generate context first.' }, { status: 404 });
    }

    const updateData: any = {};
    const editableFields = [
      'humanDescription', 'agentDescription', 'suggestedUses', 'restrictedUses',
      'visibleElements', 'dominantColors', 'mood', 'style',
      'documentSummary', 'keyPoints', 'restrictedClaims', 'requiredDisclosures',
      'transcriptSummary', 'qualityNotes', 'contextStatus',
    ];

    for (const field of editableFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length > 0) {
      updateData.humanReviewedContext = true;
      updateData.reviewedByUserId = (session.user as any)?.id || null;
      updateData.reviewedAt = new Date();
    }

    const updated = await prisma.assetContext.update({
      where: { sharedAssetId: assetId },
      data: updateData,
    });

    return NextResponse.json({ context: updated });
  } catch (err: any) {
    console.error('[shared-assets/context PATCH]', err);
    return NextResponse.json({ error: 'Failed to update context.' }, { status: 500 });
  }
}
